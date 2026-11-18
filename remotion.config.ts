// Ajustes de Remotion para "npx remotion studio" y "npx remotion render" en Windows y Mac.
// (Los scripts de herramientas/ hacen lo mismo por su cuenta en herramientas/entorno.mjs.)
import { Config } from "@remotion/cli/config";
import fs from "node:fs";
import path from "node:path";

// 1) Carpeta temporal propia (.temporales/ dentro del proyecto). Cada render copia el proyecto a una carpeta temporal
//    y Remotion no la borra: así no se llena la del sistema y "limpia lo que sobra" la encuentra.
const tmp = process.env.REMOTION_TMP || path.join(process.cwd(), ".temporales");
fs.mkdirSync(tmp, { recursive: true });
process.env.TEMP = tmp;
process.env.TMP = tmp;
process.env.TMPDIR = tmp;

// 2) Navegador. Windows: el Chrome instalado (probado: con él y "angle" el 3D sale bien). Mac: el que descarga Remotion.
if (process.platform === "win32") {
  const candidatos = [
    process.env.CHROME_PATH,
    path.join(process.env.ProgramFiles || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe") : undefined,
  ];
  const chrome = candidatos.find((c) => c && fs.existsSync(c));
  if (chrome) Config.setBrowserExecutable(chrome);
}

// 3) Tarjeta gráfica: "angle" es lo recomendado en ordenadores de escritorio (Windows y Mac).
//    Para probar otro modo: variable GL (swangle = sin tarjeta gráfica, más lento).
const gl = (process.env.GL || "angle") as "angle" | "swangle" | "egl" | "swiftshader" | "vulkan" | "angle-egl";
Config.setChromiumOpenGlRenderer(gl);

// 4) Calidad de imagen de los fotogramas intermedios del vídeo
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
