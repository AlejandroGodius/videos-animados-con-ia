# Subtítulos de una palabra (como los cortos virales): Arial Black blanca, borde negro, pequeño efecto "pop" al entrar.
# Lee cortos/<corto>/words.json (tiempos de la voz) y, si existe, el guion de cortos/<corto>/GUION.md para escribir
# cada palabra bien (tildes, mayúsculas, números, nombres). Escribe cortos/<corto>/subtitulos.ass.
#
#   python herramientas/subtitulos.py <corto> [--mayusculas]
import difflib
import json
import os
import re
import sys
import unicodedata

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CABECERA = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Palabra,Arial Black,112,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,7,3,2,60,60,560,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
POP = r"{\fscx88\fscy88\t(0,70,\fscx100\fscy100)}"


def norm(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "", s)


def tiempo(t):
    t = max(0.0, t)
    h, r = divmod(t, 3600)
    m, s = divmod(r, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def leer_guion(corto):
    ruta = os.path.join(RAIZ, "cortos", corto, "GUION.md")
    if not os.path.isfile(ruta):
        return None
    txt = open(ruta, encoding="utf-8").read()
    m = re.search(r"^##\s*Guion[^\n]*\n(.*?)(?=^##\s|\Z)", txt, re.S | re.M)
    return m.group(1).split() if m else None


def main(corto, mayus=False):
    ruta = os.path.join(RAIZ, "cortos", corto, "words.json")
    if not os.path.isfile(ruta):
        sys.exit(f"No encuentro {ruta}. Primero hay que preparar la voz (herramientas/voz.py preparar).")
    pal = json.load(open(ruta, encoding="utf-8"))
    textos = [w["word"] for w in pal]
    guion = leer_guion(corto)
    if guion:
        # se escribe como en el guion cuando la palabra coincide (misma palabra sin tildes ni signos)
        g = [t for t in guion if norm(t)]
        sm = difflib.SequenceMatcher(a=[norm(t) for t in g], b=[norm(t) for t in textos], autojunk=False)
        cambios = 0
        for op, a1, a2, b1, b2 in sm.get_opcodes():
            if op == "equal" or (op == "replace" and a2 - a1 == b2 - b1):
                for k in range(a2 - a1):
                    gk, tk = g[a1 + k], textos[b1 + k]
                    # en los cambios, solo si se parecen (p. ej. «galleón» -> «galeón»), nunca otra palabra distinta
                    if op == "replace" and difflib.SequenceMatcher(a=norm(gk), b=norm(tk)).ratio() < 0.75:
                        continue
                    if tk != gk:
                        cambios += 1
                    textos[b1 + k] = gk
        print(f"Escritura tomada del guion: {cambios} palabras corregidas.")
    lineas = [CABECERA]
    for i, w in enumerate(pal):
        ini = w["start"]
        sig = pal[i + 1]["start"] if i + 1 < len(pal) else None
        fin = sig if sig is not None and sig - w["end"] < 0.4 else w["end"] + 0.2
        fin = max(fin, ini + 0.12)
        txt = textos[i].upper() if mayus else textos[i]
        lineas.append(f"Dialogue: 0,{tiempo(ini)},{tiempo(fin)},Palabra,,0,0,0,,{POP}{txt}\n")
    salida = os.path.join(RAIZ, "cortos", corto, "subtitulos.ass")
    with open(salida, "w", encoding="utf-8") as fh:
        fh.writelines(lineas)
    print(f"Subtítulos: {len(pal)} palabras en cortos/{corto}/subtitulos.ass")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("Uso: python herramientas/subtitulos.py <corto> [--mayusculas]")
    main(sys.argv[1], "--mayusculas" in sys.argv)
