// Piezas comunes de los scripts: carpeta del proyecto, carpeta temporal, navegador, ffmpeg y abrir archivos.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ES_WIN = process.platform === "win32";
export const ES_MAC = process.platform === "darwin";
export const FPS = 30;

/** Remotion copia el proyecto a una carpeta temporal en cada render y no la borra. La ponemos dentro del proyecto
 *  (.temporales/) para no llenar la del sistema y para que "limpia lo que sobra" la encuentre. */
export function carpetaTemporal() {
  const tmp = process.env.REMOTION_TMP || path.join(RAIZ, ".temporales");
  fs.mkdirSync(tmp, { recursive: true });
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = tmp;
  return tmp;
}

/** Chrome instalado en Windows (o null) */
export function chromeWindows() {
  const c = [
    process.env.CHROME_PATH,
    path.join(process.env.ProgramFiles || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe") : null,
  ];
  return c.find((p) => p && fs.existsSync(p)) || null;
}

/** Windows: Chrome instalado + "angle" (lo que funciona en el portátil donde se probó).
 *  Mac: el navegador que descarga Remotion + "angle" (lo recomendado por Remotion en ordenadores de escritorio).
 *  Variable GL para probar otro modo (swangle = sin tarjeta gráfica, lento). */
export function navegador() {
  const gl = process.env.GL || "angle";
  if (ES_WIN) {
    const exe = chromeWindows();
    return { browserExecutable: exe, chromiumOptions: { gl }, nombre: exe ? `Chrome de Windows (${gl})` : `navegador de Remotion (${gl}, no hay Chrome instalado)` };
  }
  return { browserExecutable: null, chromiumOptions: { gl }, nombre: `navegador de Remotion (${gl})` };
}

/** "galeon" -> "GaleonShort", "mi-pueblo" -> "MiPuebloShort" (se puede forzar con la variable COMP) */
export function idComposicion(corto) {
  if (process.env.COMP) return process.env.COMP;
  return corto.split(/[-_ ]+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("") + "Short";
}

/** Escenas del corto leídas de src/videos/<corto>/story.ts: [{ id, a, b, medio }] (a/b en fotogramas) */
export function escenasDe(corto) {
  const story = path.join(RAIZ, "src", "videos", corto, "story.ts");
  if (!fs.existsSync(story)) return [];
  const txt = fs.readFileSync(story, "utf8");
  const out = [];
  for (const m of txt.matchAll(/\{\s*id:\s*(\d+)\s*,\s*a:\s*(\d+)\s*,\s*b:\s*(\d+)/g)) {
    const [id, a, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    out.push({ id, a, b, medio: Math.floor((a + b) / 2) });
  }
  return out;
}

/** ffmpeg: variable FFMPEG, la versión completa de Homebrew en Mac (trae subtítulos), o el del sistema */
export function ffmpegExe() {
  const c = [process.env.FFMPEG, "/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg", "/usr/local/opt/ffmpeg-full/bin/ffmpeg"];
  const f = c.find((p) => p && fs.existsSync(p));
  if (f) return f;
  const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return r.status === 0 ? "ffmpeg" : null;
}

/** ejecuta ffmpeg y devuelve { ok, stderr } */
export function ffmpeg(args, opciones = {}) {
  const exe = ffmpegExe();
  if (!exe) return { ok: false, stderr: "No encuentro ffmpeg." };
  const r = spawnSync(exe, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opciones });
  return { ok: r.status === 0, stderr: r.stderr || "", stdout: r.stdout || "" };
}

/** ¿este ffmpeg puede quemar subtítulos .ass? */
export function ffmpegTieneSubtitulos() {
  const r = ffmpeg(["-hide_banner", "-filters"]);
  return /\sass\s/.test(r.stdout + r.stderr);
}

/** media y desviación del gris de una imagen (para detectar fotogramas en blanco o lisos) y color del centro */
export function statsImagen(ruta) {
  const r = spawnSync(ffmpegExe() || "ffmpeg", ["-v", "error", "-i", ruta, "-vf", "scale=16:16", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 20 });
  if (r.status !== 0 || !r.stdout || r.stdout.length < 768) return null;
  const b = r.stdout;
  const g = [];
  for (let i = 0; i < 256; i++) g.push(0.299 * b[3 * i] + 0.587 * b[3 * i + 1] + 0.114 * b[3 * i + 2]);
  const media = g.reduce((s, v) => s + v, 0) / g.length;
  const desv = Math.sqrt(g.reduce((s, v) => s + (v - media) ** 2, 0) / g.length);
  const c = (8 * 16 + 8) * 3; // píxel del centro
  return { media, desv, centro: [b[c], b[c + 1], b[c + 2]] };
}

/** abre un archivo con el programa por defecto (visor de fotos, reproductor de vídeo) */
export function abrir(ruta) {
  try {
    if (ES_WIN) spawn("explorer.exe", [path.resolve(ruta)], { detached: true, stdio: "ignore" }).unref();
    else if (ES_MAC) spawn("open", [ruta], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [ruta], { detached: true, stdio: "ignore" }).unref();
  } catch {
    /* si no se puede abrir, no pasa nada: la ruta ya se ha escrito en pantalla */
  }
}

export const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";

export function tamanoCarpeta(ruta) {
  if (!fs.existsSync(ruta)) return 0;
  const st = fs.lstatSync(ruta);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const n of fs.readdirSync(ruta)) total += tamanoCarpeta(path.join(ruta, n));
  return total;
}
