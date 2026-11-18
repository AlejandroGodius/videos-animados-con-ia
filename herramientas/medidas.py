# Medidas de imagen que usan "medir-referencias.py" (para crear referencias/medidas-cortos-virales.json) y
# "comparar-con-virales.py" (para medir los fotogramas del usuario contra esos números).
# Todo se mide igual en los dos lados: la imagen se lleva a 540x960 (líneas de tinta) y a 180x320 (colores), se tapa
# la franja donde los cortos virales llevan los subtítulos quemados (55-80 % del alto) y se calculan los mismos números.
# Solo usa numpy, scipy y Pillow.
import numpy as np
from PIL import Image
from scipy import ndimage

ANCHO, ALTO = 540, 960
FRANJA_SUBTITULOS = (0.55, 0.80)   # parte del alto tapada en todas las medidas
MINI = (180, 320)                  # tamaño al que se miden los colores

# Qué significa cada medida (se copia al JSON y lo usa el comparador para explicarlo en lenguaje llano)
DESCRIPCION = {
    "brillo_medio": "Brillo medio de la imagen (0 = negro, 1 = blanco).",
    "contraste": "Contraste: cuánto se separan claros y oscuros (desviación del brillo).",
    "negros_p2": "Lo oscuro de verdad: brillo del 2 % más oscuro de la imagen.",
    "blancos_p98": "Lo claro de verdad: brillo del 2 % más claro de la imagen.",
    "saturacion": "Saturación media (lo vivos que son los colores).",
    "croma_p90": "Fuerza de los colores más intensos (croma CIELab, percentil 90).",
    "colorido": "Colorido general (índice de Hasler y Süsstrunk).",
    "lineas_densidad": "Parte de la imagen ocupada por líneas de tinta finas y oscuras (en %).",
    "lineas_grosor_1080": "Grosor típico de esas líneas, en píxeles de un vídeo de 1080 de ancho.",
    "arriba_vs_abajo": "Brillo del tercio de arriba dividido por el del cuarto de abajo (cielo claro sobre suelo más oscuro > 1).",
    "cielo_azul": "Parte del tercio de arriba que es azul cielo (en %).",
    "sombras_azuladas": "Color de las sombras: azul menos rojo (positivo = sombras azuladas/violetas, negativo = marrones).",
    "luces_calidas": "Color de las luces: rojo menos azul (positivo = luces cálidas).",
}
ORDEN = list(DESCRIPCION.keys())
MEDIDAS_COLOR = [k for k in ORDEN if not k.startswith("lineas_")]   # válidas también en miniaturas pequeñas


def cargar(ruta_o_imagen):
    """Imagen -> array RGB float 0-1 de 540x960. Si no es vertical 9:16, recorta al centro antes de escalar."""
    im = ruta_o_imagen if isinstance(ruta_o_imagen, Image.Image) else Image.open(ruta_o_imagen)
    im = im.convert("RGB")
    w, h = im.size
    objetivo = ANCHO / ALTO
    if abs(w / h - objetivo) > 0.01:
        if w / h > objetivo:
            nw = round(h * objetivo)
            im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        else:
            nh = round(w / objetivo)
            im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    if im.size != (ANCHO, ALTO):
        im = im.resize((ANCHO, ALTO), Image.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


def _mascara(h, w):
    m = np.ones((h, w), bool)
    m[int(h * FRANJA_SUBTITULOS[0]):int(h * FRANJA_SUBTITULOS[1]), :] = False
    return m


def _luma(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def _hsv(rgb):
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0.0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    dd = np.maximum(d, 1e-6)
    h = np.where(mx == r, ((g - b) / dd) % 6, np.where(mx == g, (b - r) / dd + 2, (r - g) / dd + 4)) * 60.0
    h = np.where(d < 1e-6, 0.0, h)
    return h, s, mx


def _croma(rgb):
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], np.float32)
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883], np.float32)
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    a = 500 * (f[..., 0] - f[..., 1])
    b = 200 * (f[..., 1] - f[..., 2])
    return np.hypot(a, b)


def _rachas(m):
    """longitud de la racha horizontal de píxeles True a la que pertenece cada píxel"""
    out = np.zeros(m.shape, np.int32)
    for i in range(m.shape[0]):
        fila = m[i]
        if not fila.any():
            continue
        d = np.diff(np.concatenate(([0], fila.astype(np.int8), [0])))
        ini, fin = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
        lon = fin - ini
        out[i, fila] = np.repeat(lon, lon)
    return out


def medidas_color(rgb):
    h_, w_ = rgb.shape[:2]
    m = _mascara(h_, w_)
    Y = _luma(rgb)
    y = Y[m]
    hue, sat, val = _hsv(rgb)
    px = rgb[m]
    R, G, B = px[:, 0] * 255, px[:, 1] * 255, px[:, 2] * 255
    rg, yb = R - G, 0.5 * (R + G) - B
    out = {
        "brillo_medio": float(y.mean()),
        "contraste": float(y.std()),
        "negros_p2": float(np.percentile(y, 2)),
        "blancos_p98": float(np.percentile(y, 98)),
        "saturacion": float(sat[m][val[m] > 0.1].mean()) if (val[m] > 0.1).any() else 0.0,
        "croma_p90": float(np.percentile(_croma(rgb)[m], 90)),
        "colorido": float(np.hypot(rg.std(), yb.std()) + 0.3 * np.hypot(rg.mean(), yb.mean())),
    }
    arriba = Y[: int(h_ * 0.30)]
    abajo = Y[int(h_ * 0.80):]   # el cuarto de abajo empieza donde acaba la franja de subtítulos
    out["arriba_vs_abajo"] = float(arriba.mean() / max(abajo.mean(), 1e-3))
    ha, sa, va = hue[: int(h_ * 0.30)], sat[: int(h_ * 0.30)], val[: int(h_ * 0.30)]
    cielo = (ha >= 185) & (ha <= 235) & (sa >= 0.2) & (sa <= 0.9) & (va > 0.55)
    out["cielo_azul"] = float(cielo.mean() * 100)
    som = (y > 0.12) & (y < 0.40)
    out["sombras_azuladas"] = float((B[som] - R[som]).mean()) if som.sum() > 50 else 0.0
    luz = y > 0.65
    out["luces_calidas"] = float((R[luz] - B[luz]).mean()) if luz.sum() > 50 else 0.0
    return out


def medidas_lineas(rgb):
    """Líneas de tinta: se escala a 1080x1920 y se buscan trazos finos más oscuros que lo que les rodea
    (cierre morfológico menos imagen). Ancho = racha más corta (horizontal o vertical) a media altura del trazo."""
    Y = _luma(rgb)
    Y2 = np.asarray(Image.fromarray((Y * 255).astype(np.uint8)).resize((ANCHO * 2, ALTO * 2), Image.BILINEAR), np.float32) / 255
    th = ndimage.grey_closing(Y2, size=(9, 9)) - Y2            # cuánto más oscuro que su entorno (trazos < ~8 px)
    pico = ndimage.maximum_filter(th, size=5)
    linea = (pico > 0.15) & (th > 0.5 * pico)                  # dentro del trazo, a media altura (FWHM)
    m = _mascara(*Y2.shape)
    linea &= m
    dens = float(linea[m].mean() * 100)
    cresta = linea & (th >= ndimage.maximum_filter(th, size=3) - 1e-6)
    if cresta.sum() < 200:
        return {"lineas_densidad": dens, "lineas_grosor_1080": 0.0}
    rh = _rachas(linea)
    rv = _rachas(linea.T).T
    anchos = np.minimum(rh, rv)[cresta]
    anchos = anchos[(anchos >= 1) & (anchos <= 14)]
    grosor = float(np.median(anchos)) if anchos.size else 0.0
    return {"lineas_densidad": dens, "lineas_grosor_1080": grosor}


def miniatura(rgb):
    """540x960 -> 180x320: el color se mide siempre a este tamaño (el de las miniaturas de referencia)"""
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
    return np.asarray(im.resize(MINI, Image.LANCZOS), np.float32) / 255.0


def medir(ruta_o_imagen, lineas=True):
    rgb = cargar(ruta_o_imagen)
    out = medidas_color(miniatura(rgb))
    if lineas:
        out.update(medidas_lineas(rgb))
    return {k: round(out[k], 4) for k in ORDEN if k in out}


def resumen(valores):
    a = np.asarray(valores, float)
    p = np.percentile(a, [10, 25, 50, 75, 90])
    return {"n": int(a.size), "p10": round(float(p[0]), 4), "p25": round(float(p[1]), 4), "mediana": round(float(p[2]), 4),
            "p75": round(float(p[3]), 4), "p90": round(float(p[4]), 4)}
