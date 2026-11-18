// The San José world as one three.js scene, posed per frame from story.ts (pure function of shot id + frame):
// sky, Caribbean sea surface, seabed (sand, wreck, open chest with gold and emeralds, light shafts, caustics), the galleon
// and the English warships (Kenney pirate kit, our own flags), island + palm coast, survivors' rowboat and debris,
// search boats, the 2015 support ship + ROV, the Cartagena dock and fortress, and the cast (cast.ts billboards).
// Sets are groups switched per shot; the light preset is chosen per shot part (story.ts lightOf).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getInputProps, staticFile } from "remotion";
import { Batch, boxGeo, V, lam, Kit, toonMat } from "./build";
import { beam, ctex, rep, waterNear, waterFar, cloudHD, stoneHD, planksHD } from "./paint";

import { LIGHTS, LOOK, LightName, LightPreset, isUnder } from "./lights";
import { TONE, CHAR, LFB, untone } from "./shade";
import { NOINK } from "./ink";
import { Pool, Actor, Fx, stage, tugChest } from "./cast";
import { buildShip, buildChest, buildROV, buildRowboat, poseShip, SPAIN, ENGLAND, WRECK_STYLE, Flag, colombiaTex, ShipObj, ChestObj } from "./hero";
import {
  FPS, SHOTS, V3, loc, camAt, lightOf, bedY, BED, WRECK, CHEST, DIVER, DOCK_Y, DCHEST, ROWB, ISLAND, SUP, galleonPose, engPose, poseMatrix, rovPos, Pose,
} from "./story";

// ---------------- assets ----------------
const PIRATE = ["ship-large", "ship-medium", "ship-small", "ship-wreck", "chest", "barrel", "crate", "crate-bottles", "cannon", "boat-row-small", "boat-row-large",
  "castle-wall", "castle-gate", "tower-complete-large", "tower-complete-small", "palm-straight", "palm-bend", "palm-detailed-straight", "palm-detailed-bend",
  "rocks-a", "rocks-b", "rocks-c", "rocks-sand-a", "rocks-sand-b", "rocks-sand-c", "grass-plant", "structure-platform-dock", "bottle-large"];
let kitP: Promise<Kit> | null = null;
export const loadKit = () => {
  if (!kitP) {
    const loader = new GLTFLoader();
    kitP = Promise.all(PIRATE.map((n) => loader.loadAsync(staticFile(`galeon/kenney/${n}.glb`)).then((g) => [n, g.scene] as const).catch((e) => { console.error("kit", n, e); return [n, null] as const; })))
      .then((list) => Object.fromEntries(list.filter((e) => e[1]).map(([n, s]) => [n, s!])) as Kit);
  }
  return kitP;
};

/** a Kenney model as its own object: two-tone materials (optional tint / emissive), scale s, flags hidden */
const kclone = (kit: Kit, name: string, s = 1, tint?: string, emissive?: string) => {
  const src = kit[name], g = new THREE.Group();
  if (!src) return g;
  const c = src.clone(true);
  c.traverse((x) => {
    const m = x as THREE.Mesh;
    if (x.name.startsWith("flag")) x.visible = false;
    if (m.isMesh) { m.material = toonMat(Array.isArray(m.material) ? m.material[0] : m.material, tint, emissive); m.castShadow = true; m.receiveShadow = true; }
  });
  c.scale.setScalar(s);
  g.add(c);
  return g;
};
/** add a Kenney model into a static batch at (x, y, z), yaw, scale s */
const kbatch = (b: Batch, kit: Kit, name: string, x: number, y: number, z: number, s: number, yaw = 0, tint?: string) => {
  const src = kit[name];
  if (!src) return;
  src.updateMatrixWorld(true);
  const m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw), V(s, s, s));
  src.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh || c.name.startsWith("flag")) return;
    b.add(mesh.geometry, toonMat(Array.isArray(mesh.material) ? mesh.material[0] : mesh.material, tint), new THREE.Matrix4().multiplyMatrices(m, mesh.matrixWorld));
  });
};

// ---------------- painted textures ----------------
const sandTex = () => ctex("seabedSand", 512, 512, (g, r) => {
  g.fillStyle = "#e4d09c"; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 70; i++) { // ripples
    const y = r() * 512, x = r() * 512, w = 60 + r() * 120;
    g.strokeStyle = r() < 0.5 ? "rgba(255,248,220,0.45)" : "rgba(150,120,70,0.25)"; g.lineWidth = 3 + r() * 3;
    g.beginPath(); for (let k = 0; k <= 10; k++) { const xx = x + (k / 10) * w, yy = y + 5 * Math.sin(k * 0.9); if (k) g.lineTo(xx, yy); else g.moveTo(xx, yy); } g.stroke();
  }
  for (let i = 0; i < 160; i++) { g.fillStyle = r() < 0.5 ? "rgba(120,95,60,0.3)" : "rgba(255,250,230,0.4)"; g.beginPath(); g.arc(r() * 512, r() * 512, 1.5 + r() * 2.5, 0, 7); g.fill(); }
});
const causticTex = () => ctex("caustic", 256, 256, (g) => {
  const im = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const a = (2 * Math.PI) / 256, X = x * a, Y = y * a;
    const v = Math.abs(Math.sin(3 * X + 1.7 * Math.sin(2 * Y)) * Math.sin(3 * Y + 1.7 * Math.sin(2 * X + 1)));
    const c = Math.pow(1 - v, 10) + 0.6 * Math.pow(1 - Math.abs(Math.sin(5 * X + 2 * Math.sin(3 * Y + 2))), 14);
    const i = (y * 256 + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = Math.min(255, 255 * c); im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
});
const shaftTex = () => ctex("shaft", 64, 256, (g) => {
  const im = g.createImageData(64, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
    const u = Math.abs(x - 31.5) / 32, v = y / 255;
    const a = (1 - u * u) ** 2 * Math.pow(1 - v, 1.4) * (0.75 + 0.25 * Math.sin(x * 0.7));
    const i = (y * 64 + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = Math.round(255 * a); im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
});
const beamTex = () => ctex("lampBeam", 64, 256, (g) => {
  const im = g.createImageData(64, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
    const v = y / 255, u = Math.abs(x - 31.5) / 32;
    const a = Math.pow(1 - v, 1.6) * (1 - 0.5 * u);
    const i = (y * 64 + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = Math.round(255 * a); im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
});
const discTex = () => ctex("sunDisc", 128, 128, (g) => {
  const gr = g.createRadialGradient(64, 64, 58, 64, 64, 64); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});
const haloTex = () => ctex("sunHalo", 256, 256, (g) => {
  const im = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const u = Math.hypot(x - 127.5, y - 127.5) / 128;
    const a = (0.55 * Math.exp(-((u / 0.25) ** 2)) + 0.35 * Math.exp(-((u / 0.6) ** 2))) * (1 - Math.min(1, Math.max(0, (u - 0.8) / 0.2)));
    const i = (y * 256 + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = Math.round(255 * Math.min(1, a));
  }
  g.putImageData(im, 0, 0);
});
const glowMat = (map: THREE.Texture, col: THREE.ColorRepresentation, op = 1, fog = true) => new THREE.MeshBasicMaterial({
  map, color: new THREE.Color(col), transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog,
});

// ---------------- world ----------------
export class World {
  root = new THREE.Group();
  light: LightName = "day";
  private pool = new Pool();
  private actors: Actor[] = [];
  private fxs: Fx[] = [];
  private hemi: THREE.HemisphereLight; private sun: THREE.DirectionalLight;
  private sky: THREE.Mesh; private skyMat: THREE.ShaderMaterial;
  private fog = new THREE.Fog("#bccbec", 25, 420);
  private WU: Record<string, THREE.IUniform>;
  private sunDisc: THREE.Sprite; private sunHalo: THREE.Sprite;
  private sunCache = new Map<string, THREE.Vector3>();
  private cloudMaps: Record<string, THREE.Texture[]>;
  private clouds: THREE.Mesh[] = [];
  private sea: THREE.Mesh;
  private sets: Record<string, THREE.Group> = {};
  private galleon: ShipObj; private eng: ShipObj[] = [];
  private shafts: THREE.Mesh[] = []; private caustic: THREE.Mesh;
  private coins: THREE.Mesh[] = [];
  private sparkMat: THREE.MeshLambertMaterial;
  private debris: { o: THREE.Object3D; x: number; z: number; y: number; k: number }[] = [];
  private rov = new THREE.Group(); private rovBeams: THREE.Mesh[] = []; private rovHalos: THREE.Sprite[] = []; private tether: THREE.Mesh;
  private hookChest: ChestObj;
  private quay = new THREE.Group();
  private supFlag: Flag; private dockFlag: Flag | null = null;
  private dockChest: THREE.Group;
  private ropes: THREE.Mesh[] = [];
  private search: THREE.Group[] = [];
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4(); private v = new THREE.Vector3(); private sph = new THREE.Sphere();

  constructor(kit: Kit) {
    const R = this.root;
    // ---- sky (5 stops by elevation + a colour looking down, for underwater) + sun + clouds ----
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { c0: { value: new THREE.Color() }, c1: { value: new THREE.Color() }, c2: { value: new THREE.Color() },
        c3: { value: new THREE.Color() }, c4: { value: new THREE.Color() }, cb: { value: new THREE.Color() }, e: { value: new THREE.Vector4() } },
      vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform vec3 c0, c1, c2, c3, c4, cb; uniform vec4 e; varying vec3 vP;
        void main(){ float el = asin(clamp(normalize(vP).y, -1.0, 1.0));
          vec3 c = mix(cb, c0, smoothstep(-0.7, 0.0, el));
          c = mix(c, c1, smoothstep(0.0, e.x, el));
          c = mix(c, c2, smoothstep(e.x, e.y, el));
          c = mix(c, c3, smoothstep(e.y, e.z, el));
          c = mix(c, c4, smoothstep(e.z, e.w, el));
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1100, 48, 24), this.skyMat);
    this.sky.renderOrder = -1; this.sky.frustumCulled = false; this.sky.layers.set(NOINK);
    R.add(this.sky);
    this.sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTex(), color: new THREE.Color(6.0, 4.4, 2.4), fog: false, depthWrite: false }));
    this.sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color: new THREE.Color(1, 1, 1), fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.sunDisc.renderOrder = -0.5; this.sunHalo.renderOrder = 5;
    for (const m of [this.sunDisc, this.sunHalo]) { m.frustumCulled = false; m.layers.set(NOINK); R.add(m); }
    this.hemi = new THREE.HemisphereLight("#cfe6ff", "#6c5c8c", 1.1);
    this.sun = new THREE.DirectionalLight("#fff0d6", 2.6);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(4096, 4096);
    R.add(this.hemi, this.sun, this.sun.target);
    this.cloudMaps = {};
    for (const k of ["day", "golden", "dusk"] as const) this.cloudMaps[k] = [0, 1, 2, 3].map((i) => cloudHD(i, LOOK[k].cloud));
    for (let i = 0; i < 11; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.cloudMaps.day[i % 4], color: new THREE.Color(1.1, 1.1, 1.1), transparent: true, depthWrite: false, fog: false }));
      m.layers.set(NOINK); this.clouds.push(m); R.add(m);
    }

    // ---- sets ----
    const set = (name: string) => { const g = new THREE.Group(); g.name = name; this.sets[name] = g; R.add(g); return g; };
    const gSea = set("sea"), gBed = set("bed"), gWreck = set("wreck"), gChest = set("chest"), gCoast = set("coast"), gIsland = set("island"),
      gRow = set("row"), gSearch = set("search"), gSup = set("sup"), gDock = set("dock"), gShafts = set("shafts");

    // sea surface: turquoise gradient by depression angle + painted crest marks (bridge river shader)
    const wNear = waterNear(), wFar = waterFar();
    for (const t of [wNear, wFar]) { t.colorSpace = THREE.NoColorSpace; t.anisotropy = 16; t.needsUpdate = true; }
    this.WU = {
      wNearC: { value: new THREE.Color() }, wMidC: { value: new THREE.Color() }, wFarC: { value: new THREE.Color() },
      wCrest: { value: new THREE.Color() }, wTrough: { value: new THREE.Color() }, wGlint: { value: new THREE.Color() },
      wShade: { value: new THREE.Vector3(0.5, 0.56, 0.72) }, wNearTex: { value: wNear }, wFarTex: { value: wFar }, wTime: { value: 0 },
    };
    const waterM = new THREE.MeshLambertMaterial({ color: 0xffffff });
    waterM.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.WU);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWP;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", WATER_DECL)
        .replace("#include <map_fragment>", WATER_COL)
        .replace("#include <lights_fragment_begin>", "float sunVis = 1.0;\n" + LFB)
        .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n  reflectedLight.directDiffuse = diffuseColor.rgb * mix(wShade, vec3(1.0), sunVis);\n  reflectedLight.indirectDiffuse = vec3(0.0);");
    };
    waterM.customProgramCacheKey = () => "sea1";
    const seaG = new THREE.PlaneGeometry(5000, 5000).rotateX(-Math.PI / 2);
    this.sea = new THREE.Mesh(seaG, waterM); this.sea.receiveShadow = true; gSea.add(this.sea);

    // seabed: soft dunes of rippled sand, rocks, weed; caustics; light shafts
    const bedG = new THREE.PlaneGeometry(900, 900, 180, 180).rotateX(-Math.PI / 2);
    const bp = bedG.attributes.position as THREE.BufferAttribute, buv = bedG.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), z = bp.getZ(i);
      bp.setY(i, bedY(x, z));
      buv.setXY(i, x / 9, z / 9);
    }
    bedG.computeVertexNormals();
    const sandM = lam("seabed", () => ({ map: rep(sandTex(), 1, 1) }));
    const bed = new THREE.Mesh(bedG, sandM); bed.receiveShadow = true; gBed.add(bed);
    const cm = new THREE.MeshBasicMaterial({ map: rep(causticTex(), 1, 1), color: new THREE.Color(0.17, 0.26, 0.28), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true });
    const cg = bedG.clone(); const cuv = cg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < cuv.count; i++) cuv.setXY(i, bp.getX(i) / 7, bp.getZ(i) / 7);
    this.caustic = new THREE.Mesh(cg, cm); this.caustic.layers.set(NOINK); this.caustic.renderOrder = 0.4; gBed.add(this.caustic);
    const bb = new Batch();
    // keep rocks and weed away from every underwater lens position of the film (no camera inside a plant)
    const lens: THREE.Vector3[] = [];
    for (const sh of SHOTS) for (let f = sh.a; f < sh.b; f += 3) { const c = camAt(sh.id, f), { l, n } = loc(sh.id, f); if (isUnder(lightOf(sh.id, l, n, c.pos[1]))) lens.push(V(...c.pos)); }
    const clear = (x: number, z: number, r: number) => lens.every((p) => Math.hypot(p.x - x, p.z - z) > r + 2.5);
    const rocks = ["rocks-a", "rocks-b", "rocks-c", "rocks-sand-a", "rocks-sand-b", "rocks-sand-c"];
    const rr = mulberry(5);
    for (let i = 0; i < 70; i++) {
      const a = rr() * Math.PI * 2, d = 10 + rr() * 90, cx = i % 3 === 0 ? DIVER : WRECK;
      const x = cx[0] + Math.cos(a) * d, z = cx[2] + Math.sin(a) * d;
      const sc = 0.8 + rr() * 1.4;
      if (Math.hypot(x - CHEST[0], z - CHEST[2]) < 5 || Math.hypot(x - WRECK[0], z - WRECK[2]) < 14 || !clear(x, z, 2.7 * sc)) continue;
      kbatch(bb, kit, rocks[i % 6], x, bedY(x, z) - 0.3, z, sc, rr() * 6, "#d6e0dc");
    }
    for (let i = 0; i < 90; i++) {
      const a = rr() * Math.PI * 2, d = 6 + rr() * 60, cx = i % 3 === 0 ? DIVER : WRECK;
      const x = cx[0] + Math.cos(a) * d, z = cx[2] + Math.sin(a) * d;
      const sc = 1.6 + rr() * 2.2;
      if (Math.hypot(x - CHEST[0], z - CHEST[2]) < 3.5 || Math.hypot(x - DIVER[0], z - DIVER[2]) < 2.5 || !clear(x, z, 1.5)) continue;
      kelp(bb, x, bedY(x, z) - 0.05, z, 1.2 + sc * 0.9, Math.floor(rr() * 1000));
    }
    // a few rocks + weed right around the diver and the chest (framing, kept out of the faces)
    for (const [x, z, s, n] of [[DIVER[0] - 4.5, DIVER[2] - 4, 0.9, "rocks-sand-a"], [DIVER[0] + 4, DIVER[2] - 5, 0.8, "rocks-b"], [CHEST[0] - 3.6, CHEST[2] - 3.2, 0.8, "rocks-sand-b"],
      [CHEST[0] + 3.0, CHEST[2] - 4.0, 0.7, "rocks-c"]] as const) kbatch(bb, kit, n, x, bedY(x, z) - 0.25, z, s, x * 0.3, "#d6e0dc");
    bb.build(gBed);
    // light shafts from the surface (additive, camera-facing around their own axis)
    const sm = glowMat(shaftTex(), new THREE.Color(0.07, 0.16, 0.2), 1, false);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0), sm);
      m.userData = { x: WRECK[0] - 30 + (i % 5) * 15 + 6 * Math.sin(i * 2.3), z: WRECK[2] - 10 + Math.floor(i / 5) * 26 + 8 * Math.cos(i * 1.7), w: 3 + (i % 3) * 2 };
      m.layers.set(NOINK); m.renderOrder = 3; m.frustumCulled = false;
      this.shafts.push(m); gShafts.add(m);
    }

    // the wreck: listing, half buried, timbers around
    const wreck = buildShip(WRECK_STYLE).g; // the galleon itself, broken and algae-covered
    wreck.position.set(WRECK[0], BED - 1.4, WRECK[2]); wreck.rotation.set(0.05, 0.55, 0.2, "YXZ");
    gWreck.add(wreck);
    const woodM = lam("woodBeam", () => ({ map: beam() })), tb = new Batch();
    const timber = (b: Batch, x: number, y: number, z: number, len: number, yaw: number, tilt: number, w = 0.24) =>
      b.add(new THREE.BoxGeometry(w, w * 0.8, len), woodM, new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0.1, "YXZ")), V(1, 1, 1)));
    for (let i = 0; i < 9; i++) timber(tb, WRECK[0] + 9 * Math.cos(i * 2.1) + 3, BED + 0.1, WRECK[2] + 13 * Math.sin(i * 2.1) + 4, 2.5 + (i % 3) * 1.5, i * 0.9, 0.08 * (i % 3), 0.35);
    tb.build(gWreck);

    // the hook's open chest: gold pile, spilled coins and emeralds, broken timbers
    this.hookChest = buildChest(1.95, true);
    { // a god ray that lands on the chest (shot 1): the gold reads at a glance against the blue
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, -0.5, 0), glowMat(shaftTex(), new THREE.Color(0.55, 0.62, 0.55), 1, false));
      ray.position.set(CHEST[0] + 1.6, -1, CHEST[2] - 1.0); ray.scale.set(2.6, Math.abs(-1 - (BED + 0.6)), 1); ray.rotation.set(0, 0.35, 0.065);
      ray.layers.set(NOINK); ray.renderOrder = 3; ray.frustumCulled = false; gChest.add(ray);
    }
    const chest = this.hookChest.g;
    chest.position.set(CHEST[0], bedY(CHEST[0], CHEST[2]) - 0.1, CHEST[2]); chest.rotation.set(0.05, -0.35, 0.06, "YXZ");
    gChest.add(chest);
    const goldM = lam("gold", () => ({ color: "#f6c445", emissive: new THREE.Color("#8a5a00") }));
    this.sparkMat = twoToneEmissive("#ffd34d", "#ffcc33");
    const emeraldM = lam("emerald", () => ({ color: "#22d873", emissive: new THREE.Color("#0b7a3c") }));
    const coinG = new THREE.CylinderGeometry(0.055, 0.055, 0.014, 14), gemG = new THREE.OctahedronGeometry(0.042).scale(1, 1.4, 1);
    const cr = mulberry(9), cN = 190, gN = 16;
    const coinsI = new THREE.InstancedMesh(coinG, goldM, cN), sparkI = new THREE.InstancedMesh(coinG, this.sparkMat, 14), gemsI = new THREE.InstancedMesh(gemG, emeraldM, gN);
    const place = (im: THREE.InstancedMesh, i: number, kind: number) => {
      // spill: a fan of coins down the chest front onto the sand (chest front faces +z rotated by its yaw)
      const u = cr(), fan = (cr() - 0.5) * 1.6 * (0.4 + u), dist = 0.25 + u * 1.5, yaw = -0.35;
      const fx = Math.sin(yaw) * dist + Math.cos(yaw) * fan, fz = Math.cos(yaw) * dist - Math.sin(yaw) * fan;
      const y = bedY(CHEST[0] + fx, CHEST[2] + fz + 0.35) + 0.02 + (u < 0.15 ? 0.35 * (1 - u / 0.15) : 0) + 0.04 * cr() + (kind === 1 ? 0.05 : 0);
      const e = new THREE.Euler((cr() - 0.5) * 1.2, cr() * 6, (cr() - 0.5) * 1.2);
      im.setMatrixAt(i, this.m4.compose(V(CHEST[0] + fx, y, CHEST[2] + fz + 0.35), new THREE.Quaternion().setFromEuler(e), V(1, 1, 1)));
    };
    for (let i = 0; i < cN; i++) place(coinsI, i, 0);
    for (let i = 0; i < 14; i++) place(sparkI, i, 0);
    for (let i = 0; i < gN; i++) place(gemsI, i, 1);
    for (const im of [coinsI, sparkI, gemsI]) { im.castShadow = true; im.receiveShadow = true; gChest.add(im); this.coins.push(im); }
    const cb2 = new Batch();
    for (const [x, z, len, yaw, tilt] of [[-1.6, -0.6, 3.2, 0.9, 0.12], [1.9, -1.2, 2.6, -0.5, -0.1], [-0.6, -2.4, 3.8, 1.6, 0.06], [2.6, 1.0, 1.8, 0.2, 0.18]] as const)
      timber(cb2, CHEST[0] + x, bedY(CHEST[0] + x, CHEST[2] + z) + 0.08, CHEST[2] + z, len, yaw, tilt, 0.26);
    kbatch(cb2, kit, "barrel", CHEST[0] - 2.2, bedY(CHEST[0] - 2.2, CHEST[2] - 1.2) - 0.25, CHEST[2] - 1.2, 0.8, 0.3, "#d8ccb8");
    kbatch(cb2, kit, "bottle-large", CHEST[0] + 1.3, bedY(CHEST[0] + 1.3, CHEST[2] + 0.9) - 0.02, CHEST[2] + 0.9, 0.42, 0.8);
    cb2.build(gChest);

    // the San José and the English warships (our flags; Kenney's own flag meshes are hidden)
    this.galleon = buildShip(SPAIN);
    R.add(this.galleon.g);
    for (let k = 0; k < 3; k++) { const s = buildShip(ENGLAND); this.eng.push(s); R.add(s.g); }

    // island (shot 4-5): green hill on a sand ring, palms
    const ib = new Batch();
    const hill = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    ib.add(new THREE.CylinderGeometry(78, 84, 3, 40), lam("sandIsland", () => ({ color: "#ecd6a0" })), new THREE.Matrix4().makeTranslation(ISLAND[0], -0.6, ISLAND[2]));
    ib.add(hill, lam("hillGreen", () => ({ color: "#5fae4a" })), new THREE.Matrix4().compose(V(ISLAND[0] - 8, 0, ISLAND[2]), new THREE.Quaternion(), V(62, 26, 52)));
    ib.add(hill, lam("hillGreen2", () => ({ color: "#6fbd55" })), new THREE.Matrix4().compose(V(ISLAND[0] + 28, 0, ISLAND[2] + 18), new THREE.Quaternion(), V(34, 15, 30)));
    const pr = mulberry(21), palms = ["palm-straight", "palm-bend", "palm-detailed-straight", "palm-detailed-bend"];
    for (let i = 0; i < 26; i++) {
      const a = pr() * Math.PI * 2, d = 62 + pr() * 14;
      kbatch(ib, kit, palms[i % 4], ISLAND[0] + Math.cos(a) * d, 0.8, ISLAND[2] + Math.sin(a) * d * 0.9, 2.6 + pr() * 1.2, pr() * 6);
    }
    ib.build(gIsland);
    // far palm coast (south + west horizon)
    const coast = new Batch();
    const strip = (x0: number, x1: number, z0: number, z1: number) => {
      coast.add(boxGeo(V(x0, -1, z0), V(x1, 2.5, z1)), lam("coastSand", () => ({ color: "#efd9a4" })));
      const cr3 = mulberry(Math.abs(x0 + z0));
      const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      for (let k = 0; k < 18; k++) {
        const u = cr3(), x = along ? x0 + (x1 - x0) * u : (x0 + x1) / 2, z = along ? (z0 + z1) / 2 : z0 + (z1 - z0) * u;
        coast.add(hill, lam(k % 2 ? "hillGreen" : "hillGreen2", () => ({ color: "#5fae4a" })), new THREE.Matrix4().compose(V(x, 1.5, z), new THREE.Quaternion(), V(30 + cr3() * 40, 10 + cr3() * 16, 24)));
      }
      for (let k = 0; k < 60; k++) {
        const u = cr3(), x = along ? x0 + (x1 - x0) * u : (x0 + x1) / 2 + (cr3() - 0.5) * 20, z = along ? (z0 + z1) / 2 + (cr3() - 0.5) * 20 : z0 + (z1 - z0) * u;
        kbatch(coast, kit, palms[k % 4], x, 2.4, z, 3 + cr3() * 1.5, cr3() * 6);
      }
    };
    strip(-1000, 1000, -600, -560); strip(-700, -660, -800, 500);
    coast.build(gCoast);

    // survivors' rowboat + floating debris (shot 7)
    const boat = buildRowboat();
    boat.position.set(ROWB[0], 0.05, ROWB[2]); boat.rotation.y = Math.PI / 2 + 0.25; // side-on to the lens
    gRow.add(boat); this.debris.push({ o: boat, x: ROWB[0], z: ROWB[2], y: 0.05, k: 0 });
    const dr = mulberry(31);
    for (let i = 0; i < 12; i++) {
      const a = dr() * Math.PI * 2, d = 4 + dr() * 26, x = ROWB[0] + Math.cos(a) * d - 6, z = ROWB[2] + Math.sin(a) * d - 8;
      if (Math.hypot(x - ROWB[0] - 3.2, z - ROWB[2] - 8.5) < 5) continue;
      const kind = i % 4, o = kind === 0 ? kclone(kit, "barrel", 0.72) : kind === 1 ? kclone(kit, "crate", 0.7) : new THREE.Group();
      if (kind >= 2) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 2.6 + dr() * 2), woodM); m.castShadow = true; o.add(m); }
      const y = kind === 0 ? -0.55 : kind === 1 ? -0.35 : 0.0;
      o.position.set(x, y, z); o.rotation.set(kind === 0 ? 1.4 : 0.1, dr() * 6, 0.1);
      gRow.add(o); this.debris.push({ o, x, z, y, k: i + 1 });
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 9, 10).rotateZ(Math.PI / 2), woodM);
    mast.position.set(ROWB[0] - 9, 0.05, ROWB[2] - 12); mast.rotation.y = 0.5; mast.castShadow = true; gRow.add(mast);

    // search boats (shot 8): plain, no flags
    for (const [n, x, z, s, yaw] of [["boat-row-large", -6, 124, 2.2, 0.4], ["ship-small", 9, 96, 1.6, 1.4], ["boat-row-large", 3, 146, 2.2, 2.4]] as const) {
      const o = kclone(kit, n, s); o.position.set(x, n === "ship-small" ? -1.0 * s : -0.5, z); o.rotation.y = yaw; gSearch.add(o); this.search.push(o);
    }

    // 2015 support ship: simple modern research vessel (white superstructure, blue hull, orange A-frame) + Colombian flag
    {
      const sb = new Batch(), L = 30, B = 8;
      const sh = new THREE.Shape();
      sh.moveTo(-L / 2, -B / 2); sh.lineTo(L / 2 - 8, -B / 2); sh.quadraticCurveTo(L / 2 - 1, -B / 2 + 0.5, L / 2, 0); sh.quadraticCurveTo(L / 2 - 1, B / 2 - 0.5, L / 2 - 8, B / 2); sh.lineTo(-L / 2, B / 2); sh.closePath();
      const hull = (y0: number, h: number, inset: number) => { const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.scale(1 - inset, 1, 1 - inset); g.translate(0, y0, 0); return g; };
      sb.add(hull(-2.2, 3.4, 0), lam("supHull", () => ({ color: "#1f4f9a" })));
      sb.add(hull(1.2, 1.3, 0), lam("supWhite", () => ({ color: "#f2f2ee" })));
      sb.add(boxGeo(V(-3, 2.5, -3.2), V(8, 6.5, 3.2)), lam("supWhite", () => ({ color: "#f2f2ee" })));
      sb.add(boxGeo(V(-2.9, 4.6, -3.25), V(7.9, 5.4, 3.25)), lam("supGlass", () => ({ color: "#26344a" })));
      sb.add(boxGeo(V(0, 6.5, -2.4), V(6.5, 9, 2.4)), lam("supWhite", () => ({ color: "#f2f2ee" })));
      sb.add(boxGeo(V(-0.1, 7.6, -2.45), V(6.6, 8.3, 2.45)), lam("supGlass", () => ({ color: "#26344a" })));
      sb.add(new THREE.CylinderGeometry(0.12, 0.15, 6, 8).translate(3, 12, 0), lam("supGrey", () => ({ color: "#9aa0a8" })));
      sb.add(boxGeo(V(-12.5, 1.5, -3.8), V(-4, 2.6, 3.8)), lam("supDeck", () => ({ color: "#c9ccd2" })));
      sb.add(boxGeo(V(2.2, 14.6, -1.3), V(3.8, 15.0, 1.3)), lam("supGrey", () => ({ color: "#9aa0a8" }))); // radar bar (along the beam: no cross from the side)
      sb.add(new THREE.SphereGeometry(0.6, 14, 10).translate(3, 15.4, 0), lam("supWhite", () => ({ color: "#f2f2ee" })));
      const orange = lam("supOrange", () => ({ color: "#f07a1e" }));
      for (const s of [-1, 1]) sb.add(new THREE.BoxGeometry(0.45, 7.5, 0.45).rotateZ(-0.35).translate(-L / 2 + 1.2, 4.6, s * 2.6), orange);
      sb.add(new THREE.BoxGeometry(0.5, 0.5, 5.8).translate(-L / 2 - 0.1, 8.1, 0), orange);
      sb.build(gSup);
      const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.5, 8).translate(0, 2.25, 0), lam("poleGrey", () => ({ color: "#c9ccd2" })));
      fp.position.set(-L / 2 + 4.5, 1.8, 0); gSup.add(fp);
      this.supFlag = new Flag(gSup, colombiaTex, "colombia", 2.6, 1.7, [-L / 2 + 4.5, 6.3, 0], 0.7);
      this.supFlag.mesh.rotation.y = Math.PI / 2; // streams toward the stern (-x)
      gSup.position.set(...SUP); gSup.rotation.y = 0;
    }
    // the ROV (hero.ts): open frame, rounded float, ducted thrusters, two lamps with light cones; orange tether
    {
      const rv = buildROV();
      this.rov = rv.g; this.rovBeams = rv.beams; this.rovHalos = rv.halos;
      this.tether = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 6).translate(0, 0.5, 0), lam("tether", () => ({ color: "#f07a1e" })));
      R.add(this.rov, this.tether);
    }

    // Cartagena dock: pier on pilings, land, colonial fortress walls and towers (warm stone), palms, cargo
    {
      const db = new Batch();
      // plank deck + edge beams (the Kenney dock tiles read as a forest of posts)
      db.add(boxGeo(V(-2.6, DOCK_Y - 0.3, -62), V(2.6, DOCK_Y, -8), 2.6), lam("pierPlanks", () => ({ map: rep(planksHD(), 1, 1) })));
      for (const x of [-2.6, 2.6]) db.add(boxGeo(V(x - 0.14, DOCK_Y - 0.55, -62), V(x + 0.14, DOCK_Y + 0.08, -8)), lam("woodBeam", () => ({ map: beam() })));
      const pile = lam("pile", () => ({ map: beam(), color: "#8a6a4a" }));
      for (let z = -61; z <= -8.5; z += 5) for (const x of [-2.45, 2.45]) db.add(new THREE.CylinderGeometry(0.17, 0.2, DOCK_Y - BED, 8).translate(0, (DOCK_Y + BED) / 2, 0), pile, new THREE.Matrix4().makeTranslation(x, 0, z));
      for (const x of [-2.2, 2.2]) db.add(new THREE.CylinderGeometry(0.14, 0.16, 0.5, 10).translate(x, DOCK_Y + 0.25, -8.2), lam("bollard", () => ({ color: "#3a3f48" })));
      const quay = lam("quayStone", () => ({ map: stoneHD("quayHD", ["#e6cf9e", "#dcc38f", "#ecd8ab", "#d4b985"], "#a88e64") }));
      const qb = new Batch(); qb.add(boxGeo(V(-160, BED - 2, -200), V(160, 1.8, -62), 3), quay); qb.build(this.quay); gDock.add(this.quay); // hidden under water
      const fort = "#f2d6a0";
      for (let x = -66; x <= 66; x += 4) if (Math.abs(x) > 5) kbatch(db, kit, "castle-wall", x, 1.8, -80, 2.0, 0, fort);
      kbatch(db, kit, "castle-gate", 0, 1.8, -80, 2.0, 0, fort);
      for (const x of [-38, 38, -70, 70]) kbatch(db, kit, "tower-complete-large", x, 1.8, -79, 1.45, 0, fort);
      for (const [x, z, n, s] of [[-9, -66, 0, 3.2], [9.5, -67, 1, 3.4], [-17, -70, 2, 2.9], [18, -69.5, 3, 3.1], [-30, -66, 1, 3.3], [28, -66.5, 0, 3.0], [-45, -68, 2, 3.4], [44, -70, 3, 3.2]] as const)
        kbatch(db, kit, palms[n], x, 1.8, z, s, x * 0.37);
      for (const [x, z, n, s, yaw] of [[-1.6, -40, "barrel", 0.7, 0], [-1.3, -38.6, "barrel", 0.7, 1], [1.5, -44, "crate", 0.75, 0.3], [1.6, -42.8, "crate-bottles", 0.7, 0.1], [-6, -64, "cannon", 0.9, 0.4], [7, -64, "cannon", 0.9, -0.4]] as const)
        kbatch(db, kit, n, x, n === "cannon" ? 1.8 : DOCK_Y, z, s, yaw);
      db.build(gDock);
      this.dockFlag = new Flag(gDock, colombiaTex, "colombia", 3.2, 2.1, [0, 19.5, -80], 0.3);
      this.dockFlag.mesh.rotation.y = Math.PI / 2;
      const fpole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 8).translate(0, 4.5, 0), lam("poleGrey", () => ({ color: "#c9ccd2" })));
      fpole.position.set(0, 10.5, -80); gDock.add(fpole);
      this.dockChest = buildChest(0, false).g;
      gDock.add(this.dockChest);
      const ropeM = lam("rope", () => ({ color: "#c9a46a" }));
      for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6).translate(0, 0.5, 0), ropeM); r.castShadow = true; r.visible = false; this.ropes.push(r); gDock.add(r); }
    }
  }

  /** camera-relative sun, frozen per shot part: mean view direction of the frames sharing this light, turned by az, lifted by el */
  private shotSun(id: number, light: LightName, L: LightPreset) {
    const key = id + "|" + light;
    let v = this.sunCache.get(key);
    if (v) return v;
    const s = SHOTS[id - 1];
    let fx = 0, fz = 0;
    for (let f = s.a; f < s.b; f += 2) {
      const c = camAt(id, f), { l, n } = loc(id, f);
      if (lightOf(id, l, n, c.pos[1]) !== light) continue;
      const x = c.look[0] - c.pos[0], z = c.look[2] - c.pos[2], h = Math.hypot(x, z) || 1;
      fx += x / h; fz += z / h;
    }
    const n = Math.hypot(fx, fz) || 1; fx /= n; fz /= n;
    const az = THREE.MathUtils.degToRad(SUN_SHOT[key]?.az ?? L.az), el = THREE.MathUtils.degToRad(SUN_SHOT[key]?.el ?? L.el);
    const hx = fx * Math.cos(az) - fz * Math.sin(az), hz = fz * Math.cos(az) + fx * Math.sin(az);
    v = new THREE.Vector3(hx * Math.cos(el), Math.sin(el), hz * Math.cos(el)).normalize();
    this.sunCache.set(key, v);
    return v;
  }

  private actor(i: number) { while (this.actors.length <= i) this.actors.push(new Actor(this.root)); return this.actors[i]; }
  private fx(i: number) { while (this.fxs.length <= i) this.fxs.push(new Fx(this.root)); return this.fxs[i]; }

  update(id: number, f: number, cam: THREE.PerspectiveCamera, scene: THREE.Scene) {
    const { l, n, t } = loc(id, f);
    // ---- camera ----
    type DCam = { pos: V3; look: V3; fov?: number };
    const ip = getInputProps() as { cam?: DCam; cams?: Record<string, DCam> };
    const dbg = ip.cam ?? ip.cams?.[String(f)];
    const c = dbg ? { pos: dbg.pos, look: dbg.look, fov: dbg.fov ?? 50, roll: 0 } : camAt(id, f);
    cam.position.set(...c.pos); cam.up.set(0, 1, 0); cam.lookAt(...c.look); cam.rotateZ(c.roll);
    cam.fov = c.fov; cam.near = 0.2; cam.far = 1500; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    cam.layers.enable(NOINK);
    const focus = V(...c.look), dist = cam.position.distanceTo(focus);
    const light = lightOf(id, l, n, c.pos[1]), L = LIGHTS[light], K = LOOK[light], under = isUnder(light);
    this.light = light;
    // ---- light rig ----
    const sunDir = this.shotSun(id, light, L);
    this.hemi.color.set(L.sky); this.hemi.groundColor.set(L.ground); this.hemi.intensity = L.hemiI;
    this.sun.color.set(L.sunCol); this.sun.intensity = L.sunI;
    const Rr = THREE.MathUtils.clamp(dist * 1.15 + 7, 12, 95);
    this.sun.position.copy(focus).addScaledVector(sunDir, 220); this.sun.target.position.copy(focus);
    const sc = this.sun.shadow.camera;
    sc.left = -Rr; sc.right = Rr; sc.top = Rr; sc.bottom = -Rr; sc.near = 20; sc.far = 480; sc.updateProjectionMatrix();
    this.sun.shadow.bias = L.bias; this.sun.shadow.normalBias = L.normalBias * (Rr / 12);
    TONE.uLitCol.value.set(...L.lit); TONE.uShadeCol.value.set(...L.shade); TONE.uShadeLift.value.set(...L.lift);
    TONE.uLambert.value = L.lambert; TONE.uSideK.value = L.sideK; TONE.uTerm.value = L.term; TONE.uBounce.value.set(...K.bounce); TONE.uSat.value = K.sat;
    CHAR.uCharTint.value.set(...L.charTint); CHAR.uCharShade.value = L.charShade; CHAR.uGrad.value = L.charGrad;
    CHAR.uBodyGrad.value = L.bodyGrad; CHAR.uSideTint.value.set(...L.sideTint);
    // ---- sky, fog, sun disc, clouds ----
    const su = this.skyMat.uniforms;
    K.sky.c.forEach((h, i) => untone(h, su["c" + i].value));
    untone(K.sky.below ?? K.sky.c[0], su.cb.value);
    const e = K.sky.e.map((deg) => THREE.MathUtils.degToRad(deg));
    su.e.value.set(e[1], e[2], e[3], e[4]);
    this.sky.position.copy(cam.position);
    untone(L.fog, this.fog.color); this.fog.near = L.fogNear; this.fog.far = L.fogFar;
    const fo = FOG_SHOT[id]; if (fo && light === "under") { this.fog.near = fo[0]; this.fog.far = fo[1]; } // s01: deep teal behind the gold
    scene.fog = this.fog; scene.background = null;
    const showSun = light === "golden" || light === "dusk";
    this.sunDisc.visible = this.sunHalo.visible = showSun;
    if (showSun) {
      this.sunDisc.position.copy(cam.position).addScaledVector(sunDir, 900);
      this.sunDisc.scale.setScalar(2 * 900 * Math.tan(THREE.MathUtils.degToRad(light === "dusk" ? 2.2 : 1.7)));
      this.sunHalo.position.copy(this.sunDisc.position); this.sunHalo.scale.setScalar(2 * 900 * Math.tan(THREE.MathUtils.degToRad(24)));
      (this.sunHalo.material as THREE.SpriteMaterial).color.set(L.sunDisc).multiplyScalar(1.3);
    }
    const race = id === 8 ? t * 0.22 : 0; // shot 8: clouds race across the sky (years go by)
    for (let i = 0; i < this.clouds.length; i++) {
      const m = this.clouds[i], mat = m.material as THREE.MeshBasicMaterial;
      m.visible = !under;
      if (under) continue;
      const a = (i / this.clouds.length) * Math.PI * 2 + 0.3 + race, d = 640 + (i % 3) * 70, w = 140 + (i % 4) * 34;
      m.position.set(Math.cos(a) * d + cam.position.x, 70 + (i % 4) * 34, Math.sin(a) * d + cam.position.z); m.scale.set(w, w / 2, 1);
      m.lookAt(cam.position.x, m.position.y, cam.position.z);
      mat.map = this.cloudMaps[light === "dusk" ? "dusk" : light === "golden" ? "golden" : "day"][i % 4];
    }
    // ---- sea colours ----
    const W = this.WU, wc = K.water;
    untone(wc.near, W.wNearC.value); untone(wc.mid, W.wMidC.value); untone(wc.far, W.wFarC.value);
    untone(wc.crest, W.wCrest.value); untone(wc.trough, W.wTrough.value); untone(wc.glint, W.wGlint.value);
    W.wShade.value.set(...wc.shade); W.wTime.value = t + id * 7;
    // ---- which sets are in this shot part ----
    const S = this.sets, surface = !under;
    S.sea.visible = surface;
    S.bed.visible = under; S.shafts.visible = light === "under";
    this.caustic.visible = light === "under";
    S.wreck.visible = under && id !== 8;
    S.chest.visible = id === 1;
    S.coast.visible = surface && id >= 3 && id <= 8;
    S.island.visible = surface && (id === 4 || id === 5);
    S.row.visible = id === 7;
    S.search.visible = id === 8 && surface;
    S.sup.visible = id === 9 && surface;
    S.dock.visible = id === 10 || id === 11;
    this.quay.visible = !under; // its underwater face read as a brick wall in s11
    // ---- ships ----
    this.galleon.g.visible = surface && id >= 3 && id <= 6;
    if (this.galleon.g.visible) this.poseShip(this.galleon, galleonPose(id, t), t);
    this.eng.forEach((s, k) => {
      s.g.visible = surface && (id === 4 || (id === 5 && k < 2));
      if (s.g.visible) this.poseShip(s, engPose(k, id, t), t + k);
    });
    // ---- underwater bits: shafts face the lens, caustics drift, sparkle on the gold ----
    if (S.shafts.visible) this.shafts.forEach((m, i) => {
      const u = m.userData as { x: number; z: number; w: number };
      m.position.set(u.x + 2 * Math.sin(t * 0.3 + i), -0.5, u.z);
      m.rotation.set(0, Math.atan2(cam.position.x - m.position.x, cam.position.z - m.position.z), 0.18 + 0.03 * Math.sin(t * 0.4 + i));
      m.scale.set(u.w * 0.6 * (1 + 0.15 * Math.sin(t * 0.7 + i * 2)), 34, 1);
      (m.material as THREE.MeshBasicMaterial).opacity = 1;
    });
    if (this.caustic.visible) { const mp = (this.caustic.material as THREE.MeshBasicMaterial).map!; mp.offset.set(t * 0.03, t * 0.02); }
    this.sparkMat.emissiveIntensity = 1.6 + 1.2 * Math.sin(t * 5.3);
    // ---- debris bobbing (shot 7) ----
    if (S.row.visible) for (const d of this.debris) d.o.position.y = d.y + 0.06 * Math.sin(t * 1.4 + d.k * 1.7);
    // ---- support ship + ROV (shot 9) ----
    this.rov.visible = id === 9; this.tether.visible = id === 9;
    if (id === 9) {
      this.supFlag.pose(t, 1.2);
      if (surface) { // hanging from the A-frame, about to go in
        this.rov.position.set(SUP[0] - 15.6, 3.2 + 0.1 * Math.sin(t * 2), SUP[2]); this.rov.rotation.set(0, -Math.PI / 2, 0.06 * Math.sin(t * 1.4));
        this.tether.position.set(SUP[0] - 15.6, 4.0, SUP[2]); this.tether.scale.set(1, 4.1, 1);
        this.rovBeams.forEach((b) => (b.visible = false)); this.rovHalos.forEach((b) => (b.visible = false));
      } else {
        const r = rovPos(t);
        this.rov.position.set(...r);
        const dx = WRECK[0] - r[0], dz = WRECK[2] - r[2];
        this.rov.rotation.set(0.28, Math.atan2(dx, dz), 0.03 * Math.sin(t * 1.3), "YXZ");
        this.tether.position.set(r[0], r[1] + 0.95, r[2] - 0.3); this.tether.scale.set(1, 60, 1);
        this.rovBeams.forEach((b) => (b.visible = true)); this.rovHalos.forEach((b) => (b.visible = true));
      }
    }
    // ---- dock (shots 10-11): the chest jerks with the tug ----
    if (S.dock.visible) {
      const tt = id === 11 ? t + 111 / FPS : t, cp = tugChest(tt);
      this.dockChest.position.set(...cp); this.dockChest.rotation.y = 0.05 * Math.sin(tt * 2.3);
      this.dockFlag?.pose(t, 1);
    }
    for (const r of this.ropes) r.visible = false;
    // ---- search boats rock ----
    if (S.search.visible) this.search.forEach((o, i) => { o.rotation.z = 0.04 * Math.sin(t * 1.3 + i); });
    // ---- cast + effects ----
    const right = V(0, 0, 0).setFromMatrixColumn(cam.matrixWorld, 0);
    const st = stage(id, l, n, light, { pos: cam.position, right, sun: sunDir });
    st.ropes.forEach(([a, b], i) => {
      const r = this.ropes[i]; if (!r) return;
      const A = V(...a), B = V(...b), d = B.clone().sub(A);
      r.visible = true; r.position.copy(A); r.quaternion.setFromUnitVectors(V(0, 1, 0), d.clone().normalize()); r.scale.set(1, d.length(), 1);
    });
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let ai = 0;
    const used: Actor[] = [];
    for (const p of st.places) {
      const sc2 = p.scale ?? 1;
      if (!this.frustum.intersectsSphere(this.sph.set(this.v.set(p.x, p.y + 1.1 * sc2, p.z), 3.5))) continue;
      const a = this.actor(ai++);
      const [w, h, k] = p.size ?? [300, 500, 0.5];
      a.r = this.pool.req(p.key, w, h, k, p.draw);
      a.mesh.visible = true;
      a.mesh.position.set(p.x, p.y, p.z);
      a.mesh.rotation.set(0, p.yaw ?? Math.atan2(cam.position.x - p.x, cam.position.z - p.z), p.roll ?? 0);
      a.mesh.scale.set(p.mirror ? -sc2 : sc2, sc2, sc2);
      a.mesh.castShadow = L.actorShadow;
      used.push(a);
    }
    for (let i = ai; i < this.actors.length; i++) this.actors[i].mesh.visible = false;
    let fi = 0;
    const fused: Fx[] = [];
    for (const p of st.fx) {
      if (!this.frustum.intersectsSphere(this.sph.set(this.v.set(p.x, p.y, p.z), Math.max(Math.abs(p.w), p.h)))) continue;
      const ef = this.fx(fi++);
      ef.r = this.pool.req(p.key, p.cw, p.ch, 1, p.draw);
      ef.use(!!p.soft);
      ef.mesh.visible = true;
      ef.mesh.position.set(p.x, p.y, p.z);
      if (p.flat) ef.mesh.rotation.set(-Math.PI / 2, 0, p.rot ?? 0);
      else { ef.mesh.quaternion.copy(cam.quaternion); ef.mesh.rotateZ(p.rot ?? 0); }
      ef.mesh.scale.set(p.w, p.h, 1);
      fused.push(ef);
    }
    for (let i = fi; i < this.fxs.length; i++) this.fxs[i].mesh.visible = false;
    this.pool.flush();
    for (const a of used) a.bind();
    for (const e2 of fused) e2.bind();
    return focus;
  }

  private poseShip(s: ShipObj, p: Pose, t: number) {
    poseMatrix(p, this.m4);
    this.m4.decompose(s.g.position, s.g.quaternion, s.g.scale);
    poseShip(s, t);
  }
}

/** per-shot underwater fog [near, far] */
const FOG_SHOT: Record<number, [number, number]> = { 1: [5, 40] };
/** ribbon kelp: 3-5 tall bent ribbons with a light vein, two-tone green */
const kelpTex = () => ctex("kelp", 64, 256, (g) => {
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, "#7fd06a"); gr.addColorStop(1, "#2f8a4a");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 256); g.fillStyle = "rgba(220,255,190,0.45)"; g.fillRect(29, 0, 6, 256);
});
const kelp = (b: Batch, x: number, y: number, z: number, h: number, seed: number) => {
  const r = mulberry(seed + 3), n = 3 + Math.floor(r() * 3), m = lam("kelpM", () => ({ map: kelpTex(), side: THREE.DoubleSide }));
  for (let k = 0; k < n; k++) {
    const g = new THREE.PlaneGeometry(0.22 + r() * 0.12, h * (0.6 + 0.5 * r()), 1, 10).translate(0, 0, 0);
    const p = g.attributes.position as THREE.BufferAttribute, hh = h * 0.5, bend = (r() - 0.5) * 1.2, ph = r() * 6;
    for (let i = 0; i < p.count; i++) { const yy = p.getY(i) + hh, u = yy / (2 * hh); p.setXYZ(i, p.getX(i) * (1 - 0.5 * u) + bend * u * u + 0.15 * Math.sin(u * 5 + ph), yy, 0.2 * Math.sin(u * 4 + ph)); }
    g.computeVertexNormals();
    b.add(g, m, new THREE.Matrix4().compose(V(x + (r() - 0.5) * 0.5, y, z + (r() - 0.5) * 0.5), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), r() * 6.28), V(1, 1, 1)));
  }
};
/** per-shot-part sun overrides (key "id|light") */
const SUN_SHOT: Record<string, { az?: number; el?: number }> = {};

/** gold sparkle coins: emissive above 1 so the bloom catches them */
const twoToneEmissive = (col: string, em: string) => {
  const m = lam("goldSpark", () => ({ color: col, emissive: new THREE.Color(em) }));
  return m as THREE.MeshLambertMaterial;
};
const mulberry = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const WATER_DECL = `#include <common>
varying vec3 vWP;
uniform vec3 wNearC, wMidC, wFarC, wCrest, wTrough, wGlint, wShade;
uniform sampler2D wNearTex, wFarTex;
uniform float wTime;`;
const WATER_COL = `
  vec3 wV = vWP - cameraPosition;
  float wd = length(wV);
  float wDep = asin(clamp(-wV.y / wd, 0.0, 1.0));       // depression angle of the view ray
  float wf = 1.0 - smoothstep(0.0, 0.42, wDep);         // 1 at the horizon .. 0 at 24 deg down
  vec3 wc = mix(mix(wNearC, wMidC, smoothstep(0.0, 0.55, wf)), wFarC, smoothstep(0.62, 1.0, wf));
  vec2 wp = vWP.xz + vec2(0.18 * wTime, 0.11 * wTime);  // gentle swell drift
  vec4 mk = mix(texture2D(wNearTex, wp / 7.0), texture2D(wFarTex, wp / 40.0 + 0.37), smoothstep(25.0, 90.0, wd));
  float wNearK = smoothstep(18.0, 140.0, wd);
  wc = mix(wc, wTrough, mk.g * mix(0.25, 0.55, wNearK));
  wc = mix(wc, wCrest, mk.r * mix(0.25, 0.75, wNearK));
  wc = mix(wc, wGlint, mk.b * (0.3 + 0.5 * wf));
  diffuseColor.rgb = wc;`;


