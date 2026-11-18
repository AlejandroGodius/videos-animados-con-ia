// The San José cast as lit flat sprites in the 3D world (template: bridge/cast.ts). Each frame every character asks for a drawing (a key + a draw call);
// the pool keeps one canvas per distinct drawing, so soldiers marching in step share canvases (7 head shapes x 4
// outfits). Characters are yaw-only billboards shaded by cardShade() (scene tint, bright floor, side gradient toward
// the sun, painted crescent in the drawing); standing ones get a soft multiply contact blob. Effects are unlit cards.
// Cards, effects and blobs live on the NOINK layer so the world ink pass never outlines their quads.
import * as THREE from "three";
import {
  Pen, bodyFront, bodySide, fxSparkle, fxBurst, fxSplash, fxRing, fxShadow, fxContact, fxPuff, fxFish, fxBubble, fxSmoke, fxBall, fxHullFoam, fxWake, fxDrop,
  CAPTAIN_ES, CAPTAIN_EN, sailor, DIVER as DIVER_O, OFFICIAL_CO, OFFICIAL_ES, HUNTER, Outfit, Expr, FrontOpts, SideOpts,
} from "./toon";
import {
  FPS, V3, clamp01, bedY, CAP_ES, CAP_EN, BED, WRECK, CHEST, DIVER, DOCK_Y, DCHEST, ROWB, GS, ES, G_DECK, G_QDECK, Pose, galleonPose, engPose, onShip, rovPos, kickFrames,
} from "./story";
import { LightName } from "./lights";
import { NOINK } from "./ink";
import { cardShade, blobMaterial, CARD_K } from "./cardshade";

// ---------------- canvas pool ----------------
type Entry = { cv: HTMLCanvasElement; tex: THREE.CanvasTexture; w: number; h: number };
export type Req = { key: string; w: number; h: number; k: number; draw: (p: Pen) => void; tex?: THREE.CanvasTexture };
const makeEntry = (w: number, h: number): Entry => {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { cv, tex, w, h };
};
export class Pool {
  private live = new Map<string, Entry>();
  private free: Entry[] = [];
  private reqs: Req[] = [];
  req(key: string, w: number, h: number, k: number, draw: (p: Pen) => void) {
    const r: Req = { key: `${w}x${h}|${key}`, w, h, k, draw };
    this.reqs.push(r);
    return r;
  }
  flush() {
    const want = new Map<string, Req[]>();
    for (const r of this.reqs) { const l = want.get(r.key); if (l) l.push(r); else want.set(r.key, [r]); }
    for (const [key, e] of this.live) if (!want.has(key)) { this.live.delete(key); this.free.push(e); }
    for (const [key, rs] of want) {
      let e = this.live.get(key);
      if (!e) {
        const r = rs[0], i = this.free.findIndex((x) => x.w === r.w && x.h === r.h);
        e = i >= 0 ? this.free.splice(i, 1)[0] : makeEntry(r.w, r.h);
        const g = e.cv.getContext("2d")!;
        g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, e.w, e.h); g.setTransform(r.k, 0, 0, r.k, 0, 0);
        r.draw(new Pen(g));
        e.tex.needsUpdate = true;
        this.live.set(key, e);
      }
      for (const r of rs) r.tex = e.tex;
    }
    this.reqs = [];
  }
}

// ---------------- sprite meshes ----------------
const blank = (() => { const c = document.createElement("canvas"); c.width = c.height = 2; return new THREE.CanvasTexture(c); })();
export const SU = 0.00216; // metres per design unit: 1000 units = 2.16 m
export const SU_SWING = 2.3 / 1830; // swing canvas: rope of 1830 units = 2.3 m
const BODY = (() => { const g = new THREE.PlaneGeometry(600 * SU, 1000 * SU); g.translate(0, (975 - 500) * SU, 0); return g; })();
const CARD = new THREE.PlaneGeometry(1, 1);
/** world roots that hold actors (to find the scene's sun when world.ts does not pass it) */
const ROOTS = new Set<THREE.Object3D>();

/** lit flat character: cardShade() material, receives shadows (dims to the bright floor only), casts its silhouette
 *  when world.ts says so (golden). Drawn after the contact blobs (renderOrder 1). */
export class Actor {
  mesh: THREE.Mesh; mat: THREE.MeshLambertMaterial; dmat: THREE.MeshDepthMaterial; r: Req | null = null;
  constructor(parent: THREE.Object3D, geo: THREE.BufferGeometry = BODY) {
    this.mat = cardShade(new THREE.MeshLambertMaterial({ map: blank, alphaTest: 0.5, side: THREE.DoubleSide }));
    this.mat.alphaToCoverage = false; // A2C + MSAA left 1 px sky-depth seams on blurred far cards (POST)
    this.dmat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: blank, alphaTest: 0.5, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.customDepthMaterial = this.dmat;
    // rim width is in output pixels: tell the card shader the render height (1920 = 1080 x 1920 frame)
    this.mesh.onBeforeRender = (r) => { const rt = r.getRenderTarget(); CARD_K.uPx.value = (rt ? rt.height : r.domElement.height) / 1920; };
    this.mesh.castShadow = false; this.mesh.receiveShadow = true; this.mesh.visible = false;
    this.mesh.rotation.order = "YXZ"; this.mesh.renderOrder = 1; this.mesh.layers.set(NOINK);
    parent.add(this.mesh);
    ROOTS.add(parent);
  }
  bind() { const t = this.r?.tex; if (t) { this.mat.map = t; this.dmat.map = t; } }
}
/** unlit effect card: hard cut-out (ink drawings), soft see-through (dust, mist) or a multiply ground blob */
export class Fx {
  mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; soft: THREE.MeshBasicMaterial; blob: THREE.MeshBasicMaterial; r: Req | null = null;
  constructor(parent: THREE.Object3D) {
    this.mat = new THREE.MeshBasicMaterial({ map: blank, alphaTest: 0.5, side: THREE.DoubleSide });
    this.mat.alphaToCoverage = false; // A2C + MSAA left 1 px sky-depth seams on blurred far cards (POST)
    this.soft = new THREE.MeshBasicMaterial({ map: blank, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.blob = blobMaterial(blank);
    this.mesh = new THREE.Mesh(CARD, this.mat);
    this.mesh.visible = false; this.mesh.layers.set(NOINK);
    parent.add(this.mesh);
  }
  use(soft: boolean) { this.mesh.material = soft ? this.soft : this.mat; }
  bind() {
    const t = this.r?.tex;
    if (!t) return;
    if (this.r!.key.includes("|blob|")) {
      // no mipmaps: at grazing views the mip chain averages the blob with its white surround and it fades out
      if (t.generateMipmaps) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.needsUpdate = true; }
      this.blob.map = t; this.mesh.material = this.blob; this.mesh.renderOrder = 0.5;
    }
    else { this.mat.map = t; this.soft.map = t; this.mesh.renderOrder = 0; }
  }
}

// ---------------- placements ----------------
export type Place = {
  key: string; draw: (p: Pen) => void; x: number; y: number; z: number;
  scale?: number; mirror?: boolean; yaw?: number; geo?: "body" | "swing"; roll?: number; size?: [number, number, number];
};
export type FxPlace = { key: string; cw: number; ch: number; draw: (p: Pen) => void; x: number; y: number; z: number; w: number; h: number; flat?: boolean; rot?: number; soft?: boolean };
/** sun = world direction TOWARD the sun (optional: when absent the scene's shadow-casting light is used) */
export type CamInfo = { pos: THREE.Vector3; right: THREE.Vector3; sun?: THREE.Vector3 };

const hh = (i: number, s = 0) => { const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); };
const q = (v: number, n = 120) => Math.round(v * n) / n;
/** head-shape seed: 7 shapes, so marching soldiers in step still share canvases */
const seedOf = (i: number) => ((i * 5 + 3) % 7) + 1;
/** drawing resolution by distance: [canvas w, h, scale from the 600 x 1000 design]; sized for the 1440 x 2560 final */
const tier = (d: number): [number, number, number] =>
  d < 3.2 ? [1800, 3000, 3.0] : d < 6.5 ? [1080, 1800, 1.8] : d < 16 ? [480, 800, 0.8] : [240, 400, 0.4];

// ---------------- light ----------------
const SUN = new THREE.Vector3(0.5, 0.75, -0.4).normalize();
const tmp = new THREE.Vector3();
let LNAME: LightName = "day";
const sunOf = (root: THREE.Object3D) => {
  let s: THREE.DirectionalLight | null = null;
  root.traverse((o) => { if (!s && o instanceof THREE.DirectionalLight && o.castShadow) s = o; });
  return s as THREE.DirectionalLight | null;
};
/** the sun of the world that is calling: the attached root whose sun target sits on this camera's view axis */
const findSun = (cam: CamInfo, out: THREE.Vector3) => {
  if (cam.sun) return out.copy(cam.sun).normalize();
  let best: THREE.DirectionalLight | null = null, err = Infinity;
  for (const r of ROOTS) {
    if (!r.parent) continue;
    const s = sunOf(r);
    if (!s) continue;
    const d = tmp.copy(s.target.position).sub(cam.pos), e = Math.abs(d.dot(cam.right)) / (d.length() || 1);
    if (e < err) { err = e; best = s; }
  }
  return best ? out.copy(best.position).sub(best.target.position).normalize() : out;
};
/** canvas angle the sun comes FROM on an upright card facing the camera, in 45-degree steps (small texture cache) */
const light2D = (cam: CamInfo, mirror: boolean) => {
  const sx = SUN.dot(cam.right) * (mirror ? -1 : 1), sy = -SUN.y;
  return Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) * (Math.PI / 4);
};

/** front / side view and mirroring for someone at (x, z) walking along (dx, dz); fs = foreshortening of the walk */
const viewOf = (cam: CamInfo, x: number, z: number, dx: number, dz: number) => {
  const tx = cam.pos.x - x, tz = cam.pos.z - z, tl = Math.hypot(tx, tz) || 1;
  const c = (tx * dx + tz * dz) / tl;
  return { side: c < 0.57, mirror: dx * cam.right.x + dz * cam.right.z < 0, fs: Math.round(Math.sqrt(Math.max(0, 1 - c * c)) * 20) / 20 };
};

// ---------------- life: blinks and reaction timing ----------------
/** reference expression and action changes land 0-3 f before the word onset */
const LEAD = 2 / FPS;
/** eyelid 0 open .. 1 shut. Reference: gaps 0.5-2.3 s, 4-frame blink half / shut / shut / half, plus a blink across
 *  every expression swap (the shut frames hide the swap) */
const LID = [0.5, 1, 1, 0.5];
const lidAt = (t: number, i: number, swaps: number[] = []) => {
  const f = Math.round(t * FPS);
  for (const ts of swaps) { const k = f - Math.round((ts - LEAD) * FPS) + 1; if (k >= 0 && k < 4) return LID[k]; }
  let s = Math.round(-60 * hh(i, 9));
  for (let n = 0; s <= f && n < 400; n++) {
    const k = f - s;
    if (k >= 0 && k < 4) return LID[k];
    s += Math.round(15 + 54 * hh(i * 31 + n, 13)); // next blink 0.5-2.3 s later
  }
  return 0;
};
const fkey = (o: object) => JSON.stringify(o, (_k, v) => (typeof v === "number" ? q(v) : v));

type Who = { i: number; o: Outfit; okey: string };
/** one character drawing in the 600 x 1000 design space, sized by distance, lit from the scene's sun */
const person = (cam: CamInfo, who: Who, x: number, y: number, z: number, view: { side: boolean; mirror: boolean }, fo: FrontOpts, so: SideOpts, scale = 1): Place & { tierKey: string } => {
  const d = cam.pos.distanceTo(tmp.set(x, y + 1.2, z)) / scale;
  const [w, h, k] = tier(d);
  const mirror = view.side && view.mirror, light = light2D(cam, mirror), seed = seedOf(who.i);
  const f2: FrontOpts = { ...fo, light, seed }, s2: SideOpts = { ...so, light, seed };
  const key = view.side ? `S|${who.okey}|${fkey(s2)}` : `F|${who.okey}|${fkey(f2)}`;
  return {
    key, x, y, z, scale, mirror, tierKey: `${w}`,
    draw: (p) => (view.side ? bodySide(p, who.o, s2) : bodyFront(p, who.o, f2)),
    size: [w, h, k],
  };
};

/** ground shadow under a standing / sitting card (review rounds 2-4), multiply, blue-violet: a TIGHT contact pool right under
 *  the feet (~.5 on screen at the core) so nobody floats, plus by day (cards cast no real shadow) a lighter soft tail
 *  stretched AWAY from the sun, length ~1.6 m / tan(sun elevation), capped. Golden: world.ts casts real card shadows. */
const CONTACT: Record<LightName, [number, number, number]> = { day: [0.2, 0.21, 0.33], golden: [0.24, 0.2, 0.33], dusk: [0.24, 0.2, 0.36],
  under: [0.3, 0.38, 0.5], deep: [0.2, 0.25, 0.4] };
const TAIL: [number, number, number] = [0.42, 0.44, 0.62];
const toSrgb = (v: number) => { const c = clamp01(v); return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; };
const hexOf = (c: [number, number, number], k: number) => "#" + c.map((v) => Math.round(255 * toSrgb(1 - (1 - v) * k)).toString(16).padStart(2, "0")).join("");
const blob = (out: Stage, x: number, y: number, z: number, sc = 1, k = 1) => {
  const hl = Math.hypot(SUN.x, SUN.z) || 1, ox = -SUN.x / hl, oz = -SUN.z / hl, rot = Math.atan2(-ox, -oz);
  if (LNAME === "day") {
    const el = Math.asin(Math.min(0.99, Math.max(0.1, SUN.y)));
    const len = Math.min(2.4, Math.max(0.5, 1.6 / Math.tan(el))) * sc, h = len + 0.55 * sc, c = 0.3 * h; // feet at v = .2 of the card
    const tc = hexOf(TAIL, k);
    out.fx.push({ key: `blob|shadow|${tc}`, cw: 128, ch: 256, draw: (p) => fxShadow(p, tc), x: x + ox * c, y: y + 0.018, z: z + oz * c,
      w: 0.72 * sc, h, flat: true, rot });
  }
  const cc = hexOf(CONTACT[LNAME], k);
  out.fx.push({ key: `blob|contact|${cc}`, cw: 128, ch: 128, draw: (p) => fxContact(p, cc), x: x + ox * 0.03 * sc, y: y + 0.022, z: z + oz * 0.03 * sc,
    w: 0.52 * sc, h: 0.4 * sc, flat: true, rot });
};

// ---------------- staging by shot ----------------
export type Stage = { places: Place[]; fx: FxPlace[]; ropes: [V3, V3][] };
const SAILORS = [0, 1, 2, 3, 4, 5].map((v) => sailor(v));

/** world point of a design-space point (canvas units, 600 x 1000 card) on a camera-facing card at p */
const cardPoint = (cam: CamInfo, x: number, y: number, z: number, dx: number, dy: number, mirror = false, sc = 1): V3 => {
  const yaw = Math.atan2(cam.pos.x - x, cam.pos.z - z), sx = mirror ? -1 : 1;
  const lx = (dx - 300) * SU * sc * sx, ly = (975 - dy) * SU * sc;
  return [x + Math.cos(yaw) * lx, y + ly, z - Math.sin(yaw) * lx];
};
const screenSide = (cam: CamInfo, vx: number, vz: number) => vx * cam.right.x + vz * cam.right.z < 0; // true = moving screen-left

/** fish crossing the frame: a school around `c`, swimming along (dx, dz) */
const fish = (cam: CamInfo, t: number, out: Stage, c: V3, dir: [number, number], n: number, spread: number, size = 0.45, seed = 0) => {
  const L = Math.hypot(dir[0], dir[1]) || 1, ux = dir[0] / L, uz = dir[1] / L;
  for (let i = 0; i < n; i++) {
    const sp = 0.9 + 0.5 * hh(i, seed + 1), along = ((t * sp + hh(i, seed + 2) * 20) % 20) - 10;
    const ox = (hh(i, seed + 3) - 0.5) * spread, oy = (hh(i, seed + 4) - 0.5) * spread * 0.4, oz = (hh(i, seed + 5) - 0.5) * spread;
    const x = c[0] + ux * along * 1.6 + ox, y = c[1] + oy + 0.15 * Math.sin(t * 2 + i), z = c[2] + uz * along * 1.6 + oz;
    const wag = q(Math.sin(t * 9 + i * 1.7), 6), kind = Math.floor(hh(i, seed + 6) * 4), s = size * (0.75 + 0.5 * hh(i, seed + 7));
    const flip = screenSide(cam, ux, uz);
    out.fx.push({ key: `fish${kind}|${wag}`, cw: 300, ch: 180, draw: (p) => fxFish(p, kind, wag), x, y, z, w: flip ? -s : s, h: s * 0.6 });
  }
};
const bubbles = (t: number, out: Stage, at: V3, n: number, rise: number, size = 0.12, seed = 0) => {
  for (let i = 0; i < n; i++) {
    const u = ((t * 0.35 + hh(i, seed)) % 1);
    const s = size * (0.6 + 0.8 * hh(i, seed + 1));
    out.fx.push({ key: "bubble", cw: 64, ch: 64, draw: fxBubble, x: at[0] + 0.25 * Math.sin(t * 3 + i) + (hh(i, seed + 2) - 0.5) * 0.4,
      y: at[1] + u * rise, z: at[2] + (hh(i, seed + 3) - 0.5) * 0.4, w: s, h: s });
  }
};
const splash = (out: Stage, x: number, z: number, u: number, s: number) => {
  if (u < 0 || u >= 1) return;
  out.fx.push({ key: `splash${q(u, 30)}`, cw: 800, ch: 800, draw: (p) => fxSplash(p, q(u, 30)), x, y: 2.6 * s, z, w: 7 * s, h: 7 * s });
};
const smoke = (out: Stage, x: number, y: number, z: number, u: number, s: number, seed: number, dark = false) => {
  if (u < 0 || u >= 1) return;
  const k = q(u, 20), sz = s * (0.5 + 0.9 * u);
  out.fx.push({ key: `smoke${seed % 4}|${k}|${dark ? 1 : 0}`, cw: 500, ch: 500, draw: (p) => fxSmoke(p, k, seed % 4, dark ? "#8f8a99" : "#ecebf0", dark ? "#5e5868" : "#a9a3b8"),
    x, y: y + u * s * 0.8, z, w: sz, h: sz });
};
const hullFoam = (out: Stage, pos: V3, yaw: number, len: number, wid: number, seed = 1) => {
  out.fx.push({ key: `hullfoam${seed}`, cw: 512, ch: 256, draw: (p) => fxHullFoam(p, seed), x: pos[0], y: 0.05, z: pos[2], w: len * 1.05, h: wid * 0.95, flat: true, rot: yaw - Math.PI / 2 });
  // wake behind the stern (yaw = heading)
  const bx = -Math.sin(yaw), bz = -Math.cos(yaw), wl = len * 1.4;
  out.fx.push({ key: `wake${seed}`, cw: 512, ch: 128, draw: (p) => fxWake(p, seed), x: pos[0] + bx * (len * 0.5 + wl * 0.5), y: 0.04, z: pos[2] + bz * (len * 0.5 + wl * 0.5), w: wl, h: wid * 1.1, flat: true, rot: yaw - Math.PI / 2 });
};
const sitter = (cam: CamInfo, t: number, out: Stage, i: number, o: Outfit, okey: string, x: number, y: number, z: number, expr: Expr, scale = 1) =>
  out.places.push(person(cam, { i, o, okey }, x, y, z, { side: false, mirror: false }, { mode: "sit", expr, blink: lidAt(t, i), look: 0 }, {}, scale));
const stander = (cam: CamInfo, t: number, out: Stage, i: number, o: Outfit, okey: string, x: number, y: number, z: number, fo: FrontOpts, scale = 1, shadow = true) => {
  out.places.push(person(cam, { i, o, okey }, x, y, z, { side: false, mirror: false }, { mode: "stand", blink: lidAt(t, i), ...fo }, {}, scale));
  if (shadow) blob(out, x, y, z, scale);
};

/** tug-of-war on the dock (shots 10-11): three pullers, three ropes to the chest; the chest jerks back and forth */
export const tugChest = (t: number): V3 => [DCHEST[0] + 0.16 * Math.sin(2.3 * t) + 0.06 * Math.sin(5.7 * t + 1), DOCK_Y, DCHEST[2] + 0.07 * Math.sin(1.7 * t + 0.5)];
const tug = (cam: CamInfo, t: number, out: Stage) => {
  const c = tugChest(t), dx = c[0] - DCHEST[0], dz = c[2] - DCHEST[2];
  // Colombian official (left, faces right), Spanish official (right, faces left, mirrored), treasure hunter behind (faces the lens)
  const pose = (k: number) => q(0.5 + 0.5 * Math.sin(2.3 * t + k), 20);
  const sides: [Outfit, string, number, number, boolean, number][] = [[OFFICIAL_CO, "co", -1.8, 0.3, false, 0], [OFFICIAL_ES, "es", 1.8, 0.1, true, 2.1]];
  sides.forEach(([o, key, ox, oz, mir, ph], k) => {
    const x = DCHEST[0] + ox + dx * 0.9, z = DCHEST[2] + oz + dz, i = 300 + k;
    const hand: [number, number] = [430, 548];
    const expr: Expr = ((t * 0.9 + k * 0.5) % 2) < 1.3 ? "strain" : k ? "shout" : "stern";
    const so: SideOpts = { mode: "pull", pose: pose(ph), expr, blink: expr === "strain" ? 0 : lidAt(t, i), hand };
    out.places.push(person(cam, { i, o, okey: key }, x, DOCK_Y, z, { side: true, mirror: mir }, {}, so));
    blob(out, x, DOCK_Y, z, 1.1);
    out.ropes.push([cardPoint(cam, x, DOCK_Y, z, hand[0], hand[1], mir), [c[0] + (mir ? 0.5 : -0.5), DOCK_Y + 0.42, c[2]]]);
    const pu = ((t * 1.1 + k * 0.4) % 1);
    if (pu < 0.6) out.fx.push({ key: `puff${q(pu / 0.6, 15)}`, cw: 300, ch: 300, draw: (p) => fxPuff(p, q(pu / 0.6, 15)), x: x + (mir ? 0.45 : -0.45), y: DOCK_Y + 0.25, z: z + 0.05, w: 0.7, h: 0.7, soft: true });
    const du = ((t * 0.8 + k * 0.33) % 1);
    if (du < 0.5) { const hp = cardPoint(cam, x, DOCK_Y, z, mir ? 250 : 350, 230, mir); out.fx.push({ key: "drop", cw: 60, ch: 80, draw: fxDrop, x: hp[0], y: hp[1] - du * 0.3, z: hp[2] + 0.05, w: 0.1, h: 0.13 }); }
  });
  const hx = DCHEST[0] + 0.15 + dx, hz = DCHEST[2] - 2.3 + dz, hand: [number, number] = [300, 629];
  stander(cam, t, out, 310, HUNTER, "hunter", hx, DOCK_Y, hz, { pose: "pull", expr: (t % 2.4) < 1.6 ? "greedy" : "strain", blink: lidAt(t, 310) }, 1, true);
  out.ropes.push([cardPoint(cam, hx, DOCK_Y, hz, hand[0], hand[1]), [c[0], DOCK_Y + 0.42, c[2] - 0.5]]);
};

/** everything with a face (and the 2D effects) in shot id at local frame l of n; light = this frame's light */
export const stage = (id: number, l: number, n: number, light: LightName, cam: CamInfo): Stage => {
  const out: Stage = { places: [], fx: [], ropes: [] };
  const t = l / FPS;
  LNAME = light;
  findSun(cam, SUN);
  switch (id) {
    case 1: {
      fish(cam, t, out, [CHEST[0] - 3, BED + 2.2, CHEST[2] - 7], [1, 0.2], 5, 3, 0.45, 1);
      bubbles(t, out, [CHEST[0] - 0.3, BED + 0.6, CHEST[2] + 0.1], 5, 3.5, 0.08, 3);
      for (let k = 0; k < 6; k++) { // twinkles over the gold
        const u = ((t * 0.9 + hh(k, 21)) % 1), s = Math.sin(Math.PI * u);
        if (s < 0.15) continue;
        const a = hh(k, 22) * Math.PI * 2, r = 0.15 + 0.35 * hh(k, 23);
        out.fx.push({ key: "sparkle", cw: 128, ch: 128, draw: fxSparkle, x: CHEST[0] + Math.cos(a) * r, y: bedY(CHEST[0], CHEST[2]) + 0.72 + 0.12 * hh(k, 24), z: CHEST[2] + Math.sin(a) * r * 0.6 + 0.2, w: 0.2 * s, h: 0.2 * s, rot: u });
      }
      break;
    }
    case 2: {
      fish(cam, t, out, [WRECK[0] + 6, BED + 7, WRECK[2] + 12], [-1, 0.3], 9, 5, 0.55, 7);
      bubbles(t, out, [WRECK[0] + 1, BED + 3, WRECK[2] + 2], 6, 8, 0.25, 4);
      break;
    }
    case 3: {
      const g = galleonPose(3, t);
      const cp = onShip(g, CAP_ES);
      stander(cam, t, out, 1, CAPTAIN_ES, "capES", cp[0], cp[1], cp[2], { expr: t > 2.0 ? "proud" : "smile_closed", facing: 0 }, 1, true);
      hullFoam(out, g.pos, g.yaw, 33, 10, 1);
      break;
    }
    case 4: {
      for (let k = 0; k < 3; k++) { const e = engPose(k, 4, t); hullFoam(out, e.pos, e.yaw, 29, 9, 2 + k); }
      const e = engPose(0, 4, t), cp = onShip(e, CAP_EN);
      out.places.push(person(cam, { i: 20, o: CAPTAIN_EN, okey: "capEN" }, cp[0], cp[1], cp[2], { side: true, mirror: false }, {},
        { mode: "stand", prop: "spyglass", expr: t * FPS > 70 ? "greedy" : "stern", blink: lidAt(t, 20) }));
      blob(out, cp[0], cp[1], cp[2]);
      break;
    }
    case 5: {
      const g = galleonPose(5, t), e = engPose(0, 5, t);
      hullFoam(out, g.pos, g.yaw, 33, 10, 1); hullFoam(out, e.pos, e.yaw, 29, 9, 2);
      const [k0, , k2] = kickFrames(5, n);
      // "Cañonazo va": the galleon's broadside (model +x faces the English ship); "cañonazo viene": the reply
      const volley = (from: Pose, side: number, l0: number, to: Pose, seed: number) => {
        for (let j = 0; j < 4; j++) {
          const zl = -6 + j * 4, lj = l - l0 - j * 1.5;
          const port = onShip(from, [side * 5.3, 1.72, zl]);
          if (lj >= 0 && lj < 6) { const u = q(lj / 6, 12); out.fx.push({ key: `muz${u}`, cw: 500, ch: 500, draw: (p) => fxBurst(p, u, "#ffb347", 9, 30, 220), x: port[0], y: port[1], z: port[2] + side * 0, w: 3.2, h: 3.2 }); }
          smoke(out, port[0], port[1] + 0.4, port[2], lj / 40, 6.5, seed + j);
          // ball flight ~0.45 s across the gap, then a splash short of / at the target hull
          const fu = lj / 13;
          const hit = onShip(to, [-side * (6.5 + (j % 2) * 6), 0, zl + 1.5 * (j - 1.5)]);
          if (fu >= 0 && fu < 1) out.fx.push({ key: "ball", cw: 100, ch: 100, draw: fxBall, x: port[0] + (hit[0] - port[0]) * fu, y: port[1] + 5 * Math.sin(Math.PI * fu) - port[1] * fu, z: port[2] + (hit[2] - port[2]) * fu, w: 0.9, h: 0.9 });
          splash(out, hit[0], hit[2], (lj - 13) / 18, 0.9 + 0.2 * (j % 2));
        }
      };
      volley(g, 1, k0, e, 1);
      volley(e, -1, k2, g, 5);
      break;
    }
    case 6: {
      const g = galleonPose(6, t);
      hullFoam(out, [g.pos[0], 0, g.pos[2]], g.yaw, 33, 10, 1);
      // smoke (no fireball: the cause is disputed): grey puffs rolling up from the deck, darker as it goes down
      for (let j = 0; j < 2; j++) {
        const sp = onShip(g, [(j % 2 ? 1.2 : -1.5), 4.0, -4 + j * 6]);
        smoke(out, sp[0], Math.max(sp[1], 1), sp[2], ((t * 0.5 + j * 0.37) % 1), 6, 10 + j, j % 2 === 0);
      }
      // sailors jumping from the near rail into the water
      for (let k = 0; k < 4; k++) {
        const t0 = 0.3 + k * 0.28, u = (t - t0) / 0.9;
        if (u < 0) continue;
        const st = onShip(galleonPose(6, t0), [-3.9, G_QDECK + 0.3, -13 + k * 1.8]);
        if (u < 1) {
          const x = st[0] + (k % 2 ? 1 : -1) * 0.8 * u, z = st[2] + 3.5 * u, y = st[1] + 1.6 * u - (st[1] + 1.6) * u * u;
          out.places.push(person(cam, { i: 40 + k, o: SAILORS[k % 6], okey: `s${k % 6}` }, x, y, z, { side: false, mirror: false },
            { mode: "fall", expr: k % 2 ? "shock" : "shout", tilt: (k % 2 ? 1 : -1) * 25 * u }, {}));
        } else {
          splash(out, st[0] + (k % 2 ? 0.8 : -0.8), st[2] + 3.5, (u - 1) / 1.0, 0.45);
          if (u < 3.5) { const x = st[0] + (k % 2 ? 0.8 : -0.8), z = st[2] + 3.6; sitter(cam, t, out, 40 + k, SAILORS[k % 6], `s${k % 6}`, x, -0.62 + 0.04 * Math.sin(t * 3 + k), z, "shock"); }
        }
      }
      splash(out, g.pos[0] + 10, g.pos[2] + 3, (t - 1.0) / 1.3, 1.6); // one big splash where the bow goes under
      break;
    }
    case 7: {
      // the survivors in the rowboat: a handful of sad faces at dusk
      const bob = 0.05 * Math.sin(t * 1.6), rk = 0.03 * Math.sin(t * 1.2);
      // along the boat (its long axis runs ~x, turned 0.25 rad): thwarts at -1.3 .. +1.2 m
      const seats: [number, number][] = [[-1.35, -0.12], [-0.55, 0.12], [0.25, -0.1], [1.05, 0.1], [-0.15, -0.38]];
      seats.forEach(([sa, sb], k) => {
        const c = Math.cos(0.25), s = Math.sin(0.25), x = ROWB[0] + sa * c + sb * s + rk * sb, z = ROWB[2] - sa * s + sb * c;
        sitter(cam, t, out, 60 + k, k === 4 ? CAPTAIN_ES : SAILORS[(k + 2) % 6], k === 4 ? "capES" : `s${(k + 2) % 6}`, x, 0.12 + bob, z, k % 3 === 2 ? "dazed" : "sad", 0.92);
      });
      for (const [x, z, s] of [[ROWB[0] - 5, ROWB[2] - 4, 1.6], [ROWB[0] + 4.5, ROWB[2] - 7, 1.2], [ROWB[0] - 1.5, ROWB[2] + 3.5, 1.0], [ROWB[0], ROWB[2], 4.2]] as const) {
        const u = q(((t * 0.3 + x * 0.1) % 1), 30);
        out.fx.push({ key: `ring${u}`, cw: 600, ch: 600, draw: (p) => fxRing(p, u), x, y: 0.03, z, w: s, h: s, flat: true });
      }
      break;
    }
    case 8: {
      if (light === "day") {
        for (const [x, z, k] of [[-6, 124, 0], [9, 96, 1], [3, 146, 2]] as const) hullFoam(out, [x, 0, z], 0.4 + k, k === 1 ? 10.6 * 1.6 : 4.4, k === 1 ? 4.8 * 1.6 : 2.4, 6 + k);
        break;
      }
      // the helmet diver looks around, then shrugs on "nadie" (local frame 73)
      const sh = l >= 70;
      stander(cam, t, out, 80, DIVER_O, "diver", DIVER[0], bedY(DIVER[0], DIVER[2]), DIVER[2],
        { expr: sh ? "shrug" : "nervous", pose: sh ? "shrug" : undefined, look: sh ? 0 : (Math.sin(t * 2.2) > 0 ? 1 : -1) });
      bubbles(t, out, [DIVER[0] + 0.05, BED + 2.25, DIVER[2]], 7, 4, 0.14, 9);
      fish(cam, t, out, [DIVER[0] + 2, BED + 2.6, DIVER[2] - 4], [-1, 0.4], 4, 3, 0.45, 11);
      break;
    }
    case 9: {
      if (light === "deep") {
        const r = rovPos(t);
        bubbles(t, out, [r[0] - 0.6, r[1] + 0.4, r[2] + 0.5], 5, 3, 0.1, 13);
      }
      break;
    }
    case 10: tug(cam, t, out); break;
    case 11: {
      if (light === "day") tug(cam, t + 111 / FPS, out);
      else {
        fish(cam, t, out, [WRECK[0] + 3, BED + 6, WRECK[2] + 8], [1, -0.3], 7, 5, 0.5, 17);
        bubbles(t, out, [WRECK[0] - 1, BED + 3, WRECK[2] + 1], 5, 8, 0.2, 18);
      }
      break;
    }
  }
  return out;
};
export { FPS };
