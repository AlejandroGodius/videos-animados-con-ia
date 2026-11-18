// El vídeo: imagen (Remotion) + sonido (mezcla con música o, si aún no hay, solo la voz) + subtítulos de una palabra.
//
//   npm run video -- <corto>             vídeo final 1080x1920 -> salida/<corto>/<corto> - final.mp4
//   npm run video -- <corto> --prueba    versión rápida a media resolución para revisar ritmos -> salida/<corto>/prueba.mp4
//   Opciones: --sin-subtitulos, --sin-abrir
//   Variables: CONCURRENCIA (imágenes a la vez; por defecto la mitad de los núcleos, máximo 4), GL (modo gráfico)
//
// Sonido: usa salida/<corto>/audio/mix.wav (voz + música + efectos, -14 LUFS, de audio/<corto>/mix.py) si existe;
// si no, public/<corto>/voice.wav normalizada a -14 LUFS. Subtítulos: cortos/<corto>/subtitulos.ass si existe.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RAIZ, carpetaTemporal, navegador, idComposicion, ffmpeg, ffmpegExe, ffmpegTieneSubtitulos, abrir, mb } from "./entorno.mjs";

process.chdir(RAIZ);
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [corto = "galeon"] = args.filter((a) => !a.startsWith("--"));
const prueba = flags.has("--prueba");
const escala = prueba ? 0.5 : 1;
const concurrencia = Number(process.env.CONCURRENCIA) || Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));

if (!ffmpegExe()) {
  console.error("No encuentro ffmpeg, que hace falta para juntar imagen, sonido y subtítulos. Instálalo (README).");
  process.exit(1);
}
const tmp = carpetaTemporal();
const nav = navegador();
const { bundle } = await import("@remotion/bundler");
const { renderMedia, selectComposition } = await import("@remotion/renderer");

const dir = path.join(RAIZ, "salida", corto);
fs.mkdirSync(dir, { recursive: true });
const imagen = path.join(dir, prueba ? "imagen-prueba.mp4" : "imagen.mp4");
const final = path.join(dir, prueba ? "prueba.mp4" : `${corto} - final.mp4`);

console.log(`Corto: ${corto} | ${prueba ? "PRUEBA a 540x960" : "FINAL a 1080x1920"} | ${nav.nombre} | ${concurrencia} a la vez`);
console.log("Preparando el proyecto...");
const t0 = Date.now();
const serveUrl = await bundle({ entryPoint: path.join(RAIZ, "src", "index.ts"), publicDir: path.join(RAIZ, "public") });
const inputProps = { audio: false };
const composition = await selectComposition({ serveUrl, id: idComposicion(corto), inputProps, browserExecutable: nav.browserExecutable, chromiumOptions: nav.chromiumOptions });
const total = composition.durationInFrames;
console.log(`${total} fotogramas (${(total / composition.fps).toFixed(1)} s). Renderizando la imagen...`);
let ultimo = -1;
await renderMedia({
  composition, serveUrl, codec: "h264", outputLocation: imagen, inputProps, muted: true, scale: escala,
  crf: prueba ? 23 : 16, pixelFormat: "yuv420p", imageFormat: "jpeg", jpegQuality: prueba ? 80 : 92, concurrency: concurrencia,
  browserExecutable: nav.browserExecutable, chromiumOptions: nav.chromiumOptions, timeoutInMilliseconds: 240000,
  onProgress: ({ progress, renderedFrames }) => {
    const p = Math.floor(progress * 20) * 5;
    if (p !== ultimo) {
      ultimo = p;
      const seg = (Date.now() - t0) / 1000;
      const resta = progress > 0.02 ? (seg / progress) * (1 - progress) : NaN;
      console.log(`  ${p} % (${renderedFrames}/${total})${Number.isFinite(resta) ? `, quedan unos ${Math.ceil(resta / 60)} min` : ""}`);
    }
  },
});
console.log(`Imagen lista en ${((Date.now() - t0) / 60000).toFixed(1)} min.`);

// sonido
const mezcla = path.join(dir, "audio", "mix.wav");
const voz = path.join(RAIZ, "public", corto, "voice.wav");
let audio, filtroAudio = [];
if (fs.existsSync(mezcla)) {
  audio = mezcla;
  console.log("Sonido: mezcla con música y efectos (salida/" + corto + "/audio/mix.wav).");
} else if (fs.existsSync(voz)) {
  audio = voz;
  filtroAudio = ["-af", "loudnorm=I=-14:TP=-1.5:LRA=7"];
  console.log("Sonido: solo la voz (todavía no hay música; se hace con audio/" + corto + "/mix.py). Normalizada a -14 LUFS.");
} else {
  console.log("AVISO: no hay ni mezcla ni voz. El vídeo saldrá mudo.");
}

// subtítulos
const ass = path.join(RAIZ, "cortos", corto, "subtitulos.ass");
let usarSubs = !flags.has("--sin-subtitulos") && fs.existsSync(ass);
if (usarSubs && !ffmpegTieneSubtitulos()) {
  console.log("AVISO: este ffmpeg no sabe poner subtítulos .ass (le falta libass). En Mac: brew install ffmpeg-full. Sigo sin subtítulos.");
  usarSubs = false;
}
if (!usarSubs && !flags.has("--sin-subtitulos")) console.log("Sin subtítulos (no hay cortos/" + corto + "/subtitulos.ass: se hacen con herramientas/subtitulos.py).");

const a = ["-y", "-v", "error", "-i", imagen];
if (audio) a.push("-i", audio, "-map", "0:v:0", "-map", "1:a:0", ...filtroAudio, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest");
else a.push("-map", "0:v:0");
if (usarSubs) a.push("-vf", "ass=subtitulos.ass", "-c:v", "libx264", "-crf", prueba ? "23" : "18", "-preset", "medium", "-pix_fmt", "yuv420p");
else a.push("-c:v", "copy");
a.push("-movflags", "+faststart", final);
console.log("Juntando imagen, sonido y subtítulos...");
const r = ffmpeg(a, { cwd: path.join(RAIZ, "cortos", corto) });
if (!r.ok) {
  console.error("ffmpeg ha fallado:\n" + r.stderr.slice(-1500));
  process.exit(1);
}
fs.rmSync(imagen, { force: true });

// comprobación de volumen
let lufs = "?";
if (audio) {
  const m = ffmpeg(["-hide_banner", "-nostats", "-i", final, "-af", "ebur128", "-f", "null", "-"]);
  const all = [...(m.stderr || "").matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
  if (all.length) lufs = all[all.length - 1][1];
}
const peso = fs.statSync(final).size;
console.log(`\nHECHO: ${path.relative(RAIZ, final)}`);
console.log(`  ${prueba ? "540x960" : "1080x1920"}, ${(total / composition.fps).toFixed(1)} s, ${mb(peso)}, volumen ${lufs} LUFS (objetivo -14), ${usarSubs ? "con" : "sin"} subtítulos`);
console.log(`  Tiempo total: ${((Date.now() - t0) / 60000).toFixed(1)} min. Carpeta temporal: ${tmp}`);
if (!flags.has("--sin-abrir")) abrir(final);
