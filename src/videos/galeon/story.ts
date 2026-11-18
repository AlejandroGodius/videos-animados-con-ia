// Timeline of "El galeón San José" (1708): 11 shots timed to the recorded voice (voz/galeon/words.json). Everything inside a
// shot is driven by LOCAL shot time (l = frames since the shot started, n = shot length), and camera / DOF keys sit at
// FRACTIONS of the shot, so re-syncing to the real voice only means editing SHOTS a/b.
// Camera grammar from the bridge template: hard cuts between shots, smootherstep glides 18-40 f inside a shot,
// every hold creeps (push-in 0.15-0.35 %/f), 7-frame flip kicks on impacts, no hand-held float.
import * as THREE from "three";
import { LightName } from "./lights";

export const FPS = 30;
export const TOTAL = 1260; // voice ends at frame 1195 ("todos"), ~2 s tail on the wreck
export const D0 = 0; // legacy (build.ts helpers): ground height of the bridge town
export type V3 = [number, number, number];

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const smooth = (x: number) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
export const easeOut = (u: number) => 1 - (1 - clamp01(u)) ** 4;
/** reference camera ease: symmetric smootherstep */
export const glide = (u: number) => { const x = clamp01(u); return x * x * x * (x * (6 * x - 15) + 10); };

// ---------------- shots ----------------
export type ShotDef = { id: number; a: number; b: number };
export const SHOTS: ShotDef[] = [
  { id: 1, a: 0, b: 125 },      // "En 1708 se hundió un barco cargado de oro, plata y esmeraldas"
  { id: 2, a: 125, b: 218 },    // "y su tesoro lleva más de 300 años en el fondo del mar"
  { id: 3, a: 218, b: 355 },    // "Se llamaba San José, un galeón español que navegaba de Portobelo a Cartagena de Indias"
  { id: 4, a: 355, b: 446 },    // "pero frente a Cartagena le esperaban barcos ingleses"
  { id: 5, a: 446, b: 495 },    // "Cañonazo va, cañonazo viene"
  { id: 6, a: 495, b: 568 },    // "y de repente el San José se hundió" (hundió @545)
  { id: 7, a: 568, b: 661 },    // "Iban 600 personas a bordo, solo 11 sobrevivieron"
  { id: 8, a: 661, b: 757 },    // "Durante 300 años todo el mundo lo buscó, nadie lo encontró" (nadie @734)
  { id: 9, a: 757, b: 899 },    // "Hasta que en 2015 Colombia anunció que lo tenía, a 600 metros de profundidad"
  { id: 10, a: 899, b: 1010 },  // "Y ahora Colombia, España y una empresa cazatesoros se pelean por él"
  { id: 11, a: 1010, b: 1260 }, // "Y todavía nadie sabe con certeza qué lo hundió. El barco que nadie pudo salvar, hoy lo quieren todos."
];
/** crossfades (frames) at place changes: none, hard cuts only; a white 4-frame flash after the hook */
export const XFADE: Record<number, number> = {};
export const FLASH_AT = 125;

export const shotAt = (f: number) => SHOTS.find((s) => f >= s.a && f < s.b) ?? SHOTS[SHOTS.length - 1];
export const layersAt = (f: number): { id: number; alpha: number }[] => {
  for (const s of SHOTS) {
    const x = XFADE[s.id];
    if (x && f >= s.a - x / 2 && f < s.a + x / 2) return [{ id: s.id - 1, alpha: 1 }, { id: s.id, alpha: (f - (s.a - x / 2) + 1) / (x + 1) }];
  }
  return [{ id: shotAt(f).id, alpha: 1 }];
};
/** local clock of shot id at absolute frame f */
export const loc = (id: number, f: number) => { const s = SHOTS[id - 1], n = s.b - s.a, l = f - s.a; return { l, n, u: l / n, t: l / FPS }; };

// ---------------- places (world metres; sea surface at y = 0) ----------------
export const BED = -28;                 // seabed
export const WRECK: V3 = [16, BED, -34]; // the wreck lies under the battle spot, beside the Cartagena pier (shot 11 glides there)
export const CHEST: V3 = [WRECK[0] + 9, BED, -14]; // open chest of the hook (in front of the wreck)
export const DIVER: V3 = [-140, BED, 60]; // the helmet diver searches far from the wreck
export const DOCK_Y = 1.42;            // pier deck
export const DCHEST: V3 = [0, DOCK_Y, -11]; // the chest on the dock (tug-of-war)
export const ROWB: V3 = [34, 0, 6];    // survivors' rowboat
export const ISLAND: V3 = [-120, 0, -300];
export const SUP: V3 = [16, 0, -16];   // modern support ship (2015)
export const GS = 1, ES = 1;           // ships are built in metres (hero.ts)
export const G_DECK = 2.7, G_QDECK = 5.5, G_FDECK = 4.7; // galleon decks (hero.ts hullOf SPAIN): main / quarterdeck / forecastle
/** captains stand on the forecastle, port side (the lens hovers just off the bow) */
export const CAP_ES: V3 = [-0.55, 4.45, 17.3], CAP_EN: V3 = [-0.9, 4.42, 11.0]; // the Spanish captain stands on the beakhead (hero.ts)

/** seabed height: soft dunes, flattened around the chest and the diver so they stand on it */
export const bedY = (x: number, z: number) => {
  const flat = Math.min(smooth((Math.hypot(x - CHEST[0], z - CHEST[2]) - 2.5) / 9), smooth((Math.hypot(x - DIVER[0], z - DIVER[2]) - 2) / 8));
  return BED + flat * (0.55 * Math.sin(x * 0.07) * Math.cos(z * 0.055) + 0.25 * Math.sin(x * 0.19 + z * 0.13)) - 0.02 * Math.max(0, Math.hypot(x - WRECK[0], z - WRECK[2] - 40) - 120);
};

// ---------------- ships: pure functions of (shot, local time) ----------------
export type Pose = { pos: V3; yaw: number; pitch: number; roll: number; s: number };
const bob = (T: number, k = 1) => ({ y: 0.12 * k * Math.sin(1.3 * T), roll: 0.024 * k * Math.sin(1.05 * T + 0.4), pitch: 0.01 * k * Math.sin(0.8 * T + 1.1) });
/** the San José: heading +x (model bow +z turned by yaw PI/2), riding over the wreck spot; shot 6 lists toward +z and sinks */
export const galleonPose = (id: number, t: number): Pose => {
  const T = ({ 3: 0, 4: 6, 5: 12, 6: 16 } as Record<number, number>)[id] ?? 0;
  const b = bob(T + t);
  let y = b.y, roll = b.roll, pitch = b.pitch;
  const x = WRECK[0] - 16 + 1.0 * (T + t);
  if (id === 6) {
    const u = clamp01((t - 0.2) / 2.0); // starts on "de repente", the hull is mostly under by "hundió" (local 1.67 s)
    pitch += 0.34 * smooth(u * 1.3);  // goes down by the bow
    roll += 0.2 * smooth(u * 1.1);
    y -= 13 * u ** 1.7;
  }
  return { pos: [x, y, WRECK[2]], yaw: Math.PI / 2, pitch, roll, s: GS };
};
/** English warships. Shot 4: they slide out from behind the island toward the galleon; shot 5: broadside alongside */
export const engPose = (k: number, id: number, t: number): Pose => {
  const b = bob(t + k * 2.3, 0.8);
  if (id === 4) {
    // at bearings 6.5 / 9.5 / 12.5 deg left of the lens (the island's right edge is ~12.5 deg): out, out, half hidden
    const start: V3[] = [[-39.4, 0, -375.9], [-58.9, 0, -388.3], [-79.9, 0, -399.5]], v = 6;
    const dir = new THREE.Vector3(0.45, 0, 0.89).normalize();
    const p = start[k];
    return { pos: [p[0] + dir.x * v * t, b.y, p[2] + dir.z * v * t], yaw: Math.atan2(dir.x, dir.z), pitch: b.pitch, roll: b.roll, s: ES };
  }
  const g = galleonPose(5, t);
  const off: V3[] = [[4, 0, -32], [46, 0, -58], [-40, 0, -70]];
  return { pos: [g.pos[0] + off[k][0], b.y, WRECK[2] + off[k][2]], yaw: Math.PI / 2, pitch: b.pitch, roll: b.roll, s: ES };
};
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
export const poseMatrix = (p: Pose, out = new THREE.Matrix4()) => {
  _e.set(p.pitch, p.yaw, p.roll, "YXZ");
  return out.compose(_v.set(...p.pos), _q.setFromEuler(_e), new THREE.Vector3(p.s, p.s, p.s));
};
/** ship-model coordinates -> world */
export const onShip = (p: Pose, local: V3): V3 => {
  const v = new THREE.Vector3(...local).applyMatrix4(poseMatrix(p, _m));
  return [v.x, v.y, v.z];
};

// ROV (shot 9, deep part): descends toward the wreck with its lamps on
export const rovPos = (t: number): V3 => {
  const u = clamp01((t - 2.2) / 2.4);
  return [WRECK[0] + 6 - 1.5 * u, BED + 12 - 4.5 * smooth(u), WRECK[2] + 10 - 2.5 * u];
};

// ---------------- light per shot part ----------------
/** light of shot `id` at local frame l (shot 11 switches to underwater when the lens dips under the surface) */
export const lightOf = (id: number, l: number, n: number, camY = 1): LightName => {
  switch (id) {
    case 1: case 2: return "under";
    case 3: case 4: case 5: case 6: return "golden";
    case 7: return "dusk";
    case 8: return l < 0.46 * n ? "day" : "under";
    case 9: return l < 0.465 * n ? "day" : "deep";
    case 10: return "day";
    default: return camY < 0 ? "under" : "day";
  }
};

// ---------------- camera ----------------
export type Cam = { pos: V3; look: V3; fov: number; roll: number };
type Shot = Partial<Cam> & { pos: V3; look: V3 };
/** a camera key at fraction `at` of the shot; glides over `dur` frames unless `cut` */
type Key = { at: number; dur?: number; cut?: boolean; s: (l: number, n: number) => Shot };
const mix = (a: Cam, b: Cam, k: number): Cam => ({
  pos: a.pos.map((v, i) => v + (b.pos[i] - v) * k) as V3, look: a.look.map((v, i) => v + (b.look[i] - v) * k) as V3,
  fov: a.fov + (b.fov - a.fov) * k, roll: a.roll + (b.roll - a.roll) * k,
});
const full = (c: Shot): Cam => ({ fov: 40, roll: 0, ...c });
const run = (keys: Key[], l: number, n: number) => {
  let cur = full(keys[0].s(l, n));
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i], f0 = Math.round(k.at * n);
    if (l < f0) break;
    cur = k.cut ? full(k.s(l, n)) : mix(cur, full(k.s(l, n)), glide((l - f0) / (k.dur ?? 24)));
  }
  return cur;
};
/** push-in factor since local frame l0: the subject grows ~rate per frame */
const pushK = (l: number, l0: number, rate: number) => Math.exp(-rate * Math.max(0, l - l0));
const dolly = (pos: V3, look: V3, k: number, rest: Partial<Cam> = {}): Shot =>
  ({ pos: [look[0] + (pos[0] - look[0]) * k, look[1] + (pos[1] - look[1]) * k, look[2] + (pos[2] - look[2]) * k], look, ...rest });
const zoom = (pos: V3, look: V3, fov: number, k: number, rest: Partial<Cam> = {}): Shot =>
  ({ pos, look, fov: (360 / Math.PI) * Math.atan(Math.tan((fov * Math.PI) / 360) * k), ...rest });
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const T = (l: number) => l / FPS;

const W = WRECK, C = CHEST;
/** galleon-local camera: both points in model units, moved with the ship */
const gl = (id: number, l: number, pos: V3, look: V3, k: number, rest: Partial<Cam> = {}): Shot => {
  const p = galleonPose(id, T(l)), a = onShip(p, pos), b = onShip(p, look);
  return dolly(a, b, k, rest);
};
const el = (id: number, l: number, pos: V3, look: V3, k: number, rest: Partial<Cam> = {}): Shot => {
  const p = engPose(0, id, T(l)), a = onShip(p, pos), b = onShip(p, look);
  return dolly(a, b, k, rest);
};
const gx = (id: number, l: number) => galleonPose(id, T(l)).pos[0];

const CAMS: Record<number, Key[]> = {
  // 1: close on the open chest, slow push; the wreck hull is a silhouette in the fog behind
  1: [{ at: 0, s: (l) => dolly([C[0] + 2.0, BED + 1.75, C[2] + 4.9], [C[0] - 0.1, BED + 0.45, C[2] + 0.2], pushK(l, 0, 0.0028), { fov: 40, roll: -0.03 }) }],
  // 2: wide of the wreck in the deep fog, creeping zoom
  2: [{ at: 0, s: (l) => zoom([W[0] + 17, BED + 8.5, W[2] + 27], [W[0] + 0.5, BED + 4.5, W[2]], 46, pushK(l, 0, 0.0022)) }],
  // 3: the galleon sailing (low, from ahead-side), then a low angle up at the captain under the stern flag
  3: [
    { at: 0, s: (l) => dolly([gx(3, l) + 52, 3.4, W[2] + 62], [gx(3, l) + 1, 11.5, W[2]], pushK(l, 0, 0.002), { fov: 42, roll: 0.02 }) },
    { at: 0.3, cut: true, s: (l) => gl(3, l, [-2.9, 6.25, 20.0], [-0.45, 5.85, 17.3], pushK(l, 41, 0.0012), { fov: 52, roll: -0.03 }) }, // bow quarter: captain + jack flag, main sail behind // cut on "galeón español"
  ],
  // 4: from beside the galleon toward the island: English warships slide out from behind it; then the English captain
  4: [
    { at: 0, s: (l) => zoom([-2, 7.5, W[2] - 14], [-58.9, -6.5, -388.3], 13, pushK(l, 0, 0.0012)) }, // long lens on the three ships at the island's edge
    { at: 0.58, cut: true, s: (l) => el(4, l, [-2.6, 7.6, 15.2], [-0.4, 5.9, 6.5], pushK(l, 53, 0.003), { fov: 52, roll: 0.03 }) }, // cut on "barcos ingleses"
  ],
  // 5: low between the two broadsides, looking along the gap (galleon left, English ship right)
  5: [
    { at: 0, s: (l) => dolly([gx(5, l) + 15, 15, W[2] + 22], [gx(5, l) + 3, 4, W[2] - 30], pushK(l, 0, 0.003), { fov: 48 }) },
    { at: 0.4, dur: 18, s: (l) => dolly([gx(5, l) + 13, 13, W[2] + 18], [gx(5, l) + 2, 5, W[2] - 30], pushK(l, 20, 0.005), { fov: 46, roll: 0.06 }) }, // centred on the 2nd "cañonazo"
  ],
  // 6: water-level wide; the hull lists toward the lens and goes down fast
  6: [{ at: 0, s: (l) => dolly([gx(6, 0) - 30, 2.6, W[2] + 30], [gx(6, 0) - 4, 6.5, W[2] + 2], pushK(l, 0, 0.003), { fov: 46, roll: -0.05 }) }], // stern quarter: the bow dives away
  // 7: dusk, low over the calm water, the rowboat backlit by the sun
  7: [{ at: 0, s: (l) => dolly([ROWB[0] + 2.4, 2.3, ROWB[2] + 7.2], [ROWB[0] - 0.3, 1.1, ROWB[2] - 0.5], pushK(l, 0, 0.0025), { fov: 40, roll: 0.025 }) }],
  // 8: boats searching (day) -> the helmet diver shrugs on an empty seabed
  8: [
    { at: 0, s: (l) => dolly([6, 9, 176], [0, 3, 108], pushK(l, 0, 0.002), { fov: 44 }) },
    { at: 0.46, cut: true, s: (l) => dolly([DIVER[0] + 0.5, BED + 1.5, DIVER[2] + 5.3], [DIVER[0], BED + 1.5, DIVER[2]], pushK(l, 44, 0.0015), { fov: 40, roll: 0.03 }) }, // cut on "el mundo", shrug on "nadie"
  ],
  // 9: the support ship with the Colombian flag -> down in the dark the ROV's lamps find the wreck
  9: [
    { at: 0, s: (l) => dolly([SUP[0] - 34, 3.0, SUP[2] + 19], [SUP[0] - 12, 5.5, SUP[2]], pushK(l, 0, 0.0025), { fov: 44 }) }, // stern quarter: flag + ROV on the A-frame
    { at: 0.465, cut: true, s: (l) => { const r = rovPos(T(l)); return { pos: add(r, [6.5, 2.0, 4.0]), look: [r[0] * 0.8 + W[0] * 0.2, r[1] * 0.62 + (BED + 4.5) * 0.38, r[2] * 0.8 + W[2] * 0.2], fov: 50, roll: -0.03 }; } }, // behind-beside the ROV: lamps + beams onto the wreck
  ],
  // 10: tug-of-war on the dock, the fortress behind
  10: [
    { at: 0, s: (l) => dolly([-0.35, DOCK_Y + 2.3, DCHEST[2] + 12.5], [-0.3, DOCK_Y + 1.15, DCHEST[2] - 1.0], pushK(l, 0, 0.0022), { fov: 40 }) },
    { at: 0.5, dur: 28, s: (l) => dolly([-1.2, DOCK_Y + 1.6, DCHEST[2] + 6.5], [0.2, DOCK_Y + 1.3, DCHEST[2] - 2.0], pushK(l, 69, 0.0025), { fov: 40, roll: 0.04 }) }, // centred on "cazatesoros"
  ],
  // 11: the tug goes on (high wide) -> the camera sinks off the dock into the water -> settles on the lonely wreck
  11: [
    { at: 0, s: (l) => dolly([3.2, DOCK_Y + 5.5, DCHEST[2] + 13], [0, DOCK_Y + 0.8, DCHEST[2] - 0.5], pushK(l, 0, 0.002), { fov: 42 }) },
    { at: 0.3, dur: 36, s: () => ({ pos: [7, -2.5, DCHEST[2] + 9], look: [13, -10, DCHEST[2] - 9], fov: 46 }) }, // sinks off the dock after "hundió"
    { at: 0.42, dur: 40, s: (l) => dolly([7.5, BED + 13, W[2] + 24], [W[0] + 0.5, BED + 3.5, W[2]], pushK(l, 145, 0.0016), { fov: 46 }) }, // lands ~1155, creeps to the end
  ],
};

// impact kicks: the image offset flips sign every frame, decays to 0 in 7 f. [fraction of the shot, gain]
const KICKS: Record<number, [number, number][]> = {
  5: [[0.0, 1.0], [0.2, 0.55], [0.45, 1.1], [0.71, 0.6]], // "Cañonazo"@0, "va"@11, "cañonazo"@24, "viene"@36 (local frames)
  6: [[0.07, 1.4]],                                       // "de repente"
};
export const kickAt = (id: number, l: number, n: number) => {
  let a = 0;
  for (const [u0, g] of KICKS[id] ?? []) {
    const k = Math.floor(l - u0 * n + 1e-6);
    if (k >= 0 && k < 7) a += g * (k % 2 ? -1 : 1) * (1 - k / 7) ** 1.5;
  }
  return a;
};
/** impact moments of shot id (local frames), for effects */
export const kickFrames = (id: number, n: number) => (KICKS[id] ?? []).map(([u]) => Math.round(u * n));

export const camAt = (id: number, f: number): Cam => {
  const { l, n } = loc(id, f);
  const c = run(CAMS[id], l, n), a = kickAt(id, l, n);
  if (!a) return c;
  const d: V3 = [c.look[0] - c.pos[0], c.look[1] - c.pos[1], c.look[2] - c.pos[2]];
  const L = Math.hypot(...d), h = Math.hypot(d[0], d[2]) || 1;
  const m = (3 / 640) * Math.tan((c.fov * Math.PI) / 360) * L * a;
  return { ...c, look: [c.look[0] - (d[2] / h) * m, c.look[1] + 0.6 * m, c.look[2] + (d[0] / h) * m], roll: c.roll + a * 0.004 };
};

// ---------------- lens: depth of field per key ----------------
/** cInf = blur-disc radius in px at 1080x1920 for things at infinity (0 = all sharp); focus = world point (else the look point) */
export type Dof = { at: number; cInf: number; focus?: (l: number, n: number) => V3 };
const DOF: Record<number, Dof[]> = {
  1: [{ at: 0, cInf: 15, focus: () => [C[0], BED + 0.45, C[2]] }],
  2: [{ at: 0, cInf: 0 }],
  3: [{ at: 0, cInf: 0 }, { at: 0.3, cInf: 9, focus: (l) => onShip(galleonPose(3, T(l)), [CAP_ES[0], CAP_ES[1] + 0.62, CAP_ES[2]]) }],
  4: [{ at: 0, cInf: 0 }, { at: 0.58, cInf: 12, focus: (l) => onShip(engPose(0, 4, T(l)), [CAP_EN[0], CAP_EN[1] + 0.62, CAP_EN[2]]) }],
  5: [{ at: 0, cInf: 0 }],
  6: [{ at: 0, cInf: 0 }],
  7: [{ at: 0, cInf: 8, focus: () => [ROWB[0], 0.9, ROWB[2]] }],
  8: [{ at: 0, cInf: 0 }, { at: 0.46, cInf: 12, focus: () => [DIVER[0], BED + 1.3, DIVER[2]] }],
  9: [{ at: 0, cInf: 0 }, { at: 0.465, cInf: 6, focus: (l) => rovPos(T(l)) }],
  10: [{ at: 0, cInf: 10, focus: () => [DCHEST[0], DOCK_Y + 0.9, DCHEST[2]] }],
  11: [{ at: 0, cInf: 6, focus: () => [DCHEST[0], DOCK_Y + 0.9, DCHEST[2]] }, { at: 0.3, cInf: 0 }],
};
export const dofAt = (id: number, f: number) => {
  const { l, n } = loc(id, f);
  const list = DOF[id];
  let d = list[0];
  for (const x of list) if (l >= Math.round(x.at * n)) d = x;
  return { cInf: d.cInf, focus: d.focus ? () => d.focus!(l, n) : undefined };
};
