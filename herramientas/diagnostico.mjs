// «No me sale» / «me sale en blanco»: revisa todo lo que hace falta y dice qué falla, en lenguaje llano.
//
//   npm run diagnostico               comprobaciones rápidas (versiones, ffmpeg, Python, navegador, espacio)
//   npm run diagnostico -- --render   además hace 3 imágenes de prueba (cubo sin efectos, cubo con efectos, galeón)
//                                     y, si el cubo sale en blanco, prueba otros modos gráficos
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { RAIZ, ES_WIN, ES_MAC, carpetaTemporal, navegador, ffmpegExe, ffmpegTieneSubtitulos, statsImagen } from "./entorno.mjs";

process.chdir(RAIZ);
const conRender = process.argv.includes("--render");
const problemas = [];
const ok = (t) => console.log(`  OK     ${t}`);
const mal = (t, arreglo) => { console.log(`  FALLA  ${t}`); problemas.push(`${t}: ${arreglo}`); };
const aviso = (t) => console.log(`  AVISO  ${t}`);

console.log(`\nDIAGNÓSTICO (${ES_WIN ? "Windows" : ES_MAC ? "Mac" : process.platform}, carpeta ${RAIZ})\n`);

// 1) Node
const [maj] = process.versions.node.split(".").map(Number);
if (maj >= 20) ok(`Node ${process.versions.node}`);
else mal(`Node ${process.versions.node} es antiguo`, "instala Node LTS (Windows: winget install -e --id OpenJS.NodeJS.LTS; Mac: brew install node)");

// 2) piezas del proyecto con las versiones fijadas (con otras versiones el 3D sale en blanco)
const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8"));
if (!fs.existsSync(path.join(RAIZ, "node_modules"))) {
  mal("No están instaladas las piezas del proyecto (node_modules)", "ejecuta npm ci en la carpeta del proyecto");
} else {
  const distintas = [];
  for (const [dep, ver] of Object.entries(pkg.dependencies)) {
    const p = path.join(RAIZ, "node_modules", dep, "package.json");
    const real = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")).version : "falta";
    if (real !== ver) distintas.push(`${dep} ${real} (debe ser ${ver})`);
  }
  if (distintas.length) mal(`Versiones cambiadas: ${distintas.join(", ")}`, "ejecuta npm ci (reinstala las versiones fijadas; no uses npm install ni npm update)");
  else ok("Piezas del proyecto con las versiones fijadas (react 18.3.1, three 0.169.0, postprocessing 6.36.4...)");
}

// 3) ffmpeg
const ff = ffmpegExe();
if (!ff) mal("No hay ffmpeg", ES_WIN ? "winget install -e --id Gyan.FFmpeg" : "brew install ffmpeg");
else {
  ok(`ffmpeg (${ff})`);
  if (ffmpegTieneSubtitulos()) ok("ffmpeg sabe poner subtítulos (.ass)");
  else mal("ffmpeg no sabe poner subtítulos (.ass)", ES_MAC ? "brew install ffmpeg-full" : "instala la versión completa: winget install -e --id Gyan.FFmpeg");
}

// 4) Python del proyecto (voz, música, comparación con los virales)
const py = path.join(RAIZ, ".venv", ES_WIN ? "Scripts/python.exe" : "bin/python");
if (!fs.existsSync(py)) mal("No está el Python del proyecto (.venv)", "créalo e instala requirements.txt (README, instrucciones de instalación)");
else {
  const r = spawnSync(py, ["-c", "import numpy, scipy, PIL, faster_whisper; print('ok')"], { encoding: "utf8" });
  if (r.status === 0) ok("Python del proyecto con numpy, scipy, Pillow y faster-whisper");
  else mal("Al Python del proyecto le faltan paquetes", `${path.relative(RAIZ, py)} -m pip install -r requirements.txt`);
}

// 5) navegador y carpeta temporal
const nav = navegador();
if (ES_WIN && !nav.browserExecutable) aviso("No hay Chrome instalado: se usa el navegador de Remotion. Si sale en blanco, instala Chrome (winget install -e --id Google.Chrome)");
else ok(`Navegador: ${nav.nombre}`);
const tmp = carpetaTemporal();
try {
  const st = fs.statfsSync(tmp);
  const libres = (st.bavail * st.bsize) / 1e9;
  if (libres < 5) mal(`Solo quedan ${libres.toFixed(1)} GB libres`, "libera espacio: npm run limpiar (cada render necesita varios GB)");
  else ok(`Espacio libre: ${libres.toFixed(0)} GB (carpeta temporal ${path.relative(RAIZ, tmp)})`);
} catch {
  aviso("No he podido medir el espacio libre");
}
if (ES_WIN && /onedrive/i.test(RAIZ)) aviso("El proyecto está dentro de OneDrive: puede ir lento o dar errores de archivos bloqueados. Mejor fuera de OneDrive.");

// 6) imágenes de prueba
if (conRender && !problemas.some((p) => /node_modules|Versiones/.test(p))) {
  console.log("\nIMÁGENES DE PRUEBA (tarda 1-2 minutos)");
  const { bundle } = await import("@remotion/bundler");
  const { renderStill, selectComposition } = await import("@remotion/renderer");
  const dir = path.join(RAIZ, "salida", "diagnostico");
  fs.mkdirSync(dir, { recursive: true });
  const serveUrl = await bundle({ entryPoint: path.join(RAIZ, "src", "index.ts"), publicDir: path.join(RAIZ, "public") });
  const errores = [];
  const foto = async (id, frame, props, nombre, gl) => {
    const chromiumOptions = { ...nav.chromiumOptions, ...(gl ? { gl } : {}) };
    const out = path.join(dir, nombre);
    try {
      const composition = await selectComposition({ serveUrl, id, inputProps: props, browserExecutable: nav.browserExecutable, chromiumOptions });
      await renderStill({ composition, serveUrl, frame, output: out, imageFormat: "jpeg", scale: 0.5, inputProps: props, browserExecutable: nav.browserExecutable,
        chromiumOptions, timeoutInMilliseconds: 180000, onBrowserLog: (l) => { if (l.type === "error") errores.push(l.text.slice(0, 200)); } });
      return statsImagen(out);
    } catch (e) {
      errores.push(String(e.message || e).slice(0, 300));
      return null;
    }
  };
  const esCubo = (s) => s && s.centro[0] > 140 && s.centro[1] < 130 && s.centro[2] < 130;
  const cubo = await foto("Diagnostico3D", 10, {}, "cubo.jpg");
  const cuboFx = await foto("Diagnostico3D", 10, { efectos: true }, "cubo-con-efectos.jpg");
  const galeon = await foto("GaleonShort", 400, { audio: false }, "galeon.jpg");
  console.log(`  Cubo sin efectos: ${esCubo(cubo) ? "se ve" : "NO se ve"}`);
  console.log(`  Cubo con efectos: ${esCubo(cuboFx) ? "se ve" : "NO se ve"}`);
  console.log(`  Galeón (escena 4): ${galeon && galeon.desv > 8 ? "se ve" : "NO se ve (sale liso o en blanco)"}`);
  if (!esCubo(cubo)) {
    console.log("  Probando otros modos gráficos...");
    for (const gl of ["swangle", "angle-egl", "egl", "swiftshader"].filter((g) => g !== nav.chromiumOptions.gl)) {
      const s = await foto("Diagnostico3D", 10, {}, `cubo-${gl}.jpg`, gl);
      console.log(`    ${gl}: ${esCubo(s) ? "SE VE" : "no se ve"}`);
      if (esCubo(s)) {
        problemas.push(`El 3D no se ve con "${nav.chromiumOptions.gl}" pero sí con "${gl}": usa la variable GL=${gl} en los comandos (más lento si es swangle o swiftshader). Actualiza también el controlador de la tarjeta gráfica.`);
        break;
      }
    }
    if (!problemas.some((p) => p.includes("GL="))) problemas.push(ES_WIN && !nav.browserExecutable
      ? "El 3D no se ve en ningún modo: instala Chrome (winget install -e --id Google.Chrome) y repite el diagnóstico."
      : "El 3D no se ve en ningún modo: actualiza el controlador de la tarjeta gráfica y el navegador, y repite el diagnóstico.");
  } else if (!esCubo(cuboFx)) {
    problemas.push("El 3D se ve, pero con la cadena de efectos sale en blanco: son las versiones de @react-three/postprocessing / postprocessing. Ejecuta npm ci (no npm install ni npm update).");
  } else if (!(galeon && galeon.desv > 8)) {
    problemas.push("El cubo se ve pero el galeón no: faltan modelos en public/galeon/kenney, el navegador se queda sin memoria o hay un error en el código del corto (mira los errores de abajo).");
  }
  if (errores.length) {
    console.log("  Errores del navegador:");
    for (const e of [...new Set(errores)].slice(0, 6)) console.log("    " + e);
  }
  console.log(`  Imágenes de prueba en ${path.relative(RAIZ, dir)}`);
}

console.log(problemas.length ? "\nQUÉ HAY QUE ARREGLAR:" : "\nTodo en orden.");
problemas.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
if (!conRender) console.log("\nPara probar también que el 3D se pinta: npm run diagnostico -- --render");
