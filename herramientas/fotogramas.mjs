// Una imagen por escena, para ver cómo queda el corto ANTES de hacer el vídeo (mucho más rápido que renderizarlo).
//
//   npm run fotogramas -- <corto> [qué] [escala]
//     <corto>  carpeta de src/videos (por ejemplo: galeon)
//     [qué]    todas (por defecto) | 3 | 3,5,8 (escenas) | f62,171 (fotogramas exactos)
//     [escala] 0.5 por defecto (540x960, rápido); 1 = tamaño final 1080x1920
//   Opciones: --sin-abrir (no abre la hoja de escenas), --sin-efectos (sin tinta, desenfoque ni color: para diagnosticar)
//
// Deja las imágenes en salida/<corto>/escenas/escena-NN.jpg y una hoja con todas en salida/<corto>/escenas/hoja.jpg
import fs from "node:fs";
import path from "node:path";
import { RAIZ, carpetaTemporal, navegador, idComposicion, escenasDe, ffmpeg, statsImagen, abrir, FPS } from "./entorno.mjs";

process.chdir(RAIZ);
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [corto = "galeon", que = "todas", escalaTxt = "0.5"] = args.filter((a) => !a.startsWith("--"));
const escala = Number(escalaTxt.replace(",", "."));

const tmp = carpetaTemporal();
const nav = navegador();
const { bundle } = await import("@remotion/bundler");
const { renderStill, selectComposition, getCompositions } = await import("@remotion/renderer");

const escenas = escenasDe(corto);
let lista; // [{ nombre, frame, etiqueta }]
if (que.startsWith("f")) {
  lista = que.slice(1).split(",").map(Number).filter((n) => !Number.isNaN(n)).map((f) => ({ nombre: `fotograma-${f}`, frame: f, etiqueta: `fotograma ${f}` }));
} else {
  if (!escenas.length) {
    console.error(`No encuentro las escenas (SHOTS) en src/videos/${corto}/story.ts. Pide fotogramas exactos: f100,200`);
    process.exit(1);
  }
  const ids = que === "todas" ? escenas.map((e) => e.id) : que.split(",").map(Number);
  lista = ids.map((id) => escenas.find((e) => e.id === id)).filter(Boolean)
    .map((e) => ({ nombre: `escena-${String(e.id).padStart(2, "0")}`, frame: e.medio, etiqueta: `escena ${e.id} (fotograma ${e.medio}, segundo ${(e.medio / FPS).toFixed(1)})` }));
}
if (!lista.length) {
  console.error("No hay nada que fotografiar con esa selección.");
  process.exit(1);
}

const dir = path.join(RAIZ, "salida", corto, que.startsWith("f") ? "fotogramas" : "escenas");
fs.mkdirSync(dir, { recursive: true });
console.log(`Corto: ${corto} | ${lista.length} imagen(es) | escala ${escala} | ${nav.nombre}`);
console.log(`Carpeta temporal: ${tmp}`);
console.log("Preparando el proyecto (la primera vez tarda un poco más)...");
const t0 = Date.now();
const serveUrl = await bundle({ entryPoint: path.join(RAIZ, "src", "index.ts"), publicDir: path.join(RAIZ, "public") });
const inputProps = { audio: false, ...(flags.has("--sin-efectos") ? { post: { ink: false, lens: false, pre: false, bloom: false, grade: false } } : {}) };
const id = idComposicion(corto);
let composition;
try {
  composition = await selectComposition({ serveUrl, id, inputProps, browserExecutable: nav.browserExecutable, chromiumOptions: nav.chromiumOptions });
} catch (e) {
  const todas = await getCompositions(serveUrl, { inputProps, browserExecutable: nav.browserExecutable, chromiumOptions: nav.chromiumOptions });
  console.error(`No existe la composición "${id}". Las que hay: ${todas.map((c) => c.id).join(", ")}`);
  console.error("Regístrala en src/Root.tsx o indica el nombre con la variable COMP.");
  process.exit(1);
}
console.log(`Listo en ${((Date.now() - t0) / 1000).toFixed(0)} s. Haciendo imágenes...`);
const errores = [];
const onBrowserLog = (l) => {
  if (l.type === "error") errores.push(l.text.slice(0, 300));
  if (process.env.ALLLOG) console.log(`[${l.type}]`, l.text.slice(0, 300));
};
const hechas = [];
for (const it of lista) {
  const t1 = Date.now();
  const out = path.join(dir, `${it.nombre}.jpg`);
  await renderStill({ composition, serveUrl, frame: Math.min(it.frame, composition.durationInFrames - 1), output: out, imageFormat: "jpeg", jpegQuality: 88, scale: escala,
    browserExecutable: nav.browserExecutable, chromiumOptions: nav.chromiumOptions, timeoutInMilliseconds: 180000, onBrowserLog, inputProps });
  const s = statsImagen(out);
  const aviso = s && s.desv < 4 ? "  AVISO: ha salido casi lisa (¿en blanco?). Mira «No me sale» en CLAUDE.md" : "";
  console.log(`  ${it.etiqueta}: ${((Date.now() - t1) / 1000).toFixed(1)} s -> ${path.relative(RAIZ, out)}${aviso}`);
  hechas.push(out);
}
if (errores.length) {
  console.log(`\nEl navegador avisó de ${errores.length} error(es). Los primeros:`);
  for (const e of [...new Set(errores)].slice(0, 5)) console.log("  " + e);
}

// hoja con todas las imágenes, para verlas de un vistazo
if (hechas.length > 1) {
  const seq = path.join(tmp, "hoja");
  fs.rmSync(seq, { recursive: true, force: true });
  fs.mkdirSync(seq, { recursive: true });
  hechas.forEach((h, i) => fs.copyFileSync(h, path.join(seq, `h_${String(i + 1).padStart(2, "0")}.jpg`)));
  const cols = Math.min(6, hechas.length), filas = Math.ceil(hechas.length / cols);
  const hoja = path.join(dir, "hoja.jpg");
  const r = ffmpeg(["-y", "-v", "error", "-framerate", "1", "-start_number", "1", "-i", path.join(seq, "h_%02d.jpg"),
    "-vf", `scale=270:480,tile=${cols}x${filas}:padding=8:margin=8:color=white`, "-frames:v", "1", "-q:v", "3", hoja]);
  fs.rmSync(seq, { recursive: true, force: true });
  if (r.ok) {
    console.log(`\nHoja con todas las escenas (en orden, de izquierda a derecha): ${path.relative(RAIZ, hoja)}`);
    if (!flags.has("--sin-abrir")) abrir(hoja);
  } else {
    console.log("\nNo he podido hacer la hoja (¿falta ffmpeg?). Las imágenes sueltas están en " + path.relative(RAIZ, dir));
  }
} else if (!flags.has("--sin-abrir")) {
  abrir(hechas[0]);
}
console.log(`Total: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
