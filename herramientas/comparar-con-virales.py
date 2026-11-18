# «Compáralo con los cortos virales y arréglalo»: mide tus fotogramas con las mismas medidas que se tomaron de 20
# cortos virales del mismo estilo (referencias/medidas-cortos-virales.json) y dice, en lenguaje llano, qué se sale
# del rango y qué tocar en el código para arreglarlo.
#
# Uso:
#   python herramientas/comparar-con-virales.py salida/<corto>/escenas            (todas las escenas de una carpeta)
#   python herramientas/comparar-con-virales.py escena-03.jpg escena-05.jpg       (escenas sueltas)
# Opciones:
#   --json <archivo>   guarda también el resultado en JSON
#   --regla <carpeta>  guarda copias con una regla del 5 % del alto para estimar a ojo el tamaño del personaje
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8")
AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
import medidas as M  # noqa: E402

REF = json.load(open(os.path.join(RAIZ, "referencias", "medidas-cortos-virales.json"), encoding="utf-8"))

NOMBRE = {
    "brillo_medio": "Brillo", "contraste": "Contraste", "negros_p2": "Oscuros", "blancos_p98": "Claros",
    "saturacion": "Saturación", "croma_p90": "Colores intensos", "colorido": "Colorido",
    "lineas_densidad": "Cantidad de líneas de tinta", "lineas_grosor_1080": "Grosor de las líneas",
    "arriba_vs_abajo": "Cielo claro sobre suelo", "cielo_azul": "Cielo azul arriba",
    "sombras_azuladas": "Sombras azuladas", "luces_calidas": "Luces cálidas",
}
# medidas que solo informan (en los virales varían mucho de una escena a otra): no cuentan para las prioridades
SOLO_INFORMA = {"cielo_azul", "sombras_azuladas", "luces_calidas"}

# qué tocar (archivos de src/videos/<corto>/, que salen de la plantilla del galeón)
ARREGLO = {
    ("brillo_medio", "bajo"): "Más luz: sube `lit` (luz directa) y `lift` (relleno de sombras) del preset de luz de esa escena en lights.ts, o los valores medios de la curva `ky` en grade.ts.",
    ("brillo_medio", "alto"): "Menos luz: baja `lit` o `sunI` en lights.ts, o la curva `ky` en grade.ts. Comprueba que el cielo no se coma la imagen.",
    ("contraste", "bajo"): "Más diferencia entre luz y sombra: baja `shade` y `lift` en lights.ts (sombras más profundas) o pon la curva `ky` de grade.ts más en S.",
    ("contraste", "alto"): "Suaviza: sube `shade` y `lift` en lights.ts para que las sombras no sean tan duras.",
    ("negros_p2", "alto"): "Faltan oscuros de verdad: tinta más oscura (`INK` en lights.ts), sombras más profundas (`shade`) o algún objeto oscuro en primer plano.",
    ("negros_p2", "bajo"): "Negros aplastados: sube `lift` en lights.ts o el primer valor de `ky` en grade.ts.",
    ("blancos_p98", "bajo"): "Faltan claros: caras, nubes, espuma o brillos más claros; sube `sunI`/`lit` en lights.ts o el final de la curva `ky` en grade.ts.",
    ("blancos_p98", "alto"): "Zonas quemadas: baja `sunI` en lights.ts o la intensidad del brillo (makeBloom en el archivo principal del corto).",
    ("saturacion", "bajo"): "Colores más vivos: sube `sat` del LOOK de esa luz en lights.ts y `sat` en grade.ts; colores base más puros en paint.ts y build.ts.",
    ("saturacion", "alto"): "Colores pasados de rosca: baja `sat` del LOOK en lights.ts o en grade.ts; evita paredes iluminadas en limón o lavanda.",
    ("croma_p90", "bajo"): "A los colores fuertes les falta fuerza: algún elemento muy saturado (ropa, bandera, cofre, toldo) en paint.ts/build.ts/toon.ts, o más `sat` en grade.ts.",
    ("croma_p90", "alto"): "Hay colores demasiado chillones: baja la saturación de ese objeto en paint.ts/build.ts o `sat` de luces en grade.ts.",
    ("colorido", "bajo"): "La escena es de un solo color: mete un contraste de color (objeto cálido sobre fondo frío o al revés) y más `sat` en lights.ts/grade.ts.",
    ("colorido", "alto"): "Demasiados colores fuertes a la vez: baja `sat` en lights.ts/grade.ts o deja un color dominante por escena.",
    ("lineas_densidad", "bajo"): "Faltan líneas de tinta en el mundo 3D: en ink.ts (DEF) sube `widthNear`/`widthFar` y baja `depthLo`/`angleLo` para que más bordes lleven línea; comprueba que los objetos no estén en la capa NOINK.",
    ("lineas_densidad", "alto"): "Demasiadas rayas: sube `angleLo`/`depthLo` en ink.ts o quita detalle pequeño (hierba, olas, cuerdas) que llena la imagen de líneas.",
    ("lineas_grosor_1080", "bajo"): "Líneas demasiado finas: sube `widthNear` y `widthFar` en ink.ts (DEF).",
    ("lineas_grosor_1080", "alto"): "Líneas demasiado gordas: baja `widthNear` y `widthFar` en ink.ts (DEF).",
    ("arriba_vs_abajo", "bajo"): "La parte de arriba está más oscura que el suelo: cielo más claro (LOOK.sky en lights.ts) o cámara un poco más baja mirando hacia arriba (CAMS en story.ts).",
    ("arriba_vs_abajo", "alto"): "Demasiado cielo o suelo muy oscuro: encuadra más suelo y personajes (cámara en story.ts) o aclara el suelo.",
    ("cielo_azul", "alto"): "Los virales enseñan poco cielo azul: llenan el cuadro con personajes y objetos. Acerca la cámara o baja el horizonte.",
    ("sombras_azuladas", "bajo"): "En la guía de estilo las sombras son azul-violeta, nunca marrones: pon más azul en `shade` y `lift` de lights.ts.",
    ("luces_calidas", "bajo"): "Luz fría: en la guía de estilo la luz principal es cálida (sube el rojo de `lit` y `sunCol` en lights.ts).",
}


def rango(nivel, k):
    r = REF[nivel][k]
    return r["p10"], r["p90"]


def veredicto(v, lo, hi):
    if v < lo:
        return "bajo", (lo - v) / max(hi - lo, 1e-6)
    if v > hi:
        return "alto", (v - hi) / max(hi - lo, 1e-6)
    return "ok", 0.0


def fmt(k, v):
    if k in ("lineas_densidad", "cielo_azul"):
        return f"{v:.1f} %"
    if k in ("croma_p90", "colorido", "sombras_azuladas", "luces_calidas"):
        return f"{v:.0f}"
    if k == "lineas_grosor_1080":
        return f"{v:.1f} px"
    return f"{v:.2f}"


def regla(ruta, carpeta):
    im = Image.open(ruta).convert("RGB")
    d = ImageDraw.Draw(im)
    w, h = im.size
    for k in range(1, 20):
        y = round(h * k / 20)
        L = max(6, w // 30) * (2 if k % 2 == 0 else 1)
        d.line([(0, y), (L, y)], fill=(255, 0, 255), width=max(2, w // 270))
        d.line([(w - L, y), (w, y)], fill=(255, 0, 255), width=max(2, w // 270))
        if k % 2 == 0:
            d.text((L + 4, y - 6), f"{k * 5}%", fill=(255, 0, 255))
    os.makedirs(carpeta, exist_ok=True)
    im.save(os.path.join(carpeta, "regla-" + os.path.basename(ruta)), quality=88)


def main(argv):
    rutas, json_out, carpeta_regla = [], None, None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--json":
            json_out = argv[i + 1]; i += 2; continue
        if a == "--regla":
            carpeta_regla = argv[i + 1]; i += 2; continue
        if os.path.isdir(a):
            rutas += [os.path.join(a, f) for f in sorted(os.listdir(a))
                      if f.lower().endswith((".jpg", ".jpeg", ".png")) and not f.lower().startswith(("hoja", "regla-", "comparacion"))]
        elif os.path.isfile(a):
            rutas.append(a)
        else:
            print(f"No encuentro: {a}")
        i += 1
    if not rutas:
        sys.exit("Dime qué fotogramas comparar: una carpeta (p. ej. salida/<corto>/escenas) o imágenes sueltas.")

    medidas = [M.medir(r) for r in rutas]
    claves = M.ORDEN

    print(f"\nCOMPARACIÓN CON 20 CORTOS VIRALES DEL MISMO ESTILO ({len(rutas)} fotograma/s)\n")
    print("1) EL CORTO EN CONJUNTO (mediana de tus escenas frente a la mediana de cada corto viral)")
    conjunto, prioridades = {}, []
    for k in claves:
        v = float(np.median([m[k] for m in medidas]))
        lo, hi = rango("por_corto", k)
        ver, dist = veredicto(v, lo, hi)
        conjunto[k] = {"tuyo": round(v, 4), "virales_p10": lo, "virales_p90": hi, "veredicto": ver}
        marca = "OK  " if ver == "ok" else ("BAJO" if ver == "bajo" else "ALTO")
        extra = "  (solo informa)" if k in SOLO_INFORMA else ""
        print(f"   [{marca}] {NOMBRE[k]:30s} tuyo {fmt(k, v):>8s}   virales {fmt(k, lo)} a {fmt(k, hi)}{extra}")
        if ver != "ok" and k not in SOLO_INFORMA:
            prioridades.append((dist, k, ver))

    print("\n2) ESCENA POR ESCENA (solo lo que se sale de lo normal en un fotograma viral suelto)")
    escenas = []
    for r, m in zip(rutas, medidas):
        fallos = []
        for k in claves:
            if k in SOLO_INFORMA:
                continue
            lo, hi = rango("por_fotograma", k)
            ver, dist = veredicto(m[k], lo, hi)
            if ver != "ok":
                fallos.append({"medida": k, "valor": m[k], "veredicto": ver, "virales_p10": lo, "virales_p90": hi})
        escenas.append({"archivo": os.path.basename(r), "medidas": m, "fuera_de_rango": fallos})
        if fallos:
            txt = "; ".join(f"{NOMBRE[f['medida']].lower()} {f['veredicto']} ({fmt(f['medida'], f['valor'])})" for f in fallos)
            print(f"   {os.path.basename(r)}: {txt}")
        else:
            print(f"   {os.path.basename(r)}: dentro de lo normal")

    print("\n3) QUÉ ARREGLAR PRIMERO")
    prioridades.sort(reverse=True)
    if not prioridades:
        print("   En conjunto, todas las medidas principales caen dentro del rango de los virales.")
        print("   Si aun así no te gusta, mira la imagen: composición, tamaño del personaje y si se entiende la historia.")
    for n, (dist, k, ver) in enumerate(prioridades[:3], 1):
        print(f"   {n}. {NOMBRE[k]} {ver}: {ARREGLO.get((k, ver), 'revisa lights.ts y grade.ts')}")
    for k in SOLO_INFORMA:
        if conjunto[k]["veredicto"] != "ok" and (k, conjunto[k]["veredicto"]) in ARREGLO:
            print(f"   Nota: {ARREGLO[(k, conjunto[k]['veredicto'])]}")

    pe = REF["personaje_en_cuadro"]
    print("\n4) TAMAÑO DEL PERSONAJE (no se mide solo: míralo en la imagen)")
    print(f"   En los virales la cabeza del personaje principal ocupa de mediana el {pe['altura_cabeza_en_porcentaje_del_alto']['mediana']} % "
          f"del alto (la mitad de los planos entre {pe['altura_cabeza_en_porcentaje_del_alto']['p25']} y "
          f"{pe['altura_cabeza_en_porcentaje_del_alto']['p75']} %). Primeros planos: cabeza del 25 % o más.")
    if carpeta_regla:
        for r in rutas:
            regla(r, carpeta_regla)
        print(f"   Copias con regla del 5 % en: {carpeta_regla}")

    if json_out:
        os.makedirs(os.path.dirname(os.path.abspath(json_out)), exist_ok=True)
        with open(json_out, "w", encoding="utf-8") as fh:
            json.dump({"conjunto": conjunto, "escenas": escenas,
                       "prioridades": [{"medida": k, "veredicto": v, "arreglo": ARREGLO.get((k, v), "")} for _, k, v in prioridades]},
                      fh, ensure_ascii=False, indent=1)
        print(f"\nResultado guardado en {json_out}")


if __name__ == "__main__":
    main(sys.argv[1:])
