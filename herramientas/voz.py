# Todo lo de la voz del corto: buscar la grabación, limpiarla, transcribirla palabra a palabra y medir el ritmo.
#
#   python herramientas/voz.py buscar
#       Lista las grabaciones más recientes (Grabadora de sonido de Windows, Notas de voz del Mac, Escritorio, Descargas).
#   python herramientas/voz.py preparar <grabación> <corto>
#       Limpia la voz (filtro de graves + quita picos saturados), recorta el silencio del principio y del final,
#       la guarda en public/<corto>/voice.wav, la transcribe con tiempos por palabra en cortos/<corto>/words.json
#       y saca un informe: duración, palabras por segundo, pausas largas, frases repetidas y frases del guion que faltan.
#   python herramientas/voz.py cortar <corto> 8.20-9.65 [12.1-13.0 ...]
#       Quita esos tramos (segundos) de la voz (por ejemplo, una frase en la que te trabaste) y vuelve a transcribir.
#   python herramientas/voz.py apretar <corto> [pausa_max] [pausa_max_fin_de_frase]
#       Acorta las pausas largas (por defecto a 0,30 s dentro de la frase y 0,50 s al acabar una frase).
#
# Transcripción: faster-whisper, modelo large-v3-turbo (unos 1,6 GB; se descarga solo la primera vez).
# Para un ordenador con poca memoria: variable de entorno MODELO_VOZ=small (menos preciso, 480 MB).
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import wave
from datetime import datetime

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPS = 30
EXT_AUDIO = (".m4a", ".wav", ".mp3", ".aac", ".ogg", ".opus", ".flac", ".wma", ".3gp", ".qta", ".caf", ".webm")


def ffmpeg():
    exe = os.environ.get("FFMPEG") or shutil.which("ffmpeg")
    if not exe:
        sys.exit("No encuentro ffmpeg. Hay que instalarlo (ver README, «Instrucciones para Claude Code»).")
    return exe


def ffprobe_duracion(ruta):
    exe = os.environ.get("FFPROBE") or shutil.which("ffprobe")
    if not exe:
        return None
    r = subprocess.run([exe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", ruta],
                       capture_output=True, text=True)
    try:
        return float(r.stdout.strip())
    except ValueError:
        return None


# ------------------------------------------------------------------ buscar
def carpetas_de_grabaciones():
    casa = os.path.expanduser("~")
    out = []
    if sys.platform == "win32":
        docs = set()
        try:  # carpeta Documentos real (puede estar redirigida a OneDrive)
            r = subprocess.run(["powershell", "-NoProfile", "-Command", "[Environment]::GetFolderPath('MyDocuments')"],
                               capture_output=True, text=True, timeout=20)
            if r.stdout.strip():
                docs.add(r.stdout.strip())
        except Exception:
            pass
        for d in os.listdir(casa):
            if d.lower().startswith("onedrive"):
                for sub in ("Documents", "Documentos"):
                    docs.add(os.path.join(casa, d, sub))
        docs.update([os.path.join(casa, "Documents"), os.path.join(casa, "Documentos")])
        for d in docs:
            for sub in ("Grabaciones de sonido", "Sound recordings", "Sound Recordings", "Grabaciones"):
                out.append(os.path.join(d, sub))
    elif sys.platform == "darwin":
        out += [os.path.join(casa, "Library", "Group Containers", "group.com.apple.VoiceMemos.shared", "Recordings"),
                os.path.join(casa, "Library", "Application Support", "com.apple.voicememos", "Recordings")]
    for d in ("Desktop", "Escritorio", "Downloads", "Descargas"):
        out.append(os.path.join(casa, d))
    if sys.platform == "win32":
        for d in os.listdir(casa):
            if d.lower().startswith("onedrive"):
                out += [os.path.join(casa, d, "Desktop"), os.path.join(casa, d, "Escritorio")]
    vistos, res = set(), []
    for d in out:
        k = os.path.normcase(os.path.abspath(d))
        if k not in vistos:
            vistos.add(k)
            res.append(d)
    return res


def buscar():
    encontrados, sin_permiso = [], []
    for d in carpetas_de_grabaciones():
        if not os.path.isdir(d):
            continue
        try:
            nombres = os.listdir(d)
        except PermissionError:
            sin_permiso.append(d)
            continue
        es_escritorio = os.path.basename(d).lower() in ("desktop", "escritorio", "downloads", "descargas")
        for n in nombres:
            p = os.path.join(d, n)
            if n.lower().endswith(EXT_AUDIO) and os.path.isfile(p):
                t = os.path.getmtime(p)
                if es_escritorio and time.time() - t > 3 * 86400:
                    continue  # en Escritorio/Descargas solo cuenta lo de los 3 últimos días
                encontrados.append((t, p))
    encontrados.sort(reverse=True)
    if not encontrados:
        print("No he encontrado ninguna grabación.")
    else:
        print("Grabaciones más recientes (la primera es la más nueva):")
        for t, p in encontrados[:5]:
            dur = ffprobe_duracion(p)
            ds = f"{dur:.1f} s" if dur else "?"
            print(f"  {datetime.fromtimestamp(t):%d-%m-%Y %H:%M}  {ds:>8s}  {p}")
    if sin_permiso:
        print("\nSin permiso para mirar en:")
        for d in sin_permiso:
            print("  " + d)
        if sys.platform == "darwin":
            print("En Mac, Notas de voz guarda las grabaciones en una carpeta protegida. Lo más fácil: en la app Notas de voz,")
            print("arrastra la grabación al Escritorio (o a esta ventana) y vuelve a pedírmelo.")


# ------------------------------------------------------------------ audio
def leer_wav(ruta):
    with wave.open(ruta, "rb") as w:
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x, sr


def escribir_wav(ruta, x, sr):
    y = np.clip(x, -1, 1)
    with wave.open(ruta, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((y * 32767).astype(np.int16).tobytes())


def quitar_tramos(x, sr, tramos, fundido=0.012):
    """quita [ini, fin] (segundos) con fundidos cortos para que no haya chasquidos"""
    tramos = sorted(tramos)
    trozos, pos = [], 0
    nf = int(fundido * sr)
    for a, b in tramos:
        ia, ib = int(a * sr), int(b * sr)
        if ia > pos:
            trozos.append(x[pos:ia].copy())
        pos = max(pos, ib)
    trozos.append(x[pos:].copy())
    for i, t in enumerate(trozos):
        if len(t) > 2 * nf:
            if i > 0:
                t[:nf] *= np.linspace(0, 1, nf)
            if i < len(trozos) - 1:
                t[-nf:] *= np.linspace(1, 0, nf)
    return np.concatenate(trozos)


def mover_tiempos(palabras, tramos):
    """corrige los tiempos de words.json después de quitar tramos"""
    def nuevo(t):
        q = 0.0
        for a, b in tramos:
            if t >= b:
                q += b - a
            elif t > a:
                q += t - a
        return round(t - q, 3)
    return [dict(w, start=nuevo(w["start"]), end=nuevo(w["end"])) for w in palabras]


# ------------------------------------------------------------------ transcribir
def transcribir(ruta_wav):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.exit("Falta faster-whisper. Instálalo en el entorno del proyecto: .venv (ver README).")
    modelo = os.environ.get("MODELO_VOZ", "large-v3-turbo")
    print(f"Transcribiendo con el modelo {modelo} (la primera vez se descarga: unos 1,6 GB)...", flush=True)
    t0 = time.time()
    m = WhisperModel(modelo, device="cpu", compute_type="int8")
    segs, info = m.transcribe(ruta_wav, language="es", word_timestamps=True, beam_size=5, vad_filter=False)
    palabras = []
    for s in segs:
        for w in s.words or []:
            txt = w.word.strip()
            if txt:
                palabras.append({"word": txt, "start": round(w.start, 3), "end": round(w.end, 3), "p": round(w.probability, 3)})
    print(f"Transcrito en {time.time() - t0:.0f} s: {len(palabras)} palabras.", flush=True)
    return palabras


# ------------------------------------------------------------------ análisis
def norm(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9ñ]+", "", s)


def leer_guion(corto):
    ruta = os.path.join(RAIZ, "cortos", corto, "GUION.md")
    if not os.path.isfile(ruta):
        return None
    txt = open(ruta, encoding="utf-8").read()
    m = re.search(r"^##\s*Guion[^\n]*\n(.*?)(?=^##\s|\Z)", txt, re.S | re.M)
    return m.group(1).strip() if m else None


def informe(corto, palabras):
    if not palabras:
        print("No se ha entendido ninguna palabra. ¿Es la grabación correcta?")
        return {}
    dur = palabras[-1]["end"] - palabras[0]["start"]
    pps = len(palabras) / max(dur, 0.1)
    huecos = [(palabras[i]["end"], palabras[i + 1]["start"]) for i in range(len(palabras) - 1)
              if palabras[i + 1]["start"] - palabras[i]["end"] > 0.35]
    total_huecos = sum(b - a for a, b in huecos)
    print("\nINFORME DE LA VOZ")
    print(f"  Duración hablada: {dur:.1f} s ({round(dur * FPS)} fotogramas a 30 fps)")
    print(f"  Palabras: {len(palabras)}  ->  {pps:.1f} palabras por segundo "
          f"(los virales medidos van a 3,5-4,1 en inglés; la voz del galeón, a 3,1)")
    print(f"  Pausas de más de 0,35 s: {len(huecos)}, suman {total_huecos:.1f} s "
          f"(en los virales, las pausas de más de 0,25 s suman menos de 1 s)")
    for a, b in huecos:
        if b - a > 0.6:
            print(f"    pausa larga {a:.2f}-{b:.2f} s ({b - a:.2f} s)")
    # repeticiones: el mismo trozo de 3 palabras dicho dos veces en menos de 20 s
    n = [norm(w["word"]) for w in palabras]
    vistos, repes = {}, []
    for i in range(len(n) - 2):
        k = " ".join(n[i:i + 3])
        if k in vistos and palabras[i]["start"] - palabras[vistos[k]]["start"] < 20:
            j = vistos[k]
            repes.append((j, i))
        vistos[k] = i
    propuestas = []
    for j, i in repes:
        a, b = palabras[j]["start"], palabras[i]["start"]
        frase = " ".join(w["word"] for w in palabras[j:j + 3])
        if not any(abs(a - p[0]) < 0.5 for p in propuestas):
            propuestas.append((round(max(0, a - 0.05), 2), round(b - 0.05, 2), frase))
    if propuestas:
        print("  Posibles repeticiones (te trabaste y repetiste la frase):")
        for a, b, frase in propuestas:
            print(f"    «{frase}...» aparece dos veces: propuesta, quitar {a:.2f}-{b:.2f} s y quedarse con la segunda")
        print("    Revisa la transcripción antes de cortar: python herramientas/voz.py cortar <corto> INI-FIN")
    guion = leer_guion(corto)
    faltan, sobran = [], []
    if guion:
        g = [x for x in (norm(t) for t in guion.split()) if x]
        sm = difflib.SequenceMatcher(a=g, b=n, autojunk=False)
        gw = [t for t in guion.split() if norm(t)]
        for op, a1, a2, b1, b2 in sm.get_opcodes():
            if op in ("delete", "replace") and a2 - a1 >= 2:
                faltan.append(" ".join(gw[a1:a2]))
            if op in ("insert", "replace") and b2 - b1 >= 2:
                sobran.append((palabras[b1]["start"], " ".join(w["word"] for w in palabras[b1:b2])))
        print(f"  Parecido con el guion: {sm.ratio() * 100:.0f} %")
        for f in faltan[:8]:
            print(f"    del guion no se oye: «{f}»")
        for t, f in sobran[:8]:
            print(f"    se oye y no está en el guion ({t:.2f} s): «{f}»")
    return {"duracion": round(dur, 2), "palabras": len(palabras), "palabras_por_segundo": round(pps, 2),
            "pausas_largas": [[round(a, 2), round(b, 2)] for a, b in huecos], "repeticiones": propuestas,
            "faltan_del_guion": faltan, "sobran": sobran}


def guardar(corto, palabras):
    dcorto = os.path.join(RAIZ, "cortos", corto)
    os.makedirs(dcorto, exist_ok=True)
    with open(os.path.join(dcorto, "words.json"), "w", encoding="utf-8") as fh:
        json.dump(palabras, fh, ensure_ascii=False, indent=1)
    inf = informe(corto, palabras)
    with open(os.path.join(dcorto, "voz-informe.json"), "w", encoding="utf-8") as fh:
        json.dump(inf, fh, ensure_ascii=False, indent=1)
    print(f"\nTiempos por palabra en cortos/{corto}/words.json")


def preparar(origen, corto):
    if not os.path.isfile(origen):
        sys.exit(f"No encuentro la grabación: {origen}")
    dpub = os.path.join(RAIZ, "public", corto)
    os.makedirs(dpub, exist_ok=True)
    limpio = os.path.join(dpub, "voice-limpia-entera.wav")
    print("Limpiando la voz (filtro de graves a 70 Hz + arreglo de picos saturados)...", flush=True)
    r = subprocess.run([ffmpeg(), "-y", "-v", "error", "-i", origen, "-af", "highpass=f=70,adeclip",
                        "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", limpio])
    if r.returncode != 0:
        sys.exit("ffmpeg no ha podido leer la grabación.")
    palabras = transcribir(limpio)
    if not palabras:
        sys.exit("No se ha entendido ninguna palabra en la grabación.")
    # recortar el silencio: la voz empieza a los 0,10 s y el audio acaba 0,40 s después de la última palabra
    x, sr = leer_wav(limpio)
    ini = max(0.0, palabras[0]["start"] - 0.10)
    fin = min(len(x) / sr, palabras[-1]["end"] + 0.40)
    escribir_wav(os.path.join(dpub, "voice.wav"), x[int(ini * sr):int(fin * sr)], sr)
    os.remove(limpio)
    palabras = [dict(w, start=round(w["start"] - ini, 3), end=round(w["end"] - ini, 3)) for w in palabras]
    print(f"Voz limpia en public/{corto}/voice.wav ({fin - ini:.1f} s)")
    guardar(corto, palabras)


def copia_de_seguridad(ruta):
    copia = ruta.replace(".wav", "-antes-de-editar.wav")
    if not os.path.exists(copia):
        shutil.copy2(ruta, copia)
    return copia


def cortar(corto, tramos_txt):
    ruta = os.path.join(RAIZ, "public", corto, "voice.wav")
    tramos = []
    for t in tramos_txt:
        a, b = (float(v.replace(",", ".")) for v in t.split("-"))
        tramos.append((min(a, b), max(a, b)))
    copia = copia_de_seguridad(ruta)
    x, sr = leer_wav(ruta)
    y = quitar_tramos(x, sr, tramos)
    escribir_wav(ruta, y, sr)
    print(f"Quitados {sum(b - a for a, b in tramos):.2f} s. La voz anterior queda en {os.path.basename(copia)}.")
    guardar(corto, transcribir(ruta))


def apretar(corto, pmax=0.30, pmax_fin=0.50):
    ruta = os.path.join(RAIZ, "public", corto, "voice.wav")
    pal = json.load(open(os.path.join(RAIZ, "cortos", corto, "words.json"), encoding="utf-8"))
    tramos = []
    for i in range(len(pal) - 1):
        a, b = pal[i]["end"], pal[i + 1]["start"]
        lim = pmax_fin if pal[i]["word"].rstrip()[-1:] in ".?!;:" else pmax
        if b - a > lim:
            mitad = (a + b) / 2
            tramos.append((round(mitad - (b - a - lim) / 2, 3), round(mitad + (b - a - lim) / 2, 3)))
    if not tramos:
        print("No hay pausas que acortar.")
        return
    copia_de_seguridad(ruta)
    x, sr = leer_wav(ruta)
    escribir_wav(ruta, quitar_tramos(x, sr, tramos), sr)
    print(f"Acortadas {len(tramos)} pausas: {sum(b - a for a, b in tramos):.2f} s menos.")
    guardar(corto, mover_tiempos(pal, tramos))


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] not in ("buscar", "preparar", "cortar", "apretar"):
        print(__doc__ or open(__file__, encoding="utf-8").read().split("import")[0])
        sys.exit(1)
    if a[0] == "buscar":
        buscar()
    elif a[0] == "preparar" and len(a) >= 3:
        preparar(a[1], a[2])
    elif a[0] == "cortar" and len(a) >= 3:
        cortar(a[1], a[2:])
    elif a[0] == "apretar" and len(a) >= 2:
        apretar(a[1], *(float(v) for v in a[2:4]))
    else:
        sys.exit("Faltan datos. Mira las instrucciones al principio de herramientas/voz.py")
