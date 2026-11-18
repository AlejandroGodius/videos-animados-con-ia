// Prueba mínima de 3D: un cubo rojo sobre fondo azul claro.
// - Sin efectos: comprueba que el navegador pinta WebGL (si sale en blanco, el problema es la tarjeta gráfica o el modo "gl").
// - Con efectos (inputProps {"efectos": true}): añade la cadena de posprocesado que usa el galeón. Si sin efectos sale
//   y con efectos no, el problema son las versiones de @react-three/postprocessing / postprocessing (ver CLAUDE.md).
import React, { useMemo } from "react";
import { AbsoluteFill, getInputProps, useCurrentFrame } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { EffectComposer } from "@react-three/postprocessing";
import { ToneMappingEffect, ToneMappingMode } from "postprocessing";

const Escena: React.FC<{ efectos: boolean }> = ({ efectos }) => {
  const f = useCurrentFrame();
  const tone = useMemo(() => new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }), []);
  return (
    <>
      <color attach="background" args={["#cfe3f2"]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 5, 4]} intensity={2} />
      <mesh rotation={[0.5, 0.6 + f * 0.05, 0]}>
        <boxGeometry args={[2.4, 2.4, 2.4]} />
        <meshLambertMaterial color="#e2412b" />
      </mesh>
      {efectos ? (
        <EffectComposer multisampling={4}>
          <primitive object={tone} dispose={null} />
        </EffectComposer>
      ) : null}
    </>
  );
};

export const Cubo3D: React.FC = () => {
  const efectos = (getInputProps() as { efectos?: boolean }).efectos === true;
  return (
    <AbsoluteFill style={{ background: "#ffffff" }}>
      <ThreeCanvas width={1080} height={1920} camera={{ position: [0, 0, 7], fov: 40 }}>
        <Escena efectos={efectos} />
      </ThreeCanvas>
    </AbsoluteFill>
  );
};
