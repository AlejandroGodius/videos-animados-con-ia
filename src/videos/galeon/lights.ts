// Light presets per time of day / place for the San José short. Same contract as the bridge template (shade.ts,
// cardshade.ts, cast.ts read these fields). The sun is CAMERA-RELATIVE and frozen per shot part (world.ts):
// az = degrees from the camera's forward axis (0 = backlight, +90 = screen right, 180 = behind the camera), el = elevation.
// lit/shade/lift are LINEAR RGB multipliers for shade.ts (may exceed 1).
// day/golden/dusk = open Caribbean sea; under = shallow underwater (blue fog, light from the surface);
// deep = 600 m (dark navy, the only light is the ROV's lamps, from behind the camera).
type C3 = [number, number, number];
export type LightName = "day" | "golden" | "dusk" | "under" | "deep";
export type LightPreset = {
  az: number; el: number;
  lit: C3; shade: C3; lift: C3; lambert: number; sideK: number; term: number;      // world two-tone (shade.ts)
  charTint: C3; charShade: number; charGrad: number; bodyGrad: number; sideTint: C3; // character cards (cast.ts)
  blob: C3; actorShadow: boolean;                                                    // contact blobs / card shadows
  top: string; hor: string; skyCurve: C3; fog: string; fogNear: number; fogFar: number; sunDisc: string;
  sunCol: string; sunI: number; sky: string; ground: string; hemiI: number;
  bias: number; normalBias: number;
};
const DAY: LightPreset = {
  az: 75, el: 48,
  lit: [1.58, 1.5, 1.33], shade: [0.62, 0.58, 0.56], lift: [0.03, 0.03, 0.05], lambert: 0.35, sideK: 0.84, term: 0.2, // shade ~0.4x lit, same hue (round 3)
  charTint: [1.0, 0.96, 0.94], charShade: 0.86, charGrad: 0.07, bodyGrad: 0.2, sideTint: [0.92, 0.90, 0.96],
  blob: [0.62, 0.58, 0.58], actorShadow: false,
  top: "#2f78d4", hor: "#c4e2f2", skyCurve: [0.0, 0.5, 0.6], fog: "#c4e2f2", fogNear: 90, fogFar: 1100, sunDisc: "#000000",
  sunCol: "#fff3e0", sunI: 2.8, sky: "#dcecff", ground: "#b49a78", hemiI: 0.55,
  bias: -0.00025, normalBias: 0.015,
};
export const LIGHTS: Record<LightName, LightPreset> = {
  day: DAY,
  // late-afternoon gold, not sunset: sun ahead-right and 14 deg up, so faces still get a lit side
  golden: {
    ...DAY, az: 125, el: 16,
    lit: [1.55, 1.18, 0.8], shade: [0.34, 0.29, 0.42], lift: [0.05, 0.05, 0.12], term: 0.12,
    charTint: [1.0, 0.93, 0.85], charShade: 0.88, charGrad: 0.09, bodyGrad: 0.24, sideTint: [0.86, 0.82, 0.96], // faces stay pale (ref V .99, S .23)
    blob: [0.72, 0.7, 0.86], actorShadow: false,
    top: "#5f6fd8", hor: "#ffcf86", fog: "#ffcf9a", fogNear: 220, fogFar: 2400, sunDisc: "#ffe1a8",
    sunCol: "#ffc27a", sunI: 4.5, bias: -0.0005, normalBias: 0.025,
  },
  // dusk after the sinking: sun on the horizon behind the subject, warm rim, blue-violet everywhere else
  dusk: {
    ...DAY, az: 32, el: 5,
    lit: [1.35, 0.78, 0.52], shade: [0.24, 0.2, 0.38], lift: [0.05, 0.05, 0.16], term: 0.08,
    charTint: [1.0, 0.9, 0.84], charShade: 0.9, charGrad: 0.1, bodyGrad: 0.25, sideTint: [0.8, 0.8, 0.98],
    blob: [0.75, 0.74, 0.9], actorShadow: false,
    top: "#3e4f8f", hor: "#ffb27a", fog: "#eea486", fogNear: 70, fogFar: 950, sunDisc: "#ffc58a",
    sunCol: "#ff9e6a", sunI: 4.0, bias: -0.0006, normalBias: 0.03,
  },
  // underwater: light from the surface (high sun), cyan-lit tops, deep-blue shade, fog = the water colour
  under: {
    ...DAY, az: 40, el: 68,
    lit: [1.12, 1.17, 1.14], shade: [0.36, 0.4, 0.55], lift: [0.03, 0.05, 0.1], lambert: 0.45, term: 0.25, // round 3: keep hull reds
    charTint: [0.92, 0.99, 1.04], charShade: 0.86, charGrad: 0.08, bodyGrad: 0.2, sideTint: [0.85, 0.92, 1.0],
    blob: [0.5, 0.6, 0.75], actorShadow: false,
    top: "#55bfdc", hor: "#126f86", fog: "#126f86", fogNear: 12, fogFar: 88, sunDisc: "#000000",
    sunCol: "#d8f4ff", sunI: 2.4, bias: -0.0004, normalBias: 0.02,
  },
  // 600 m: dark navy, lit only by the ROV lamps from behind the camera
  deep: {
    ...DAY, az: 160, el: 28,
    lit: [1.55, 1.4, 1.15], shade: [0.11, 0.13, 0.24], lift: [0.03, 0.04, 0.09], lambert: 0.55, term: 0.3, // warm ROV lamp light
    charTint: [0.8, 0.85, 0.95], charShade: 0.8, charGrad: 0.08, bodyGrad: 0.2, sideTint: [0.8, 0.85, 1.0],
    blob: [0.4, 0.45, 0.6], actorShadow: false,
    top: "#103a66", hor: "#0a2442", fog: "#0a2442", fogNear: 6, fogFar: 44, sunDisc: "#000000",
    sunCol: "#fff6e0", sunI: 2.0, bias: -0.0004, normalBias: 0.02,
  },
};

/** world-only look per light (sky stops by elevation in degrees, sea colours, cloud palette). All colours are
 *  ON-SCREEN targets under the PBR-Neutral tone map; world.ts pre-inverts the tone map (shade.ts untone). */
export type WorldLook = {
  sky: { c: string[]; e: number[]; below?: string };          // 5 stops by elevation; `below` = colour looking down (underwater)
  water: { near: string; mid: string; far: string; crest: string; trough: string; glint: string; shade: C3 };
  bounce: C3;
  sat: number;
  cloud: { lit: string; mid: string; shade: string };
};
const CLOUD_DAY = { lit: "#fbf8f1", mid: "#e1e5f3", shade: "#c3cbe9" };
export const LOOK: Record<LightName, WorldLook> = {
  day: {
    sky: { c: ["#a8d6f5", "#74b8f2", "#3f97ec", "#2a7fe6", "#1a63d6"], e: [0, 3, 8, 18, 45] },
    // tropical turquoise: light cyan under the lens, deep blue toward the horizon
    water: { near: "#0b6f9e", mid: "#1592bf", far: "#3cb6d8", crest: "#bff2f2", trough: "#06567e", glint: "#ffffff", shade: [0.55, 0.62, 0.76] }, // darker near (ref)
    cloud: CLOUD_DAY, bounce: [0, 0, 0], sat: 1.1,
  },
  golden: {
    sky: { c: ["#ffcf86", "#ffab7c", "#f48a98", "#b77fd0", "#5f6fd8"], e: [0, 4, 11, 24, 52] },
    water: { near: "#2c5f99", mid: "#3a74aa", far: "#4f8cc0", crest: "#ffc8a0", trough: "#1e4a80", glint: "#ffe6c0", shade: [0.5, 0.52, 0.74] }, // blue, peach marks (ref 05_40.5)
    cloud: { lit: "#fff0d2", mid: "#f6c8a8", shade: "#b4a2cc" }, bounce: [0.03, 0.02, 0.0], sat: 1.12,
  },
  dusk: {
    sky: { c: ["#ffb27a", "#f69c7c", "#cf8696", "#7c72a8", "#3e4f8f"], e: [0, 3, 9, 20, 45] },
    water: { near: "#1d426e", mid: "#2f5890", far: "#f0a280", crest: "#ffc8a2", trough: "#122a4e", glint: "#ffdcac", shade: [0.42, 0.46, 0.72] },
    cloud: { lit: "#ffc8a0", mid: "#e8949a", shade: "#8a7cb8" }, bounce: [0.04, 0.02, 0.0], sat: 1.08,
  },
  under: {
    sky: { c: ["#126f86", "#16809a", "#1f95b0", "#36aec8", "#5cc8e0"], e: [0, 10, 25, 45, 85], below: "#0a4a5e" },
    water: { near: "#6fc8e4", mid: "#4fb0d8", far: "#2a86bc", crest: "#c8f2ff", trough: "#2a7fb0", glint: "#ffffff", shade: [1, 1, 1] },
    cloud: CLOUD_DAY, bounce: [0, 0, 0], sat: 1.18,
  },
  deep: {
    sky: { c: ["#0a2442", "#0b2a4c", "#0d3156", "#103a62", "#14446e"], e: [0, 10, 25, 45, 85], below: "#061426" },
    water: { near: "#0a2a4c", mid: "#0a2a4c", far: "#0a2a4c", crest: "#0a2a4c", trough: "#0a2a4c", glint: "#0a2a4c", shade: [1, 1, 1] },
    cloud: CLOUD_DAY, bounce: [0, 0, 0], sat: 1.0,
  },
};
export const isUnder = (l: LightName) => l === "under" || l === "deep";
/** world ink per light (round 3): tinted dark instead of pure black (ref ink cores L* ~18, scene-tinted), and it fades
 *  out with the fog so far dunes / horizons are not stacked lines */
export const INK: Record<LightName, { color: string; fadeNear: number; fadeFar: number }> = {
  day: { color: "#1e1830", fadeNear: 300, fadeFar: 800 }, golden: { color: "#2b1822", fadeNear: 300, fadeFar: 800 }, dusk: { color: "#221634", fadeNear: 300, fadeFar: 800 },
  under: { color: "#0f2240", fadeNear: 26, fadeFar: 70 }, deep: { color: "#070f1e", fadeNear: 16, fadeFar: 40 },
};
