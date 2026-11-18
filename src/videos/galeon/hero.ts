// Hero assets built in code (no Kenney): the Spanish galleon, English warships (same builder, other paint), the wreck
// (broken, algae-covered galleon), the treasure chest and the 2015 ROV. Everything is merged per material (Batch) and
// lit by the two-tone shading (lam / twoTone); surfaces are HD Canvas2D paintings in the paint.ts manner: flat colour
// fields, thin dark seams (3-5 px at 1080), sunlit lips, gold trim. Units: metres; ship frame: bow +z, up +y, waterline y 0.
import * as THREE from "three";
import { Batch, lam, V } from "./build";
import { ctex, rep, planksHD, rng, jit } from "./paint";
import { NOINK } from "./ink";
import type { V3 } from "./story";

type G = CanvasRenderingContext2D;
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const st = (a: number, b: number, x: number) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const TAU = Math.PI * 2;

// ---------------- flags (painted) ----------------
/** Cross of Burgundy (Spanish naval flag of the period): white field, red ragged saltire (two knotty branches) */
export const burgundyTex = () => ctex("flagBurgundy2", 384, 256, (g) => {
  g.fillStyle = "#f7f3e8"; g.fillRect(0, 0, 384, 256);
  ragged(g, [[34, 26, 350, 230], [350, 26, 34, 230]], 30, "#c41e2e");
  g.fillStyle = "rgba(120,100,90,0.10)"; g.fillRect(0, 244, 384, 12);
});
/** ragged saltire branches: thick strokes with alternating knots */
const ragged = (g: G, lines: number[][], w: number, col: string) => {
  g.strokeStyle = col; g.fillStyle = col; g.lineCap = "round";
  for (const [x0, y0, x1, y1] of lines) {
    g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
    for (let k = 1; k < 9; k++) {
      const u = k / 9, s = k % 2 ? 1 : -1, px = x0 + dx * u, py = y0 + dy * u;
      g.lineWidth = w * 0.42; g.beginPath(); g.moveTo(px, py); g.lineTo(px + nx * s * w * 0.78 + (dx / L) * w * 0.3, py + ny * s * w * 0.78 + (dy / L) * w * 0.3); g.stroke();
    }
  }
};
/** British red ensign (1707 Union canton, simplified) */
export const ensignTex = () => ctex("flagRedEnsign2", 384, 240, (g) => {
  g.fillStyle = "#c8323a"; g.fillRect(0, 0, 384, 240);
  g.fillStyle = "#1f3a7a"; g.fillRect(0, 0, 186, 117);
  g.save(); g.beginPath(); g.rect(0, 0, 186, 117); g.clip();
  g.strokeStyle = "#f4f0e6"; g.lineWidth = 20; g.beginPath(); g.moveTo(0, 0); g.lineTo(186, 117); g.moveTo(186, 0); g.lineTo(0, 117); g.stroke();
  g.fillStyle = "#f4f0e6"; g.fillRect(75, 0, 36, 117); g.fillRect(0, 40, 186, 36);
  g.fillStyle = "#c8323a"; g.fillRect(82, 0, 22, 117); g.fillRect(0, 47, 186, 22);
  g.restore();
});
/** modern Colombian flag: yellow half, blue and red quarters */
export const colombiaTex = () => ctex("flagColombia2", 384, 256, (g) => {
  g.fillStyle = "#fcd116"; g.fillRect(0, 0, 384, 128);
  g.fillStyle = "#003893"; g.fillRect(0, 128, 384, 64);
  g.fillStyle = "#ce1126"; g.fillRect(0, 192, 384, 64);
});

/** waving flag: pole at the local origin, top edge at y 0, cloth streaming toward local +z (wind from astern) */
export class Flag {
  mesh: THREE.Mesh;
  constructor(parent: THREE.Object3D, tex: () => THREE.Texture, key: string, public w: number, public h: number, at: V3, public ph = 0) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 12, 1), lam("flag" + key, () => ({ map: tex(), side: THREE.DoubleSide })));
    this.mesh.position.set(...at); this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    parent.add(this.mesh);
  }
  pose(t: number, amp = 1) {
    const p = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const u = (i % 13) / 12, top = i < 13;
      const wv = Math.sin(t * 5.2 - u * 5 + this.ph);
      p.setXYZ(i, amp * 0.12 * this.w * u * wv, (top ? 0 : -this.h) - 0.05 * this.h * u * u + 0.03 * this.h * u * Math.sin(t * 4 - u * 3 + this.ph), u * this.w);
    }
    p.needsUpdate = true; this.mesh.geometry.computeVertexNormals();
  }
}

// ---------------- ship paint styles ----------------
export type ShipStyle = {
  key: string; L: number; B: number; hs: number;   // length, beam, castle height scale
  wood: string; band: string; upper: string; wale: string; bottom: string; trim: string; lid: string;
  cloth: string; cross: boolean;
  flag: () => THREE.Texture; flagKey: string;
  wreck?: boolean;
};
export const SPAIN: ShipStyle = { key: "es", L: 32, B: 9, hs: 1, wood: "#a8693a", band: "#b8352b", upper: "#a42e28", wale: "#3a2418", bottom: "#4a3226",
  trim: "#e8b84a", lid: "#c23a2c", cloth: "#f4e8cb", cross: true, flag: burgundyTex, flagKey: "burgundy" };
export const ENGLAND: ShipStyle = { key: "en", L: 28, B: 8.2, hs: 0.86, wood: "#6a4a34", band: "#d9a23c", upper: "#2d4a86", wale: "#231a16", bottom: "#3e2c22",
  trim: "#e2b44a", lid: "#c8323a", cloth: "#efe6d0", cross: false, flag: ensignTex, flagKey: "ensign" };
export const WRECK_STYLE: ShipStyle = { ...SPAIN, key: "wk", wreck: true };

// ---------------- hull shape (metres) ----------------
export type Hull = ReturnType<typeof hullOf>;
export const hullOf = (S: ShipStyle) => {
  const { L, B, hs } = S;
  const z = (s: number) => -L / 2 + s * L;
  const sOf = (zz: number) => (zz + L / 2) / L;
  /** top of the hull side (rail) */
  const H = (s: number) => 3.8 + hs * (2.8 * (1 - st(0.29, 0.31, s)) + 2.0 * (1 - st(0.125, 0.14, s)) + 1.55 * st(0.77, 0.79, s) + 0.25 * st(0.85, 1, s));
  const keel = (s: number) => -3.0 + 0.9 * st(0.25, 0.5, Math.abs(s - 0.5));
  const bw = (s: number) => (s < 0.3 ? 0.76 + 0.24 * st(0, 0.3, s) : s < 0.58 ? 1 : Math.sqrt(Math.max(0, 1 - ((s - 0.58) / 0.42) ** 2)) * (1 - 0.04 * st(0.9, 1, s)));
  const fy = (y: number, yk: number) => (y < 0 ? Math.pow(clamp((y - yk) / -yk), 0.42) : 1 - 0.16 * clamp((y - 1.4) / 7.5));
  const half = (s: number, y: number) => (B / 2) * bw(s) * fy(y, keel(s));
  // deck floors
  const DECK = { main: 2.7, quarter: 2.7 + 2.8 * hs, poop: 2.7 + 4.8 * hs, fore: 2.7 + 2.0 * hs };
  const deckAt = (s: number) => (s < 0.13 ? DECK.poop : s < 0.3 ? DECK.quarter : s > 0.78 ? DECK.fore : DECK.main);
  return { L, B, z, sOf, H, keel, half, DECK, deckAt };
};

const YMIN = -3.5, YMAX = 9.5;
const vOfY = (y: number) => (y - YMIN) / (YMAX - YMIN);

/** the hull side painting: u = s (stern 0 .. bow 1), v = height YMIN..YMAX */
const hullTex = (S: ShipStyle, hull: Hull) => ctex("hull" + S.key, 3072, 1024, (g, r) => {
  const W = 3072, Hh = 1024, X = (s: number) => s * W, Y = (y: number) => (1 - vOfY(y)) * Hh, PX = W / S.L; // px per metre along
  const ptop = (s: number) => Y(hull.H(s));
  // planked hull, strakes 0.34 m, slight per-plank jitter, thin dark seams + sunlit lip
  const strake = 0.34;
  for (let y = YMIN; y < YMAX; y += strake) {
    const base = y < -0.15 ? S.bottom : S.wood;
    g.fillStyle = jit(r, base, 0.05, 2, 0.06); g.fillRect(0, Y(y + strake), W, Y(y) - Y(y + strake) + 1);
    g.fillStyle = "rgba(255,236,205,0.16)"; g.fillRect(0, Y(y + strake) + 2, W, 2);
    for (let k = 0; k < 7; k++) { // butt joints
      const x = r() * W;
      g.fillStyle = "rgba(30,14,8,0.55)"; g.fillRect(x, Y(y + strake), 3, Y(y) - Y(y + strake));
    }
    for (let k = 0; k < 5; k++) { // grain
      const x = r() * W, yy = Y(y + strake * (0.2 + 0.6 * r()));
      g.strokeStyle = "rgba(80,40,18,0.18)"; g.lineWidth = 2; g.beginPath(); g.moveTo(x, yy); g.lineTo(x + 120 + r() * 300, yy + (r() - 0.5) * 3); g.stroke();
    }
    g.fillStyle = "rgba(28,12,6,0.85)"; g.fillRect(0, Y(y) - 2, W, 3); // seam
  }
  // painted gun-deck band and upper works (castles)
  const band = (y0: number, y1: number, col: string) => { g.fillStyle = col; g.fillRect(0, Y(y1), W, Y(y0) - Y(y1)); };
  band(1.25, 2.25, S.band);
  for (let y = 1.25; y < 2.25; y += 0.34) { g.fillStyle = "rgba(40,10,6,0.35)"; g.fillRect(0, Y(y) - 1, W, 2); }
  g.save(); g.beginPath(); // upper works above the main deck level at the castles
  for (let i = 0; i <= 200; i++) { const s = i / 200; const y = hull.H(s) > 4.2 ? 3.15 : 99; if (i === 0) g.moveTo(X(s), Y(Math.min(y, 99))); else g.lineTo(X(s), Y(Math.min(y, 99))); }
  g.restore();
  for (let i = 0; i < 400; i++) { // castle paint where the side is tall
    const s = i / 400, h = hull.H(s);
    if (h < 4.4) continue;
    g.fillStyle = S.upper; g.fillRect(X(s) - 1, ptop(s), W / 400 + 2, Y(3.2) - ptop(s));
  }
  // castle panels: gold-framed rectangles, and windows on the stern castle
  const panel = (s0: number, s1: number, y0: number, y1: number, win: boolean) => {
    const x0 = X(s0), x1 = X(s1), a = Y(y1), b = Y(y0);
    g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(x0, a, x1 - x0, b - a);
    g.strokeStyle = S.trim; g.lineWidth = 7; g.strokeRect(x0, a, x1 - x0, b - a);
    g.strokeStyle = "rgba(40,20,5,0.6)"; g.lineWidth = 2; g.strokeRect(x0 - 4, a - 4, x1 - x0 + 8, b - a + 8);
    if (win) {
      const cx = (x0 + x1) / 2, w = (x1 - x0) * 0.44, h = (b - a) * 0.62, top = a + (b - a) * 0.2;
      g.fillStyle = "#1d2440"; g.beginPath(); g.moveTo(cx - w / 2, top + h); g.lineTo(cx - w / 2, top + w / 2); g.arc(cx, top + w / 2, w / 2, Math.PI, 0); g.lineTo(cx + w / 2, top + h); g.closePath(); g.fill();
      g.fillStyle = "rgba(255,206,120,0.55)"; g.fillRect(cx - w / 2 + 4, top + h * 0.55, w - 8, h * 0.45 - 4); // warm cabin light
      g.strokeStyle = S.trim; g.lineWidth = 6; g.stroke();
      g.strokeStyle = S.trim; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, top + 4); g.lineTo(cx, top + h); g.moveTo(cx - w / 2, top + h * 0.55); g.lineTo(cx + w / 2, top + h * 0.55); g.stroke();
    }
  };
  const pw = 1.9 / S.L;
  for (let s = 0.02; s < 0.27; s += pw * 1.25) panel(s, s + pw, 3.4, 3.4 + 1.6 * S.hs, true);
  for (let s = 0.02; s < 0.12; s += pw * 1.25) panel(s, s + pw, 3.4 + 2.2 * S.hs, 3.4 + 3.7 * S.hs, true);
  for (let s = 0.8; s < 0.95; s += pw * 1.3) panel(s, s + pw, 3.3, 3.3 + 1.5 * S.hs, false);
  // wales: dark thick bands with a sunlit lip
  for (const y of [0.85, 2.35, 3.15]) {
    g.fillStyle = S.wale; g.fillRect(0, Y(y + 0.22), W, Y(y) - Y(y + 0.22));
    g.fillStyle = "rgba(255,230,190,0.25)"; g.fillRect(0, Y(y + 0.22), W, 3);
  }
  // gold trim line following the rail, and along the castle steps
  g.strokeStyle = S.trim; g.lineWidth = 9; g.beginPath();
  for (let i = 0; i <= 600; i++) { const s = i / 600, y = ptop(s) + 0.28 * (Hh / (YMAX - YMIN)); if (i) g.lineTo(X(s), y); else g.moveTo(X(s), y); }
  g.stroke();
  g.strokeStyle = "rgba(60,30,6,0.7)"; g.lineWidth = 2; g.stroke();
  // gun ports on the band (lids open upward), lower row; castle row
  const port = (s: number, yc: number, sz: number) => {
    const cx = X(s), cy = Y(yc), w = sz * PX, h = sz * (Hh / (YMAX - YMIN));
    g.fillStyle = S.lid; g.fillRect(cx - w / 2 - 3, cy - h * 1.62, w + 6, h * 0.62); // lid
    g.strokeStyle = "rgba(30,10,5,0.8)"; g.lineWidth = 3; g.strokeRect(cx - w / 2 - 3, cy - h * 1.62, w + 6, h * 0.62);
    g.fillStyle = "#170d09"; g.fillRect(cx - w / 2, cy - h / 2, w, h);
    g.strokeStyle = S.trim; g.lineWidth = 4; g.strokeRect(cx - w / 2, cy - h / 2, w, h);
  };
  for (const s of PORTS) port(s, 1.72, 0.62);
  for (const s of [0.06, 0.15, 0.24]) port(s, 4.15 * S.hs + 0.4, 0.5);
  // waterline: dark band + thin light line
  g.fillStyle = "rgba(25,15,10,0.75)"; g.fillRect(0, Y(0.28), W, Y(-0.25) - Y(0.28));
  g.fillStyle = "rgba(240,226,190,0.8)"; g.fillRect(0, Y(0.3), W, 4);
  if (S.wreck) weather(g, r, W, Hh);
});
export const PORTS = [0.24, 0.32, 0.4, 0.48, 0.56, 0.64, 0.72];

/** algae, grime, barnacles and holes over any painting (the wreck) */
const weather = (g: G, r: () => number, W: number, H: number, k = 1) => {
  g.fillStyle = "rgba(30,60,48,0.42)"; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 140 * k; i++) {
    const x = r() * W, y = r() * H, rad = 20 + r() * 90;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    const c = r() < 0.6 ? "70,130,60" : "40,80,50";
    gr.addColorStop(0, `rgba(${c},0.55)`); gr.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 60 * k; i++) { // streaks
    const x = r() * W, y = r() * H * 0.6;
    g.fillStyle = "rgba(20,40,30,0.25)"; g.fillRect(x, y, 4 + r() * 6, 80 + r() * 200);
  }
  for (let i = 0; i < 500 * k; i++) { // barnacles
    const x = r() * W, y = H * (0.45 + 0.55 * r());
    g.fillStyle = "rgba(220,225,200,0.75)"; g.beginPath(); g.arc(x, y, 2 + r() * 3, 0, TAU); g.fill();
  }
  for (let i = 0; i < 5 * k; i++) { // holes with broken plank edges
    const x = W * (0.15 + 0.7 * r()), y = H * (0.45 + 0.25 * r()), w = 50 + r() * 90, h = 30 + r() * 50;
    g.fillStyle = "#0b1412"; g.beginPath();
    for (let a = 0; a < 14; a++) { const t = (a / 14) * TAU, rr = 1 + (r() - 0.5) * 0.6; const px = x + Math.cos(t) * w * rr, py = y + Math.sin(t) * h * rr; if (a) g.lineTo(px, py); else g.moveTo(px, py); }
    g.closePath(); g.fill();
  }
};

/** square sail canvas: panel seams, bolt rope, reef points, patches, optional Burgundy cross, belly shading */
const sailTex = (S: ShipStyle, cross: boolean) => ctex(`sail${S.key}${cross ? "X" : ""}`, 1024, 1024, (g, r) => {
  const W = 1024, H = 1024;
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, S.cloth); gr.addColorStop(1, jit(r, S.cloth, 0.06, 2, 0.1));
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 3; i++) { // soft belly shading blotches
    const x = W * (0.2 + 0.6 * r()), y = H * (0.3 + 0.5 * r()), rad = 260 + r() * 200;
    const b = g.createRadialGradient(x, y, 0, x, y, rad); b.addColorStop(0, "rgba(150,120,80,0.10)"); b.addColorStop(1, "rgba(150,120,80,0)");
    g.fillStyle = b; g.fillRect(0, 0, W, H);
  }
  const n = 9;
  for (let i = 1; i < n; i++) { const x = (i / n) * W; g.fillStyle = "rgba(120,96,60,0.45)"; g.fillRect(x - 1.5, 0, 3, H); g.fillStyle = "rgba(255,250,235,0.5)"; g.fillRect(x + 2, 0, 2, H); }
  for (let k = 0; k < 2; k++) { // patches
    const x = W * (0.1 + 0.7 * r()), y = H * (0.45 + 0.4 * r()), w = 90 + r() * 70, h = 70 + r() * 60;
    g.fillStyle = jit(r, S.cloth, 0.12, 4, 0.3); g.fillRect(x, y, w, h);
    g.setLineDash([6, 6]); g.strokeStyle = "rgba(90,70,40,0.6)"; g.lineWidth = 2.5; g.strokeRect(x + 5, y + 5, w - 10, h - 10); g.setLineDash([]);
  }
  for (const y of [110, 180]) for (let x = 30; x < W; x += 38) { g.fillStyle = "rgba(90,70,45,0.7)"; g.fillRect(x, y, 4, 14); } // reef points
  if (cross) ragged(g, [[150, 150, 874, 900], [874, 150, 150, 900]], 70, "rgba(190,30,42,0.92)");
  g.strokeStyle = "rgba(110,85,55,0.9)"; g.lineWidth = 14; g.strokeRect(7, 7, W - 14, H - 14); // bolt rope
  if (S.wreck) weather(g, r, W, H, 0.5);
});
const deckTex = (S: ShipStyle) => S.wreck ? ctex("deckWreck", 1024, 1024, (g, r) => {
  const src = planksHD().image as HTMLCanvasElement; g.drawImage(src, 0, 0, 1024, 1024); weather(g, r, 1024, 1024, 0.4);
}) : planksHD();
/** castle front bulkhead: door + two windows framed in gold */
const bulkTex = (S: ShipStyle) => ctex("bulk" + S.key, 1024, 512, (g, r) => {
  g.fillStyle = S.upper; g.fillRect(0, 0, 1024, 512);
  for (let x = 0; x < 1024; x += 64) { g.fillStyle = "rgba(30,10,5,0.35)"; g.fillRect(x, 0, 3, 512); }
  g.fillStyle = S.trim; g.fillRect(0, 0, 1024, 26); g.fillRect(0, 486, 1024, 26);
  const arch = (cx: number, w: number, top: number, bot: number, fill: string) => {
    g.fillStyle = fill; g.beginPath(); g.moveTo(cx - w / 2, bot); g.lineTo(cx - w / 2, top + w / 2); g.arc(cx, top + w / 2, w / 2, Math.PI, 0); g.lineTo(cx + w / 2, bot); g.closePath(); g.fill();
    g.strokeStyle = S.trim; g.lineWidth = 12; g.stroke();
  };
  arch(512, 170, 150, 512, "#2a1810");
  g.fillStyle = "#e0b04a"; g.beginPath(); g.arc(560, 360, 9, 0, TAU); g.fill();
  for (const cx of [230, 794]) { arch(cx, 120, 120, 330, "#1d2440"); g.fillStyle = "rgba(255,206,120,0.5)"; g.fillRect(cx - 50, 250, 100, 70); }
  if (S.wreck) weather(g, r, 1024, 512, 0.3);
});
/** transom: the stern gallery (two rows of lit windows, gold carvings) over planks */
const sternTex = (S: ShipStyle, hull: Hull) => ctex("stern" + S.key, 1024, 1024, (g, r) => {
  const W = 1024, Hh = 1024, Y = (y: number) => (1 - vOfY(y)) * Hh;
  for (let y = YMIN; y < YMAX; y += 0.34) { g.fillStyle = jit(r, y < 0 ? S.bottom : S.wood, 0.05, 2, 0.06); g.fillRect(0, Y(y + 0.34), W, Y(y) - Y(y + 0.34) + 1); g.fillStyle = "rgba(28,12,6,0.8)"; g.fillRect(0, Y(y) - 2, W, 3); }
  const top = hull.H(0) - 0.4, mid = 3.3;
  g.fillStyle = S.upper; g.fillRect(0, Y(top), W, Y(mid) - Y(top));
  g.strokeStyle = S.trim; g.lineWidth = 14; g.strokeRect(40, Y(top) + 10, W - 80, Y(mid) - Y(top) - 20);
  for (const [y0, n] of [[mid + 0.9, 5], [mid + 0.9 + 2.0 * S.hs, 4]] as const) {
    for (let i = 0; i < n; i++) {
      const cx = W * (0.5 + (i - (n - 1) / 2) * 0.16), w = 96, h = 1.2 * (Hh / (YMAX - YMIN)), tp = Y(y0 + 1.2);
      g.fillStyle = "#1d2440"; g.beginPath(); g.moveTo(cx - w / 2, tp + h); g.lineTo(cx - w / 2, tp + w / 2); g.arc(cx, tp + w / 2, w / 2, Math.PI, 0); g.lineTo(cx + w / 2, tp + h); g.closePath(); g.fill();
      g.fillStyle = "rgba(255,200,110,0.75)"; g.fillRect(cx - w / 2 + 6, tp + h * 0.45, w - 12, h * 0.5);
      g.strokeStyle = S.trim; g.lineWidth = 9; g.stroke();
      g.lineWidth = 4; g.beginPath(); g.moveTo(cx, tp + 6); g.lineTo(cx, tp + h); g.stroke();
    }
  }
  // gold cartouche (an empty oval wreath, no heraldry) between the window rows
  const cy = Y(mid + 0.9 + 1.55 * S.hs);
  g.fillStyle = S.trim; g.beginPath(); g.ellipse(W / 2, cy, 120, 52, 0, 0, TAU); g.fill();
  g.fillStyle = S.upper; g.beginPath(); g.ellipse(W / 2, cy, 92, 34, 0, 0, TAU); g.fill();
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) { g.fillStyle = S.trim; g.beginPath(); g.ellipse(W / 2 + s * (150 + k * 46), cy + (k % 2 ? -10 : 10), 26, 14, s * 0.4, 0, TAU); g.fill(); }
  g.fillStyle = "rgba(25,15,10,0.75)"; g.fillRect(0, Y(0.28), W, Y(-0.25) - Y(0.28));
  if (S.wreck) weather(g, r, W, Hh, 0.6);
});

// ---------------- geometry helpers ----------------
const cyl = (a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, seg = 8) => {
  const d = b.clone().sub(a), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, false).translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a, q, V(1, 1, 1)));
};

export type ShipObj = { g: THREE.Group; flags: Flag[]; sails: THREE.Mesh[]; hull: Hull; style: ShipStyle; spots: Record<string, V3> };

/** the ship builder: lofted hull with painted sides, transom, decks, castle bulkheads, rails, cannons, masts, yards,
 *  billowing sails, standing rigging with ratlines, flags, lanterns. wreck = broken masts, no flags, rags, weathered */
export const buildShip = (S: ShipStyle): ShipObj => {
  const hull = hullOf(S), g = new THREE.Group(), b = new Batch(), flags: Flag[] = [], sails: THREE.Mesh[] = [];
  const r = rng(S.key.length * 7 + 3);
  // ---- hull sides (both), smooth normals ----
  const N = 72, M = 18, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1), yk = hull.keel(s), yt = hull.H(s);
      for (let j = 0; j < M; j++) {
        const t = j / (M - 1), y = yk + (yt - yk) * t;
        pos.push(side * hull.half(s, y), y, hull.z(s)); uv.push(s, vOfY(y));
      }
    }
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < M - 1; j++) {
      const a = base + i * M + j, bq = base + (i + 1) * M + j, c = base + (i + 1) * M + j + 1, d = base + i * M + j + 1;
      if (side > 0) idx.push(a, c, bq, a, d, c); else idx.push(a, bq, c, a, c, d);
    }
  }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); hg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); hg.setIndex(idx);
  hg.computeVertexNormals();
  const hullTx = hullTex(S, hull); hullTx.anisotropy = 16;
  b.add(hg, lam("hullM" + S.key, () => ({ map: hullTx, side: THREE.DoubleSide })));
  // ---- transom (stern face) ----
  {
    const pts: THREE.Vector2[] = [];
    const yk = hull.keel(0), yt = hull.H(0);
    for (let j = 0; j <= 24; j++) { const y = yk + ((yt - yk) * j) / 24; pts.push(new THREE.Vector2(hull.half(0, y), y)); }
    for (let j = 24; j >= 0; j--) { const y = yk + ((yt - yk) * j) / 24; pts.push(new THREE.Vector2(-hull.half(0, y), y)); }
    const tg = new THREE.ShapeGeometry(new THREE.Shape(pts));
    const w0 = hull.half(0, 1.5);
    const p = tg.attributes.position as THREE.BufferAttribute, u = tg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) u.setXY(i, 0.5 + p.getX(i) / (2 * w0 * 1.02), vOfY(p.getY(i)));
    tg.rotateY(Math.PI); tg.translate(0, 0, hull.z(0) - 0.01);
    const sx = sternTex(S, hull);
    b.add(tg, lam("sternM" + S.key, () => ({ map: sx, side: THREE.DoubleSide })));
  }
  // ---- decks (planks along z) and castle bulkheads ----
  const deckM = lam("deckM" + S.key, () => ({ map: rep(deckTex(S), 1, 1), color: S.wreck ? "#b8c4a8" : "#ffffff" }));
  const deck = (s0: number, s1: number, y: number) => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 20; i++) { const s = s0 + ((s1 - s0) * i) / 20; pts.push(new THREE.Vector2(hull.half(s, y) - 0.12, -hull.z(s))); }
    for (let i = 20; i >= 0; i--) { const s = s0 + ((s1 - s0) * i) / 20; pts.push(new THREE.Vector2(-(hull.half(s, y) - 0.12), -hull.z(s))); }
    const dg = new THREE.ShapeGeometry(new THREE.Shape(pts));
    const p = dg.attributes.position as THREE.BufferAttribute, u = dg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) u.setXY(i, p.getY(i) / 2, p.getX(i) / 2);
    dg.rotateX(-Math.PI / 2); // shape (x, -z) -> world (x, 0, z), facing up
    const pp = dg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) pp.setY(i, y);
    dg.computeVertexNormals();
    const nn = dg.attributes.normal as THREE.BufferAttribute; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0);
    b.add(dg, deckM);
  };
  deck(0.0, 0.99, hull.DECK.main);
  deck(0.0, 0.3, hull.DECK.quarter);
  deck(0.0, 0.13, hull.DECK.poop);
  deck(0.78, 0.985, hull.DECK.fore);
  const bulkM = lam("bulkM" + S.key, () => ({ map: bulkTex(S), side: THREE.DoubleSide }));
  const bulkhead = (s: number, y0: number, y1: number, face: number) => {
    const w = hull.half(s, (y0 + y1) / 2) - 0.05, zz = hull.z(s);
    const q = new THREE.PlaneGeometry(2 * w, y1 - y0).translate(0, (y0 + y1) / 2, 0);
    if (face < 0) q.rotateY(Math.PI);
    q.translate(0, 0, zz);
    b.add(q, bulkM);
  };
  bulkhead(0.3, hull.DECK.main, hull.H(0.2), 1);
  bulkhead(0.13, hull.DECK.quarter, hull.H(0.05), 1);
  bulkhead(0.78, hull.DECK.main, hull.H(0.9), -1);
  // ---- rail caps along the top of the sides ----
  const railM = lam("rail" + S.key, () => ({ color: S.wreck ? "#3e3a2c" : "#5a321c" }));
  for (const side of [1, -1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 120; i++) { const s = i / 120, y = hull.H(s); pts.push(V(side * hull.half(s, y), y + 0.06, hull.z(s))); }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 400, 0.1, 6), railM);
  }
  // ---- cannons out of the ports ----
  const iron = lam("iron", () => ({ color: "#34343c" }));
  const guns: [number, number][] = [...PORTS.map((s) => [s, 1.72] as [number, number]), ...[0.06, 0.15, 0.24].map((s) => [s, 4.15 * S.hs + 0.4] as [number, number])];
  for (const [s, y] of guns) for (const side of [1, -1]) {
    const x = side * hull.half(s, y);
    b.add(cyl(V(x - side * 0.5, y, hull.z(s)), V(x + side * 0.75, y, hull.z(s)), 0.2, 0.15, 10), iron);
    b.add(new THREE.TorusGeometry(0.17, 0.05, 6, 12).rotateY(Math.PI / 2).translate(x + side * 0.75, y, hull.z(s)), iron);
  }
  // ---- masts, tops, yards, sails, rigging ----
  const woodM = lam("spar" + S.key, () => ({ color: S.wreck ? "#5a5a40" : "#9a6a3c" }));
  const rope = lam("rope" + S.key, () => ({ color: S.wreck ? "#3a4434" : "#4a3626" }));
  const R = (a: THREE.Vector3, c: THREE.Vector3, w = 0.035) => b.add(cyl(a, c, w, w, 4), rope);
  type Mast = { s: number; top: number; low: number; course: number; topsail: number; cw: number; tw: number; base: number; lateen?: boolean };
  const hsc = S.hs;
  const MASTS: Mast[] = [
    { s: 0.5, top: 26 * hsc + 2, low: 16.2 * hsc, course: 14.6 * hsc, topsail: 23.2 * hsc + 1.5, cw: 15.5 * (S.B / 9), tw: 10.5 * (S.B / 9), base: hull.DECK.main },
    { s: 0.76, top: 22.5 * hsc + 1.5, low: 13.8 * hsc, course: 12.6 * hsc, topsail: 20 * hsc + 1, cw: 12.5 * (S.B / 9), tw: 8.8 * (S.B / 9), base: hull.DECK.main },
    { s: 0.19, top: 17.5 * hsc + 1, low: 99, course: 0, topsail: 0, cw: 0, tw: 0, base: hull.DECK.quarter, lateen: true },
  ];
  const spots: Record<string, V3> = {};
  const sailM = (cross: boolean) => lam(`sailM${S.key}${cross ? "X" : ""}`, () => ({ map: sailTex(S, cross), side: THREE.DoubleSide, alphaTest: 0.5 }));
  const square = (w0: number, w1: number, h: number, depth: number, cross: boolean, at: THREE.Vector3) => {
    const sg = new THREE.PlaneGeometry(1, 1, 12, 10);
    const p = sg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5, t = 1 - v, w = w0 + (w1 - w0) * t;
      const bulge = depth * Math.pow(Math.sin(Math.PI * u), 0.7) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.93 + 0.02)), 0.85);
      p.setXYZ(i, (u - 0.5) * w, -t * h, bulge);
    }
    sg.computeVertexNormals();
    const m = new THREE.Mesh(sg, sailM(cross)); m.position.copy(at); m.castShadow = true; m.receiveShadow = true;
    g.add(m); sails.push(m);
    return m;
  };
  for (const [mi, m] of MASTS.entries()) {
    const zz = hull.z(m.s), broken = S.wreck ? [9.5, 7.0, 0][mi] : 0;
    if (S.wreck && broken === 0) continue;
    const topY = broken || m.top;
    b.add(cyl(V(0, m.base - 0.2, zz), V(0, topY, zz), mi === 2 ? 0.26 : 0.36, broken ? 0.3 : 0.14, 10), woodM);
    if (broken) { // splintered top
      for (let k = 0; k < 5; k++) b.add(cyl(V(0, topY - 0.3, zz), V(0.25 * Math.cos(k * 1.3), topY + 0.5 + 0.4 * (k % 2), zz + 0.25 * Math.sin(k * 1.3)), 0.09, 0.02, 4), woodM);
      continue;
    }
    if (m.lateen) { // mizzen: lateen yard + triangular sail
      const a = V(0, m.base + 2.2, zz - 5.5), c = V(0, m.top - 0.5, zz + 3.0);
      b.add(cyl(a, c, 0.12, 0.08, 6), woodM);
      const tri = new THREE.BufferGeometry();
      const P: number[] = [], UV: number[] = [], I: number[] = [];
      const n = 8;
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const u = i / n, v = j / n; // barycentric over (a, c, foot)
        const foot = V(0, m.base + 1.0, zz + 2.6);
        const pnt = a.clone().multiplyScalar(1 - u - v).add(c.clone().multiplyScalar(u)).add(foot.clone().multiplyScalar(v));
        pnt.x += 1.1 * Math.sin(Math.PI * Math.min(1, (u + v))) * (1 - u - v + 0.3) * u * 2;
        P.push(pnt.x, pnt.y, pnt.z); UV.push(0.1 + u * 0.8, 0.95 - v * 0.8);
      }
      const id = (i: number, j: number) => { let k = 0; for (let ii = 0; ii < i; ii++) k += n - ii + 1; return k + j; };
      for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) { I.push(id(i, j), id(i + 1, j), id(i, j + 1)); if (j < n - i - 1) I.push(id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)); }
      tri.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); tri.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); tri.setIndex(I); tri.computeVertexNormals();
      const sm = new THREE.Mesh(tri, sailM(false)); sm.castShadow = true; g.add(sm); sails.push(sm);
      flags.push(new Flag(g, S.flag, S.flagKey, 2.0, 1.3, [0, m.top + 1.4, zz], 1.7));
      b.add(cyl(V(0, m.top, zz), V(0, m.top + 1.4, zz), 0.06, 0.05, 6), woodM);
      // mizzen shrouds
      for (const side of [1, -1]) for (const dz of [-1.2, -0.3, 0.6]) R(V(side * 0.25, m.top - 1.5, zz), V(side * hull.half(m.s + dz / S.L, hull.H(m.s)), hull.H(m.s + dz / S.L) + 0.1, zz + dz));
      R(V(0, m.top - 0.6, zz), V(0, MASTS[0].low - 2, hull.z(MASTS[0].s)));
      continue;
    }
    // fighting top (platform) and the cap
    b.add(new THREE.CylinderGeometry(1.5, 1.2, 0.35, 14).translate(0, m.low, zz), woodM);
    b.add(new THREE.TorusGeometry(1.5, 0.07, 6, 18).rotateX(Math.PI / 2).translate(0, m.low + 0.35, zz), woodM);
    // yards
    b.add(cyl(V(-m.cw / 2, m.course, zz + 0.45), V(m.cw / 2, m.course, zz + 0.45), 0.13, 0.1, 6), woodM);
    b.add(cyl(V(-m.tw / 2, m.topsail, zz + 0.4), V(m.tw / 2, m.topsail, zz + 0.4), 0.1, 0.08, 6), woodM);
    // sails: course (Burgundy cross on the Spanish courses) and topsail
    const courseH = m.course - (m.base + 2.4), topH = m.topsail - (m.low + 0.7);
    square(m.cw * 0.95, m.cw * 1.05, courseH, 1.9, S.cross, V(0, m.course - 0.15, zz + 0.55));
    square(m.tw * 0.95, m.cw * 0.9, topH, 1.3, false, V(0, m.topsail - 0.12, zz + 0.5));
    flags.push(new Flag(g, S.flag, S.flagKey, mi === 0 ? 2.8 : 2.3, mi === 0 ? 1.8 : 1.5, [0, m.top + 1.6, zz], mi * 1.3));
    b.add(cyl(V(0, m.top, zz), V(0, m.top + 1.6, zz), 0.07, 0.05, 6), woodM);
    // shrouds with ratlines to the rail, topmast shrouds to the top's rim, lifts and sheets
    for (const side of [1, -1]) {
      const feet = [-1.6, -0.7, 0.2, 1.1].map((dz) => { const s2 = m.s + dz / S.L; return V(side * (hull.half(s2, hull.H(s2)) + 0.05), hull.H(s2) + 0.1, zz + dz); });
      const heads = feet.map((_, k) => V(side * (1.2 - 0.12 * k), m.low - 0.05, zz + (k - 1.5) * 0.35));
      feet.forEach((f, k) => R(f, heads[k]));
      for (let y = feet[0].y + 0.7; y < m.low - 0.6; y += 0.75) {
        const at = (k: number) => { const u = (y - feet[k].y) / (heads[k].y - feet[k].y); return feet[k].clone().lerp(heads[k], u); };
        for (let k = 0; k < 3; k++) R(at(k), at(k + 1), 0.022);
      }
      for (const k of [-0.6, 0.6]) R(V(side * 1.3, m.low + 0.3, zz + k), V(side * 0.12, m.topsail + 0.4, zz));
      R(V(side * m.cw / 2, m.course, zz + 0.45), V(side * 0.15, m.low + 0.5, zz));
      R(V(side * m.tw / 2, m.topsail, zz + 0.4), V(side * 0.1, m.top - 0.3, zz));
      // sheets: course corners down to the rail aft of the mast
      const sAft = m.s - 4.2 / S.L;
      R(V(side * m.cw * 0.52, m.base + 2.5, zz + 1.3), V(side * hull.half(sAft, hull.H(sAft)), hull.H(sAft) + 0.1, hull.z(sAft)));
    }
    spots["top" + mi] = [0, m.low + 0.35, zz];
  }
  if (!S.wreck) {
    // stays: main top -> fore mast foot area, fore top -> bowsprit, topmast stays
    const bowZ = hull.z(0.985), sprit0 = V(0, hull.DECK.fore + 0.6, bowZ - 1.0), dir = V(0, Math.sin(0.42), Math.cos(0.42)), sprit1 = sprit0.clone().addScaledVector(dir, 11);
    b.add(cyl(sprit0, sprit1, 0.28, 0.13, 8), woodM);
    const [mm, fm] = MASTS;
    R(V(0, mm.low, hull.z(mm.s)), V(0, hull.DECK.main + 1.2, hull.z(fm.s) - 0.3), 0.05);
    R(V(0, mm.top - 0.4, hull.z(mm.s)), V(0, fm.low + 0.4, hull.z(fm.s)), 0.04);
    R(V(0, fm.low, hull.z(fm.s)), sprit0.clone().addScaledVector(dir, 6), 0.05);
    R(V(0, fm.top - 0.4, hull.z(fm.s)), sprit1, 0.04);
    // beakhead: a small railed platform in front of the stem (the captain's stage in shot 3)
    const bk = hull.z(1), by = hull.DECK.fore - 0.25;
    b.add(new THREE.BoxGeometry(2.0, 0.22, 2.4).translate(0, by - 0.11, bk + 1.1), deckM);
    b.add(new THREE.BoxGeometry(2.1, 0.5, 2.5).translate(0, by - 0.47, bk + 1.1), lam("hullM" + S.key, () => ({ map: hullTex(S, hull), side: THREE.DoubleSide })));
    for (const sx of [-1, 1]) {
      b.add(cyl(V(sx * 1.0, by + 0.6, bk), V(sx * 1.0, by + 0.6, bk + 2.3), 0.05, 0.05, 6), railM);
      for (const zz of [0.4, 1.2, 2.0]) b.add(cyl(V(sx * 1.0, by, bk + zz), V(sx * 1.0, by + 0.6, bk + zz), 0.04, 0.04, 6), railM);
    }
    b.add(cyl(V(-1.0, by + 0.6, bk + 2.3), V(1.0, by + 0.6, bk + 2.3), 0.05, 0.05, 6), railM);
    spots.beak = [-0.55, by, bk + 1.3];
    // stern lanterns + ensign staff
    const sz = hull.z(0) - 0.3, ty = hull.H(0);
    const glass = new THREE.MeshLambertMaterial({ color: "#ffd27a", emissive: new THREE.Color(2.2, 1.5, 0.6) });
    for (const x of [-hull.half(0, ty) + 0.5, 0, hull.half(0, ty) - 0.5]) {
      const gold = lam("gold" + S.key, () => ({ color: S.trim }));
      b.add(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6).translate(x, ty + 0.6, sz - 0.4), gold);
      const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.75, 8), glass); lantern.position.set(x, ty + 1.5, sz - 0.4); g.add(lantern);
      b.add(new THREE.ConeGeometry(0.34, 0.4, 8).translate(x, ty + 2.08, sz - 0.4), gold);
    }
    b.add(cyl(V(0, hull.DECK.poop, sz - 0.2), V(0, hull.DECK.poop + 5.2, sz - 1.2), 0.07, 0.05, 6), woodM);
    flags.push(new Flag(g, S.flag, S.flagKey, 3.6, 2.4, [0, hull.DECK.poop + 5.15, sz - 1.2], 2.2));
    // jack staff at the bow with its flag (in frame with a captain on the forecastle)
    b.add(cyl(V(0, hull.DECK.fore + 0.3, bowZ - 1.2), V(0, hull.DECK.fore + 3.0, bowZ - 1.2), 0.05, 0.04, 6), woodM);
    flags.push(new Flag(g, S.flag, S.flagKey, 1.9, 1.25, [0, hull.DECK.fore + 3.0, bowZ - 1.2], 0.6));
    spots.jack = [0, hull.DECK.fore + 3.0, bowZ - 1.2];
  } else {
    // the wreck: a fallen topmast across the deck, torn rags on the main yard stub
    b.add(cyl(V(-3.5, hull.DECK.main + 0.6, hull.z(0.4)), V(5.5, hull.DECK.main + 2.4, hull.z(0.62)), 0.28, 0.18, 8), woodM);
    b.add(cyl(V(-4.5, 7.6, hull.z(0.5) + 0.4), V(3.0, 8.2, hull.z(0.5) + 0.4), 0.12, 0.1, 6), woodM);
    const rag = square(4.5, 3.2, 3.4, 0.4, true, V(-1.2, 7.5, hull.z(0.5) + 0.55));
    rag.rotation.z = 0.12;
  }
  b.build(g);
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  spots.fore = [0, hull.DECK.fore, hull.z(0.88)];
  spots.main = [0, hull.DECK.main, hull.z(0.5)];
  spots.quarter = [0, hull.DECK.quarter, hull.z(0.22)];
  return { g, flags, sails, hull, style: S, spots };
};
/** gentle sail breathing + flags */
export const poseShip = (o: ShipObj, t: number) => {
  o.flags.forEach((f) => f.pose(t, 1));
  o.sails.forEach((m, i) => { m.scale.z = 1 + 0.07 * Math.sin(t * 1.3 + i * 0.7); });
};

// ---------------- the treasure chest ----------------
/** dark plank wood, gold bands, corner brackets, lock plate; lid hinged at the back (open = radians) */
const chestWood = () => ctex("chestWood", 512, 512, (g, r) => {
  const n = 5, h = 512 / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = jit(r, "#b0703a", 0.07, 3, 0.1); g.fillRect(0, i * h, 512, h);
    for (let k = 0; k < 6; k++) { g.strokeStyle = "rgba(50,22,8,0.3)"; g.lineWidth = 2; const y = i * h + 8 + r() * (h - 16); g.beginPath(); g.moveTo(0, y); g.lineTo(512, y + (r() - 0.5) * 6); g.stroke(); }
    g.fillStyle = "rgba(255,225,180,0.22)"; g.fillRect(0, i * h + 3, 512, 3);
    g.fillStyle = "#1e0d05"; g.fillRect(0, i * h - 2, 512, 5);
  }
});
export type ChestObj = { g: THREE.Group; lid: THREE.Group; glow: THREE.Sprite; gold: THREE.MeshLambertMaterial };
export const buildChest = (open: number, full = true): ChestObj => {
  const g = new THREE.Group(), b = new Batch();
  const W = 1.15, H = 0.6, D = 0.72;
  const wood = lam("chestWoodM", () => ({ map: rep(chestWood(), 1, 1), emissive: new THREE.Color("#4a2208") })); // stays warm under the blue water
  const gold = lam("chestGold", () => ({ color: "#e9b43c", emissive: new THREE.Color("#4a2a00") }));
  const dark = lam("chestInside", () => ({ color: "#2a140a" }));
  b.add(new THREE.BoxGeometry(W, H, D).translate(0, H / 2, 0), wood);
  b.add(new THREE.BoxGeometry(W - 0.1, 0.02, D - 0.1).translate(0, H - 0.05, 0), dark);
  for (const x of [-0.42, 0, 0.42]) b.add(new THREE.BoxGeometry(0.07, H + 0.01, D + 0.02).translate(x, H / 2, 0), gold); // bands
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(new THREE.BoxGeometry(0.12, H + 0.02, 0.12).translate(sx * (W / 2 - 0.04), H / 2, sz * (D / 2 - 0.04)), gold); // corners
  b.add(new THREE.BoxGeometry(W + 0.02, 0.06, D + 0.02).translate(0, 0.03, 0), gold);
  b.add(new THREE.BoxGeometry(0.2, 0.22, 0.04).translate(0, H - 0.14, D / 2 + 0.02), gold); // lock plate
  for (const sx of [-1, 1]) b.add(new THREE.TorusGeometry(0.08, 0.02, 6, 12, Math.PI).rotateY(Math.PI / 2).translate(sx * (W / 2 + 0.02), H * 0.62, 0), gold);
  b.build(g);
  // lid: half cylinder along x, hinged at the back top edge
  const lid = new THREE.Group(), lb = new Batch();
  const shell = new THREE.CylinderGeometry(D / 2, D / 2, W, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2);
  lb.add(shell.translate(0, 0, D / 2), wood);
  for (const x of [-0.42, 0, 0.42]) lb.add(new THREE.CylinderGeometry(D / 2 + 0.015, D / 2 + 0.015, 0.07, 20, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).translate(x, 0, D / 2), gold);
  lb.add(new THREE.CylinderGeometry(D / 2 - 0.02, D / 2 - 0.02, W - 0.04, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, -0.005, D / 2), dark);
  lb.build(lid);
  lid.position.set(0, H, -D / 2); lid.rotation.x = -open;
  g.add(lid);
  // the gold inside: HDR emissive heap so the bloom catches it, plus a warm halo
  const goldGlow = new THREE.MeshLambertMaterial({ color: "#f2b52a", emissive: new THREE.Color(1.05, 0.62, 0.06) }); // saturated gold, a little bloom
  if (full) {
    const heap = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, Math.PI / 2), goldGlow);
    heap.scale.set(W / 2 - 0.06, 0.24, D / 2 - 0.06); heap.position.y = H - 0.04; g.add(heap);
    const coin = new THREE.CylinderGeometry(0.05, 0.05, 0.013, 12), cr = rng(77);
    const im = new THREE.InstancedMesh(coin, goldGlow, 80), m4 = new THREE.Matrix4();
    for (let i = 0; i < 80; i++) {
      const a = cr() * TAU, rr = Math.sqrt(cr()), x = Math.cos(a) * rr * (W / 2 - 0.08), z = Math.sin(a) * rr * (D / 2 - 0.08);
      const y = H - 0.04 + 0.24 * Math.sqrt(Math.max(0, 1 - rr * rr)) + 0.01;
      im.setMatrixAt(i, m4.compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((cr() - 0.5) * 1.2, cr() * 6, (cr() - 0.5) * 1.2)), V(1, 1, 1)));
    }
    g.add(im);
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: new THREE.Color(0.95, 0.55, 0.1), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.position.set(0, H + 0.3, 0); glow.scale.setScalar(2.6); glow.layers.set(NOINK); glow.visible = full;
  g.add(glow);
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return { g, lid, glow, gold: goldGlow };
};
export const haloTex = () => ctex("halo2", 256, 256, (g) => {
  const im = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const u = Math.hypot(x - 127.5, y - 127.5) / 128;
    const a = (0.55 * Math.exp(-((u / 0.22) ** 2)) + 0.3 * Math.exp(-((u / 0.55) ** 2))) * (1 - st(0.8, 1, u));
    const i = (y * 256 + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = Math.round(255 * clamp(a)); im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
});

// ---------------- the survivors' rowboat ----------------
const boatWood = () => ctex("rowboatWood", 512, 256, (g, r) => {
  const n = 7, h = 256 / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = jit(r, i < 1 ? "#5a3a2a" : "#b0703a", 0.06, 3, 0.1); g.fillRect(0, i * h, 512, h);
    g.fillStyle = "rgba(255,228,190,0.25)"; g.fillRect(0, i * h + 3, 512, 3);
    for (let k = 0; k < 5; k++) { g.strokeStyle = "rgba(80,40,15,0.25)"; g.lineWidth = 2; const y = i * h + 6 + r() * (h - 12); g.beginPath(); g.moveTo(0, y); g.lineTo(512, y + (r() - 0.5) * 4); g.stroke(); }
    g.fillStyle = "#2a1408"; g.fillRect(0, i * h - 2, 512, 4);
  }
});
/** a rounded clinker-style rowboat (length L, beam B), planked paint, thwarts and gunwale; local +z = bow */
export const buildRowboat = (L = 4.4, B = 1.7) => {
  const g = new THREE.Group(), b = new Batch(), N = 28, M = 9, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const half = (s: number, t: number) => (B / 2) * Math.pow(Math.sin(Math.PI * clamp(s, 0.02, 0.98)), 0.55) * Math.pow(t, 0.5);
  const y = (s: number, t: number) => -0.42 + t * (0.42 + 0.48 + 0.18 * (2 * s - 1) ** 2);
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const s = i / (N - 1), t = j / (M - 1); pos.push(side * half(s, t), y(s, t), -L / 2 + s * L); uv.push(s * 3, t); }
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < M - 1; j++) {
      const a = base + i * M + j, bq = base + (i + 1) * M + j, c = base + (i + 1) * M + j + 1, d = base + i * M + j + 1;
      if (side > 0) idx.push(a, c, bq, a, d, c); else idx.push(a, bq, c, a, c, d);
    }
  }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); hg.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); hg.setIndex(idx); hg.computeVertexNormals();
  const wood = lam("rowboatM", () => ({ map: rep(boatWood(), 1, 1), side: THREE.DoubleSide }));
  b.add(hg, wood);
  const rail = lam("rowRail", () => ({ color: "#6a3f22" }));
  for (const side of [1, -1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 30; i++) { const s = i / 30; pts.push(V(side * half(s, 1), y(s, 1) + 0.02, -L / 2 + s * L)); }
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.05, 6), rail);
  }
  for (const s of [0.3, 0.55, 0.78]) { const w = half(s, 0.82) * 2; b.add(new THREE.BoxGeometry(w, 0.06, 0.28).translate(0, y(s, 0.82), -L / 2 + s * L), rail); }
  b.add(new THREE.BoxGeometry(B * 0.6, 0.04, L * 0.7).translate(0, -0.3, 0), rail); // floorboards
  b.build(g);
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return g;
};

// ---------------- the ROV ----------------
export type RovObj = { g: THREE.Group; beams: THREE.Mesh[]; halos: THREE.Sprite[] };
const beamTex = () => ctex("lampBeam2", 64, 256, (g) => {
  const im = g.createImageData(64, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
    const v = y / 255, u = Math.abs(x - 31.5) / 32;
    const a = Math.pow(1 - v, 1.3) * (1 - 0.35 * u);
    const i = (y * 64 + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = Math.round(255 * a); im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
});
/** small work-class robot: open tube frame, rounded yellow float, two ducted thrusters, camera dome, two lamps with
 *  visible light cones, a manipulator arm; local +z = forward */
export const buildROV = (): RovObj => {
  const g = new THREE.Group(), b = new Batch();
  const frame = lam("rovFrame", () => ({ color: "#3b4250" })), yellow = lam("rovYellow2", () => ({ color: "#ffc61a" })), grey = lam("rovGrey2", () => ({ color: "#9aa2ac" }));
  const L = 1.8, Wd = 1.3, Hh = 0.9;
  const c = (x: number, y: number, z: number) => V(x * Wd / 2, y * Hh / 2, z * L / 2);
  for (const [a, d] of [[[-1, -1, -1], [1, -1, -1]], [[-1, -1, 1], [1, -1, 1]], [[-1, 1, -1], [1, 1, -1]], [[-1, 1, 1], [1, 1, 1]],
    [[-1, -1, -1], [-1, -1, 1]], [[1, -1, -1], [1, -1, 1]], [[-1, 1, -1], [-1, 1, 1]], [[1, 1, -1], [1, 1, 1]],
    [[-1, -1, -1], [-1, 1, -1]], [[1, -1, -1], [1, 1, -1]], [[-1, -1, 1], [-1, 1, 1]], [[1, -1, 1], [1, 1, 1]]] as [number[], number[]][])
    b.add(cyl(c(a[0], a[1], a[2]), c(d[0], d[1], d[2]), 0.045, 0.045, 8), frame);
  // rounded float on top
  b.add(new THREE.CapsuleGeometry(0.42, L - 0.8, 6, 14).rotateX(Math.PI / 2).scale(1.35, 0.75, 1).translate(0, Hh / 2 + 0.22, 0), yellow);
  // electronics pod inside the frame
  b.add(new THREE.CylinderGeometry(0.2, 0.2, L * 0.7, 14).rotateX(Math.PI / 2).translate(0, -0.05, 0), grey);
  // ducted thrusters both sides at the back + one vertical
  for (const s of [-1, 1]) {
    b.add(new THREE.CylinderGeometry(0.24, 0.24, 0.36, 18, 1, true).rotateX(Math.PI / 2).translate(s * (Wd / 2 + 0.22), 0, -L / 2 + 0.3), yellow);
    b.add(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 8).rotateX(Math.PI / 2).translate(s * (Wd / 2 + 0.22), 0, -L / 2 + 0.3), frame);
    b.add(cyl(c(s, 0, -0.65), V(s * (Wd / 2 + 0.22), 0, -L / 2 + 0.3), 0.03, 0.03, 6), frame);
  }
  b.add(new THREE.TorusGeometry(0.22, 0.05, 8, 18).rotateX(Math.PI / 2).translate(0, Hh / 2 + 0.6, -0.3), yellow);
  // camera dome
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 10, 0, TAU, 0, Math.PI / 2).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: "#1a2433", emissive: new THREE.Color("#0a1830") }));
  dome.position.set(0, 0.0, L / 2 + 0.02); g.add(dome);
  // manipulator arm
  b.add(cyl(V(0.35, -Hh / 2, L / 2 - 0.1), V(0.4, -Hh / 2 - 0.25, L / 2 + 0.4), 0.04, 0.04, 6), grey);
  b.add(cyl(V(0.4, -Hh / 2 - 0.25, L / 2 + 0.4), V(0.32, -Hh / 2 - 0.4, L / 2 + 0.65), 0.035, 0.03, 6), grey);
  b.build(g);
  const beams: THREE.Mesh[] = [], halos: THREE.Sprite[] = [];
  for (const s of [-1, 1]) {
    const hx = s * 0.48, hy = Hh / 2 - 0.05, hz = L / 2 + 0.05;
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.26, 12).rotateX(Math.PI / 2), grey); housing.position.set(hx, hy, hz); g.add(housing);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.1, 18), new THREE.MeshBasicMaterial({ color: new THREE.Color(10, 9.5, 7.5) }));
    lens.position.set(hx, hy, hz + 0.135); g.add(lens);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(2.4, 12, 24, 1, true).translate(0, -6, 0).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: beamTex(), color: new THREE.Color(0.75, 0.72, 0.58), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    beam.position.set(hx, hy, hz + 0.14); beam.layers.set(NOINK); beam.renderOrder = 4; beam.frustumCulled = false; g.add(beam); beams.push(beam);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: new THREE.Color(2.4, 2.2, 1.7), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    halo.position.set(hx, hy, hz + 0.25); halo.scale.setScalar(1.3); halo.layers.set(NOINK); g.add(halo); halos.push(halo);
  }
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m.material as THREE.Material).transparent) m.castShadow = true; });
  return { g, beams, halos };
};
