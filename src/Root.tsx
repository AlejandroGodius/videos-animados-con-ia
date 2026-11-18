import React from "react";
import { Composition } from "remotion";
import { GaleonShort, GALEON_FRAMES } from "./videos/galeon/Galeon";
import { Cubo3D } from "./diagnostico/Cubo3D";

// Cada corto es una "composición" de Remotion: 1080x1920 (vertical), 30 fotogramas por segundo.
// Para un corto nuevo: copia src/videos/galeon a src/videos/<nombre>, importa aquí su componente
// y añade una línea <Composition id="<Nombre>Short" ... /> igual que la del galeón.
export const Root: React.FC = () => (
  <>
    <Composition id="GaleonShort" component={GaleonShort} durationInFrames={GALEON_FRAMES} fps={30} width={1080} height={1920} />
    {/* Prueba mínima de 3D para el diagnóstico de «me sale en blanco» (herramientas/diagnostico.mjs) */}
    <Composition id="Diagnostico3D" component={Cubo3D} durationInFrames={30} fps={30} width={1080} height={1920} />
  </>
);
