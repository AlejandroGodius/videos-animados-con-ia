# Crea referencias/medidas-cortos-virales.json a partir de los fotogramas de referencia de la skill original
# (carpeta references/ de "cartoon-3d-short" de Mr omi). Esos fotogramas son de un canal de terceros: NO se copian
# a este proyecto ni se publican. Este script solo los lee en local y guarda NÚMEROS.
#
# Uso (solo hace falta si quieres rehacer las medidas; el JSON ya viene hecho):
#   python herramientas/medir-referencias.py [carpeta references de la skill]
# Por defecto busca ~/.claude/skills/cartoon-3d-short/references
import json
import os
import sys
from datetime import date

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
import medidas as M  # noqa: E402

ref = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.expanduser("~"), ".claude", "skills", "cartoon-3d-short", "references")
fr_dir, sh_dir = os.path.join(ref, "frames"), os.path.join(ref, "sheets")
if not (os.path.isdir(fr_dir) and os.path.isdir(sh_dir)):
    sys.exit(f"No encuentro {fr_dir} y {sh_dir}. Instala la skill original o pasa su carpeta references.")

# 1) fotogramas completos (540x960): color + líneas
fotos = sorted(f for f in os.listdir(fr_dir) if f.lower().endswith(".jpg"))
por_foto, corto_de_foto = [], []
for f in fotos:
    por_foto.append(M.medir(os.path.join(fr_dir, f), lineas=True))
    corto_de_foto.append(f.split("_")[0])
print(f"{len(fotos)} fotogramas completos medidos")

# 2) hojas de contacto: 60 miniaturas por corto (10 columnas x 6 filas), solo medidas de color
hojas = sorted(f for f in os.listdir(sh_dir) if f.lower().endswith(".jpg"))
por_mini, corto_de_mini = [], []
for f in hojas:
    im = Image.open(os.path.join(sh_dir, f)).convert("RGB")
    W, H = im.size
    tw, th = W // 10, H // 6
    for r in range(6):
        for c in range(10):
            tile = im.crop((c * tw, r * th, (c + 1) * tw, (r + 1) * th))
            if tile.size != M.MINI:
                tile = tile.resize(M.MINI, Image.LANCZOS)
            por_mini.append(M.medidas_color(np.asarray(tile, np.float32) / 255.0))
            corto_de_mini.append(f.split("_")[0])
print(f"{len(hojas)} cortos, {len(por_mini)} miniaturas medidas")


def por_corto(valores, cortos, k):
    grupos = {}
    for v, c in zip(valores, cortos):
        grupos.setdefault(c, []).append(v[k])
    return [float(np.median(g)) for g in grupos.values()]


fotograma, corto = {}, {}
for k in M.ORDEN:
    if k in M.MEDIDAS_COLOR:
        fotograma[k] = M.resumen([v[k] for v in por_mini])
        corto[k] = M.resumen(por_corto(por_mini, corto_de_mini, k))
    else:
        vals = [v[k] for v in por_foto if v[k] > 0 or k != "lineas_grosor_1080"]
        fotograma[k] = M.resumen(vals)
        corto[k] = M.resumen(por_corto([v for v in por_foto if v[k] > 0 or k != "lineas_grosor_1080"],
                                       [c for v, c in zip(por_foto, corto_de_foto) if v[k] > 0 or k != "lineas_grosor_1080"], k))

# 3) nuestro galeón, para tener al lado una referencia que sí es nuestra
gal_dir = os.path.join(RAIZ, "referencias", "galeon")
gal = [M.medir(os.path.join(gal_dir, f)) for f in sorted(os.listdir(gal_dir)) if f.lower().endswith(".jpg")]
galeon = {k: round(float(np.median([g[k] for g in gal])), 4) for k in M.ORDEN}

datos = {
    "que_es": "Medidas de 20 cortos virales del estilo 'personajes 2D planos en un mundo 3D con líneas de tinta'. "
              "Solo hay números: los fotogramas originales son de un canal de terceros y no se incluyen ni se nombran.",
    "fecha": date.today().isoformat(),
    "como_se_midio": {
        "material": f"{len(por_mini)} miniaturas (60 por corto, {len(hojas)} cortos) para el color y {len(fotos)} fotogramas completos "
                    "de 540x960 para las líneas de tinta.",
        "metodo": "herramientas/medidas.py: imagen a 540x960, franja de subtítulos (55-80 % del alto) tapada, mismas medidas "
                  "que aplica herramientas/comparar-con-virales.py a tus fotogramas.",
        "por_fotograma": "Reparto de cada medida entre fotogramas sueltos (p10 = el 10 % más bajo, p90 = el 10 % más alto). "
                         "Sirve para juzgar una escena suelta: fuera de p10-p90 es raro.",
        "por_corto": "Reparto de la mediana de cada corto. Sirve para juzgar el corto entero: la mediana de tus escenas debería "
                     "caer entre p10 y p90.",
    },
    "descripcion": M.DESCRIPCION,
    "por_fotograma": fotograma,
    "por_corto": corto,
    "galeon_nuestro_mediana": galeon,
    # No se puede medir solo con código sin un detector de personajes: se estimó a ojo, con una regla del 5 % del alto
    # pintada sobre cada uno de los 38 fotogramas completos (18-nov-2026). Es una ESTIMACIÓN, no una medida automática.
    "personaje_en_cuadro": {
        "metodo": "Estimación visual con regla (marcas cada 5 % del alto) sobre los 38 fotogramas completos. No es medida automática.",
        "fotogramas_con_personaje": 27,
        "fotogramas_sin_personaje_claro": 11,
        "altura_cabeza_en_porcentaje_del_alto": {"p25": 10, "mediana": 15, "p75": 20},
        "tipos_de_plano": {"general (cabeza de 8 % o menos)": 5, "medio (cabeza 9-24 %)": 18, "primer plano (cabeza 25 % o más)": 4},
        "lectura": "El personaje principal suele tener la cabeza en torno al 15 % del alto de la pantalla; con 3,5 cabezas de "
                   "alto, el cuerpo entero ocupa más o menos la mitad de la pantalla. Casi 1 de cada 3 fotogramas no tiene "
                   "personaje: son objetos de la historia en primer plano (carteles, billetes, máquinas) o planos generales.",
    },
    "otros_datos": {
        "nota": "Datos de la guía de estilo y los informes de la skill original (Mr omi, MIT), medidos por su autor sobre los "
                "mismos 20 cortos. Están en inglés en el original; aquí resumidos.",
        "formato": "Vertical 1080x1920, 30 fps, 31-78 s (mediana ~60 s). La voz empieza en el fotograma 1-4: sin intro, sin logo, sin despedida.",
        "voz": "3,5-4,1 palabras por segundo (mediana 3,7, en inglés). Casi sin pausas: los huecos de más de 0,25 s suman menos de 1 s por vídeo.",
        "sonido": "-14 LUFS integrados, rango de sonoridad ~2,4 LU. Música y efectos solo 5-10 dB por debajo de la voz.",
        "subtitulos": "Una palabra (a veces 2-3) cada vez, blanca, gruesa, con borde negro fino, en la parte media-baja, cambio seco en cada palabra.",
        "guion": "20 de 20 siguen la fórmula: 1) gancho = paradoja contada como hecho, en la primera frase, sin presentación "
                 "(10-16 palabras); 2) situación en 1-2 frases con detalles concretos; 3) escalada en 3-6 pasos; 4) un momento "
                 "de misterio o pregunta; 5) giro con la explicación real, a menudo con una comparación cotidiana; 6) remate "
                 "irónico en las 1-2 últimas frases: el vídeo acaba en la última palabra. Frases de ~13,5 palabras de mediana.",
        "tinta_mundo": "Líneas del mundo 3D de ~3 px a 1080 de ancho (mediana 3,09 px en saltos de profundidad, 3,04 en siluetas "
                       "contra el cielo, 2,17 en pliegues), casi negras, del mismo grosor cerca y lejos. Sin línea en uniones "
                       "pared-suelo ni en el horizonte del mar.",
        "tinta_personajes": "Contorno de personajes de ~4,6 px a 1080, color ciruela oscuro (#201628-#2f1d28), más grueso abajo y en el lado de sombra.",
        "personajes": "Unas 3,5 cabezas de alto, piernas de una sola línea, cabeza en forma de judía (alto/ancho ~0,93), caras "
                      "claras (brillo ~0,93), sin coloretes ni brillos en los ojos. Parpadeo cada 0,5-2,3 s.",
        "camara": "Casi nunca quieta: el 65 % de los fotogramas se mueve; en los momentos quietos sigue acercándose despacio "
                  "(0,14 %/fotograma de mediana). Cortes secos solo en saltos grandes; movimientos suaves de 18-40 fotogramas; "
                  "sacudidas en los impactos.",
        "profundidad": "Fondo desenfocado en ~1/3 del tiempo (primeros planos y planos medios); los planos generales, nítidos.",
        "color_guia": "Medianas por vídeo: brillo medio 0,43-0,54, desviación 0,21-0,29, colores muy saturados. Luz cálida y "
                      "sombras azul-violeta; al atardecer, horizonte melocotón y sombras violetas, nunca marrones.",
    },
}
os.makedirs(os.path.join(RAIZ, "referencias"), exist_ok=True)
salida = os.path.join(RAIZ, "referencias", "medidas-cortos-virales.json")
with open(salida, "w", encoding="utf-8") as fh:
    json.dump(datos, fh, ensure_ascii=False, indent=1)
print("Guardado", salida)
for k in M.ORDEN:
    c = corto[k]
    print(f"{k:20s} corto p10-p90 {c['p10']:.3f}-{c['p90']:.3f} | fotograma p10-p90 {fotograma[k]['p10']:.3f}-{fotograma[k]['p90']:.3f} | galeón {galeon[k]:.3f}")
