// «Limpia lo que sobra»: borra lo que se puede volver a generar y conserva los vídeos finales.
//
//   npm run limpiar -- --simular          solo dice qué borraría y cuánto ocupa (no borra nada)
//   npm run limpiar                       borra
//   npm run limpiar -- --tambien-sistema  además borra restos de Remotion en la carpeta temporal del sistema
//
// Borra: .temporales/ (copias del proyecto que hace Remotion en cada render y perfiles del navegador),
//        todo lo de salida/ que no sea un vídeo final (" - final.mp4"): fotogramas, hojas, pruebas, mezclas de audio,
//        las cachés de audio/<corto>/_cache y las carpetas __pycache__.
// NO toca: src/, public/ (voces y modelos 3D), cortos/ (guiones, tiempos, subtítulos), node_modules, .venv,
//          ni el modelo de transcripción descargado.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RAIZ, tamanoCarpeta, mb } from "./entorno.mjs";

const flags = new Set(process.argv.slice(2));
const simular = flags.has("--simular");
const sistema = flags.has("--tambien-sistema");
const borrar = []; // [ruta, bytes]

const anadir = (p) => { if (fs.existsSync(p)) borrar.push([p, tamanoCarpeta(p)]); };

// 1) temporales de Remotion del proyecto
const tmp = path.join(RAIZ, ".temporales");
if (fs.existsSync(tmp)) for (const n of fs.readdirSync(tmp)) anadir(path.join(tmp, n));

// 2) salida/: todo menos los vídeos finales
const esFinal = (n) => / - final\.mp4$/i.test(n);
const recorrer = (dir) => {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    const st = fs.lstatSync(p);
    if (st.isDirectory()) {
      const dentro = fs.readdirSync(p, { recursive: true }).some((x) => esFinal(String(x)));
      if (dentro) recorrer(p);
      else anadir(p);
    } else if (!esFinal(n)) anadir(p);
  }
};
const salida = path.join(RAIZ, "salida");
if (fs.existsSync(salida)) recorrer(salida);

// 3) cachés de Python
const audio = path.join(RAIZ, "audio");
if (fs.existsSync(audio)) for (const c of fs.readdirSync(audio)) {
  anadir(path.join(audio, c, "_cache"));
  anadir(path.join(audio, c, "__pycache__"));
}
anadir(path.join(RAIZ, "herramientas", "__pycache__"));

// 4) opcional: restos de Remotion en la carpeta temporal del sistema (de renders hechos sin la carpeta del proyecto)
const sysTmp = os.tmpdir();
const restosSistema = fs.existsSync(sysTmp)
  ? fs.readdirSync(sysTmp).filter((n) => /^(remotion-webpack-bundle-|puppeteer_dev_chrome_profile-|remotion-)/.test(n)).map((n) => path.join(sysTmp, n))
  : [];
if (sistema) for (const p of restosSistema) anadir(p);

const total = borrar.reduce((s, [, b]) => s + b, 0);
if (!borrar.length) {
  console.log("No hay nada que limpiar.");
} else {
  console.log(`${simular ? "Se borraría" : "Borrando"} (${borrar.length} elementos, ${mb(total)}):`);
  for (const [p, b] of borrar.slice(0, 40)) console.log(`  ${mb(b).padStart(10)}  ${path.relative(RAIZ, p) || p}`);
  if (borrar.length > 40) console.log(`  ... y ${borrar.length - 40} más`);
  if (!simular) {
    let fallos = 0;
    for (const [p] of borrar) {
      try { fs.rmSync(p, { recursive: true, force: true }); } catch { fallos++; }
    }
    console.log(`\nEspacio liberado: ${mb(total)}${fallos ? ` (${fallos} elementos no se pudieron borrar: ¿hay algo abierto?)` : ""}`);
  }
}
const finales = fs.existsSync(salida) ? fs.readdirSync(salida, { recursive: true }).map(String).filter(esFinal) : [];
if (finales.length) console.log(`Vídeos finales conservados: ${finales.map((f) => "salida/" + f.replace(/\\/g, "/")).join(", ")}`);
if (!sistema && restosSistema.length) {
  const t = restosSistema.reduce((s, p) => s + tamanoCarpeta(p), 0);
  console.log(`\nEn la carpeta temporal del sistema hay ${restosSistema.length} restos de Remotion (${mb(t)}). Para borrarlos: npm run limpiar -- --tambien-sistema`);
}
