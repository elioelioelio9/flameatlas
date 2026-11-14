/**
 * Procedural models for the diorama scenes: launch vehicle and tower, surface habitats, domes, greenhouses,
 * solar arrays, antennas, rovers, landers and animated astronauts. Built from primitives so they stay light
 * and share materials; `detail` trims segment counts for the miniature versions placed on the planets.
 */
import * as THREE from "three";
import type { Detail } from "./tiles";

const seg = (d: Detail, hi: number, lo: number) => (d === "high" ? hi : lo);

// ------------------------------------------------------------------ textures
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
let _mats: ReturnType<typeof makeMats> | null = null;
function makeMats() {
  const panel = canvasTex(256, 256, (g) => {
    g.fillStyle = "#e9e7e1"; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "rgba(90,90,90,.35)"; g.lineWidth = 2;
    for (let y = 0; y <= 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    for (let x = 0; x <= 256; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
    g.fillStyle = "rgba(60,60,60,.25)"; for (let q = 0; q < 40; q++) g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  });
  const solar = canvasTex(256, 256, (g) => {
    g.fillStyle = "#0e1a3a"; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 16) for (let x = 0; x < 256; x += 16) { g.fillStyle = (x + y) % 32 ? "#1b2d5c" : "#172a55"; g.fillRect(x + 1, y + 1, 14, 14); }
    g.strokeStyle = "#8f98a8"; g.lineWidth = 2; g.strokeRect(1, 1, 254, 254);
  });
  const foil = canvasTex(128, 128, (g) => {
    const gr = g.createLinearGradient(0, 0, 128, 128); gr.addColorStop(0, "#f2cf6b"); gr.addColorStop(0.5, "#b8862c"); gr.addColorStop(1, "#e9c25a");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "rgba(90,60,10,.4)"; for (let q = 0; q < 30; q++) { g.beginPath(); g.moveTo(Math.random() * 128, Math.random() * 128); g.lineTo(Math.random() * 128, Math.random() * 128); g.stroke(); }
  });
  const gores = canvasTex(512, 128, (g) => {
    g.fillStyle = "#f1efe9"; g.fillRect(0, 0, 512, 128);
    g.strokeStyle = "rgba(120,115,105,.5)"; g.lineWidth = 2; for (let x = 0; x < 512; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 128); g.stroke(); }
    g.strokeStyle = "rgba(120,115,105,.35)"; for (let y = 16; y < 128; y += 28) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  });
  const pad = canvasTex(512, 512, (g) => {
    g.fillStyle = "#6d6b67"; g.fillRect(0, 0, 512, 512);
    for (let q = 0; q < 2500; q++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "30,30,30" : "200,200,200"},.06)`; g.fillRect(Math.random() * 512, Math.random() * 512, 4, 4); }
    g.strokeStyle = "#e8e3cf"; g.lineWidth = 14; g.beginPath(); g.arc(256, 256, 200, 0, 7); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.arc(256, 256, 236, 0, 7); g.stroke();
    g.fillStyle = "#e8e3cf"; g.font = "bold 190px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("H", 256, 266);
    const gr = g.createRadialGradient(256, 256, 20, 256, 256, 160); gr.addColorStop(0, "rgba(10,10,10,.55)"); gr.addColorStop(1, "rgba(10,10,10,0)"); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  });
  return {
    white: new THREE.MeshStandardMaterial({ color: 0xffffff, map: panel, roughness: 0.55, metalness: 0.08 }),
    plain: new THREE.MeshStandardMaterial({ color: 0xeceae4, roughness: 0.5, metalness: 0.05 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.32, metalness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xd6d9dd, roughness: 0.34, metalness: 0.72 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.3 }),
    black: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.45, metalness: 0.2 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xc2622a, roughness: 0.75, metalness: 0.05 }),
    red: new THREE.MeshStandardMaterial({ color: 0xb53a2c, roughness: 0.55 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffffff, map: foil, roughness: 0.28, metalness: 1 }),
    solar: new THREE.MeshStandardMaterial({ color: 0xffffff, map: solar, roughness: 0.22, metalness: 0.65, side: THREE.DoubleSide }),
    glow: new THREE.MeshStandardMaterial({ color: 0x332211, emissive: 0xffd49a, emissiveIntensity: 2.2 }),
    blueGlow: new THREE.MeshStandardMaterial({ color: 0x112233, emissive: 0x8fd0ff, emissiveIntensity: 2.0 }),
    redGlow: new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff3322, emissiveIntensity: 3 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.28, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }),
    plants: new THREE.MeshStandardMaterial({ color: 0x3f8a2c, emissive: 0x1d5a10, emissiveIntensity: 0.6, roughness: 0.8 }),
    growLight: new THREE.MeshStandardMaterial({ color: 0x331133, emissive: 0xff66d9, emissiveIntensity: 2.4 }),
    gores: new THREE.MeshStandardMaterial({ color: 0xffffff, map: gores, roughness: 0.75 }),
    pad: new THREE.MeshStandardMaterial({ color: 0xffffff, map: pad, roughness: 0.9 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xa9a7a0, roughness: 0.95 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.9, metalness: 0.2 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x8a6420, roughness: 0.08, metalness: 1, envMapIntensity: 2 }),
    suit: new THREE.MeshStandardMaterial({ color: 0xf3f2ee, roughness: 0.8 }),
    suitDark: new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.7 }),
  };
}
export const mats = () => (_mats ??= makeMats());

// ------------------------------------------------------------------ helpers
const mesh = (g: THREE.BufferGeometry, m: THREE.Material, cast = true) => { const o = new THREE.Mesh(g, m); o.castShadow = cast; o.receiveShadow = true; return o; };
function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): T { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; }
function lathe(profile: [number, number][], d: Detail, m: THREE.Material) {
  return mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg(d, 48, 14)), m);
}

// ------------------------------------------------------------------ astronaut
export interface Astronaut { group: THREE.Group; animate: (phase: number, gait: "walk" | "hop" | "float") => void }
export function astronaut(d: Detail, scale = 1): Astronaut {
  const M = mats();
  const g = new THREE.Group();
  const s = seg(d, 14, 6);
  const body = new THREE.Group(); g.add(body);
  const torso = mesh(new THREE.CapsuleGeometry(0.11, 0.16, 4, s), M.suit); torso.position.y = 0.52; torso.scale.set(1, 1, 0.82); body.add(torso);
  const pack = mesh(new THREE.BoxGeometry(0.2, 0.26, 0.11), M.plain); pack.position.set(0, 0.55, -0.12); body.add(pack);
  const helmet = mesh(new THREE.SphereGeometry(0.095, s, s), M.suit); helmet.position.y = 0.76; body.add(helmet);
  const visor = mesh(new THREE.SphereGeometry(0.083, s, s, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.28, Math.PI * 0.4), M.visor); visor.position.set(0, 0.765, 0.022); body.add(visor);
  const chest = mesh(new THREE.BoxGeometry(0.11, 0.06, 0.03), M.suitDark); chest.position.set(0, 0.55, 0.095); body.add(chest);
  const limb = (r: number, l: number) => { const p = new THREE.Group(); const m = mesh(new THREE.CapsuleGeometry(r, l, 3, s), M.suit); m.position.y = -l / 2 - r * 0.6; p.add(m); return p; };
  const legL = limb(0.048, 0.24), legR = limb(0.048, 0.24), armL = limb(0.036, 0.2), armR = limb(0.036, 0.2);
  legL.position.set(-0.055, 0.37, 0); legR.position.set(0.055, 0.37, 0);
  armL.position.set(-0.135, 0.63, 0); armR.position.set(0.135, 0.63, 0);
  for (const b of [legL, legR]) { const boot = mesh(new THREE.BoxGeometry(0.075, 0.05, 0.12), M.suitDark); boot.position.set(0, -0.33, 0.02); b.add(boot); }
  body.add(legL, legR, armL, armR);
  g.scale.setScalar(scale);
  const animate = (ph: number, gait: "walk" | "hop" | "float") => {
    if (gait === "float") {
      legL.rotation.x = 0.25 + Math.sin(ph * 0.7) * 0.15; legR.rotation.x = 0.1 - Math.sin(ph * 0.7) * 0.15;
      armL.rotation.set(-0.6 + Math.sin(ph) * 0.2, 0, -0.3); armR.rotation.set(-1.2 + Math.cos(ph * 0.8) * 0.25, 0, 0.3);
      body.position.y = 0; return;
    }
    const sw = gait === "hop" ? 0.35 : 0.6;
    legL.rotation.x = Math.sin(ph) * sw; legR.rotation.x = -Math.sin(ph) * sw;
    armL.rotation.set(-Math.sin(ph) * sw * 0.8, 0, -0.18); armR.rotation.set(Math.sin(ph) * sw * 0.8, 0, 0.18);
    body.position.y = gait === "hop" ? Math.abs(Math.sin(ph)) * 0.16 : Math.abs(Math.sin(ph)) * 0.025;
  };
  animate(0, "walk");
  return { group: g, animate };
}

/** astronaut walking a closed loop on the terrain */
export function walker(d: Detail, path: [number, number][], heightAt: (x: number, z: number) => number, opts: { scale: number; speed: number; gait: "walk" | "hop"; offset?: number }) {
  const a = astronaut(d, opts.scale);
  const curve = new THREE.CatmullRomCurve3(path.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, "centripetal");
  const len = curve.getLength();
  let s = (opts.offset ?? 0) * len;
  const p = new THREE.Vector3(), t = new THREE.Vector3();
  const update = (dt: number) => {
    s = (((s + opts.speed * dt) % len) + len) % len;
    const u = Math.min(0.99999, Math.max(0, s / len)); curve.getPointAt(u, p); curve.getTangentAt(u, t);
    a.group.position.set(p.x, heightAt(p.x, p.z), p.z);
    a.group.rotation.y = Math.atan2(t.x, t.z);
    a.animate((s / (opts.scale * 0.55)) * Math.PI, opts.gait);
  };
  update(0);
  return { object: a.group, update };
}

// ------------------------------------------------------------------ launch vehicle (SLS-like with Orion)
export function launchVehicle(d: Detail) {
  const M = mats(); const g = new THREE.Group(); const S = seg(d, 40, 12);
  const core = mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.1, S), M.orange); core.position.y = 1.15; g.add(core);
  for (const y of [0.18, 1.0, 2.15]) { const r = mesh(new THREE.CylinderGeometry(0.143, 0.143, 0.03, S), M.dark); r.position.y = y; g.add(r); }
  const engSect = mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.14, S), M.white); engSect.position.y = 0.07; g.add(engSect);
  for (let q = 0; q < 4; q++) { const a = (q / 4) * Math.PI * 2 + Math.PI / 4; const b = lathe([[0.012, 0], [0.03, -0.02], [0.048, -0.1]], d, M.dark); b.position.set(Math.cos(a) * 0.07, 0.0, Math.sin(a) * 0.07); g.add(b); }
  const adapter = mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.18, S), M.white); adapter.position.y = 2.29; g.add(adapter);
  const icps = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.3, S), M.white); icps.position.y = 2.53; g.add(icps);
  const sm = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, S), M.metal); sm.position.y = 2.75; g.add(sm);
  const fair = mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.16, S), M.plain); fair.position.y = 2.9; g.add(fair);
  const lasCone = mesh(new THREE.ConeGeometry(0.06, 0.18, S), M.plain); lasCone.position.y = 3.07; g.add(lasCone);
  const las = mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.34, 10), M.plain); las.position.y = 3.32; g.add(las);
  const lasTip = mesh(new THREE.ConeGeometry(0.016, 0.05, 10), M.dark); lasTip.position.y = 3.51; g.add(lasTip);
  for (const sx of [-1, 1]) {
    const b = new THREE.Group(); b.position.set(sx * 0.2, 0, 0); g.add(b);
    const body = mesh(new THREE.CylinderGeometry(0.062, 0.062, 1.95, S), M.plain); body.position.y = 1.08; b.add(body);
    for (const y of [0.45, 0.85, 1.25, 1.65]) { const r = mesh(new THREE.CylinderGeometry(0.064, 0.064, 0.025, S), M.dark); r.position.y = y; b.add(r); }
    const nose = mesh(new THREE.ConeGeometry(0.062, 0.2, S), M.plain); nose.position.y = 2.15; b.add(nose);
    const skirt = mesh(new THREE.CylinderGeometry(0.062, 0.085, 0.14, S), M.plain); skirt.position.y = 0.07; b.add(skirt);
    const noz = lathe([[0.03, 0], [0.045, -0.03], [0.06, -0.09]], d, M.dark); b.add(noz);
    const strut = mesh(new THREE.BoxGeometry(0.08, 0.025, 0.025), M.dark); strut.position.set(-sx * 0.06, 1.85, 0); b.add(strut);
  }
  return g;
}

export function launchTower(d: Detail) {
  const M = mats(); const g = new THREE.Group();
  const plat = mesh(new THREE.BoxGeometry(1.1, 0.14, 0.9), M.dark); plat.position.y = 0.07; g.add(plat);
  const hole = mesh(new THREE.BoxGeometry(0.62, 0.02, 0.3), M.black); hole.position.set(0, 0.145, 0); g.add(hole);
  for (const [x, z] of [[-0.48, -0.38], [0.48, -0.38], [-0.48, 0.38], [0.48, 0.38]]) { const leg = mesh(new THREE.BoxGeometry(0.1, 0.36, 0.1), M.concrete); leg.position.set(x, -0.1, z); g.add(leg); }
  // lattice tower behind the rocket
  const H = 3.75, W = 0.32, tz = -0.48, tower = new THREE.Group(); tower.position.set(0, 0.14, tz); g.add(tower);
  const post = new THREE.BoxGeometry(0.03, H, 0.03), bar = new THREE.BoxGeometry(W, 0.018, 0.018), barZ = new THREE.BoxGeometry(0.018, 0.018, W);
  for (const [x, z] of [[-W / 2, -W / 2], [W / 2, -W / 2], [-W / 2, W / 2], [W / 2, W / 2]]) tower.add(at(mesh(post, M.metal), x, H / 2, z));
  const levels = d === "high" ? 26 : 8;
  for (let q = 0; q <= levels; q++) {
    const y = (q / levels) * H;
    for (const z of [-W / 2, W / 2]) tower.add(at(mesh(bar, M.metal, false), 0, y, z));
    for (const x of [-W / 2, W / 2]) tower.add(at(mesh(barZ, M.metal, false), x, y, 0));
    if (d === "high" && q < levels) {
      const diag = new THREE.BoxGeometry(0.012, Math.hypot(W, H / levels), 0.012);
      for (const z of [-W / 2, W / 2]) { const m = at(mesh(diag, M.metal, false), 0, y + H / levels / 2, z); m.rotation.z = Math.atan2(W, H / levels) * (q % 2 ? 1 : -1); tower.add(m); }
    }
  }
  // crew access arm + umbilicals
  const arm = mesh(new THREE.BoxGeometry(0.06, 0.06, 0.34), M.plain); arm.position.set(0, 2.8, 0.27); tower.add(arm);
  const room = mesh(new THREE.BoxGeometry(0.12, 0.1, 0.08), M.plain); room.position.set(0, 2.8, 0.42); tower.add(room);
  for (const y of [1.4, 2.25]) { const u = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), M.dark); u.position.set(0.08, y, 0.25); tower.add(u); }
  const top = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), M.metal); top.position.set(0, H + 0.25, 0); tower.add(top);
  const beacon = mesh(new THREE.SphereGeometry(0.03, 8, 6), M.redGlow); beacon.position.set(0, H + 0.5, 0); tower.add(beacon);
  return g;
}

/** water deluge towers & lightning masts around the pad */
export function lightningMast(h: number) {
  const M = mats(); const g = new THREE.Group();
  g.add(at(mesh(new THREE.CylinderGeometry(0.02, 0.035, h, 8), M.metal), 0, h / 2, 0));
  g.add(at(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.4, 4), M.metal), 0, h + 0.2, 0));
  return g;
}

// ------------------------------------------------------------------ surface habitats
/** horizontal pressurised module (Moon base / Mars base), end caps, rings, window strip and hatch */
export function moduleH(d: Detail, len: number, r: number, opts: { windows?: boolean; berm?: THREE.Material } = {}) {
  const M = mats(); const g = new THREE.Group(); const S = seg(d, 36, 12);
  const tex = (M.white.map as THREE.Texture).clone(); tex.needsUpdate = true; tex.repeat.set(len * 2, 2);
  const skin = M.white.clone(); skin.map = tex;
  const body = mesh(new THREE.CylinderGeometry(r, r, len, S, 1), skin); body.rotation.z = Math.PI / 2; body.position.y = r; g.add(body);
  for (const sx of [-1, 1]) {
    const cap = mesh(new THREE.SphereGeometry(r, S, S / 2, 0, Math.PI * 2, 0, Math.PI / 2), M.plain); cap.rotation.z = -sx * Math.PI / 2; cap.scale.set(1, 0.45, 1); cap.position.set(sx * len / 2, r, 0); g.add(cap);
    const ring = mesh(new THREE.TorusGeometry(r * 1.01, r * 0.04, 6, S), M.metal); ring.rotation.y = Math.PI / 2; ring.position.set(sx * len / 2, r, 0); g.add(ring);
  }
  for (let q = 1; q < Math.floor(len / (r * 1.3)); q++) { const ring = mesh(new THREE.TorusGeometry(r * 1.005, r * 0.025, 5, S), M.metal, false); ring.rotation.y = Math.PI / 2; ring.position.set(-len / 2 + q * r * 1.3, r, 0); g.add(ring); }
  if (opts.windows !== false) {
    const nW = Math.max(2, Math.floor(len / (r * 0.7)));
    for (let q = 0; q < nW; q++) for (const sz of [-1, 1]) {
      const w = mesh(new THREE.BoxGeometry(r * 0.28, r * 0.16, 0.01), M.glow, false); w.position.set(-len / 2 + (q + 0.5) * (len / nW), r * 1.18, sz * r * 0.94); w.rotation.x = sz * -0.35; g.add(w);
    }
  }
  const legs = new THREE.CylinderGeometry(r * 0.06, r * 0.08, r * 0.4, 6);
  for (const x of [-len * 0.35, len * 0.35]) for (const z of [-r * 0.6, r * 0.6]) g.add(at(mesh(legs, M.metal), x, r * 0.15, z));
  if (opts.berm) { const b = mesh(new THREE.SphereGeometry(1, S, S / 2, 0, Math.PI * 2, 0, Math.PI / 2), opts.berm); b.scale.set(len * 0.62, r * 1.35, r * 1.55); g.add(b); body.position.y = r * 1.15; }
  return g;
}

/** vertical two-deck habitat (the Mars fire-lab habitat): 6 m diameter cylinder, two window rows, top dome */
export function moduleV(d: Detail, r: number, h: number, highlight = false) {
  const M = mats(); const g = new THREE.Group(); const S = seg(d, 48, 14);
  const tex = (M.white.map as THREE.Texture).clone(); tex.needsUpdate = true; tex.repeat.set(6, 2);
  const skin = M.white.clone(); skin.map = tex;
  const body = mesh(new THREE.CylinderGeometry(r, r, h, S), skin); body.position.y = h / 2 + 0.06; g.add(body);
  const dome = mesh(new THREE.SphereGeometry(r, S, S / 2, 0, Math.PI * 2, 0, Math.PI / 2), M.plain); dome.scale.y = 0.42; dome.position.y = h + 0.06; g.add(dome);
  for (const y of [0.06, h * 0.5 + 0.06, h + 0.06]) g.add(at(mesh(new THREE.TorusGeometry(r * 1.01, r * 0.035, 6, S), M.metal), 0, y, 0, Math.PI / 2));
  const nW = seg(d, 10, 6);
  for (const y of [h * 0.28, h * 0.74]) for (let q = 0; q < nW; q++) {
    const a = (q / nW) * Math.PI * 2; const w = mesh(new THREE.BoxGeometry(r * 0.22, r * 0.14, 0.012), highlight ? M.glow : M.glow, false);
    w.position.set(Math.sin(a) * r * 1.002, y + 0.06, Math.cos(a) * r * 1.002); w.rotation.y = a; g.add(w);
  }
  const ant = mesh(new THREE.CylinderGeometry(0.008, 0.008, r * 0.8, 5), M.metal); ant.position.set(r * 0.3, h + r * 0.75, 0); g.add(ant);
  const tip = mesh(new THREE.SphereGeometry(0.018, 8, 6), M.redGlow, false); tip.position.set(r * 0.3, h + r * 1.15, 0); g.add(tip);
  const legs = new THREE.CylinderGeometry(r * 0.05, r * 0.08, 0.1, 6);
  for (let q = 0; q < 6; q++) { const a = (q / 6) * Math.PI * 2; g.add(at(mesh(legs, M.metal), Math.cos(a) * r * 0.85, 0.05, Math.sin(a) * r * 0.85)); }
  return g;
}

export function dome(d: Detail, r: number, glass = false) {
  const M = mats(); const g = new THREE.Group(); const S = seg(d, 40, 12);
  if (!glass) {
    const t = (M.gores.map as THREE.Texture).clone(); t.needsUpdate = true; t.repeat.set(2, 1); const m = M.gores.clone(); m.map = t;
    g.add(mesh(new THREE.SphereGeometry(r, S, S / 2, 0, Math.PI * 2, 0, Math.PI / 2), m));
  } else {
    const shell = mesh(new THREE.SphereGeometry(r, S, S / 2, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, false); shell.renderOrder = 2; g.add(shell);
    const frame = new THREE.Mesh(new THREE.SphereGeometry(r * 1.002, seg(d, 16, 8), seg(d, 6, 3), 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd8dde2, wireframe: true, transparent: true, opacity: 0.55 }));
    g.add(frame);
    const floor = mesh(new THREE.CylinderGeometry(r, r, 0.02, S), M.concrete); floor.position.y = 0.01; g.add(floor);
    const rows = seg(d, 5, 3);
    for (let q = 0; q < rows; q++) {
      const z = -r * 0.6 + (q / (rows - 1)) * r * 1.2, w = Math.sqrt(Math.max(0, r * r * 0.72 - z * z)) * 2;
      g.add(at(mesh(new THREE.BoxGeometry(w, r * 0.12, r * 0.12), M.plants, false), 0, r * 0.08, z));
      g.add(at(mesh(new THREE.BoxGeometry(w * 0.9, 0.006, 0.02), M.growLight, false), 0, r * 0.42, z));
    }
  }
  const ring = mesh(new THREE.TorusGeometry(r, r * 0.04, 6, S), M.metal); ring.rotation.x = Math.PI / 2; ring.position.y = 0.01; g.add(ring);
  return g;
}

export function tunnel(d: Detail, pts: [number, number, number][], r: number) {
  const M = mats();
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  return mesh(new THREE.TubeGeometry(curve, seg(d, 24, 6), r, seg(d, 16, 6)), M.plain);
}

export function solarField(d: Detail, rows: number, cols: number, w: number, h: number, tilt: number) {
  const M = mats(); const g = new THREE.Group();
  const panel = new THREE.BoxGeometry(w, 0.008, h), leg = new THREE.CylinderGeometry(0.008, 0.008, 0.12, 5);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = (c - (cols - 1) / 2) * (w + 0.04), z = (r - (rows - 1) / 2) * (h + 0.1);
    const p = mesh(panel, M.solar); p.position.set(x, 0.12, z); p.rotation.x = -tilt; g.add(p);
    if (d === "high") g.add(at(mesh(leg, M.metal), x, 0.06, z));
  }
  return g;
}

/** lunar south-pole style vertical solar array on a mast (slowly tracking the Sun) */
export function vsat(d: Detail, h: number) {
  const M = mats(); const g = new THREE.Group();
  g.add(at(mesh(new THREE.CylinderGeometry(0.02, 0.03, h, 8), M.metal), 0, h / 2, 0));
  const head = new THREE.Group(); head.position.y = h * 0.62; g.add(head);
  const wing = new THREE.BoxGeometry(0.34, h * 0.62, 0.006);
  for (const sx of [-1, 1]) head.add(at(mesh(wing, M.solar), sx * 0.19, 0, 0));
  g.userData.head = head;
  if (d === "high") g.add(at(mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.04, 10), M.dark), 0, 0.02, 0));
  return g;
}

export function dish(d: Detail, r: number, h: number) {
  const M = mats(); const g = new THREE.Group();
  g.add(at(mesh(new THREE.CylinderGeometry(0.015, 0.025, h, 8), M.metal), 0, h / 2, 0));
  const head = new THREE.Group(); head.position.y = h; g.add(head);
  const prof: [number, number][] = []; for (let q = 0; q <= 10; q++) { const x = (q / 10) * r; prof.push([x, (x * x) / (4 * r * 0.45)]); }
  const bowl = lathe(prof, d, M.plain); (bowl.material as THREE.Material).side = THREE.DoubleSide; bowl.rotation.x = -Math.PI / 3; head.add(bowl);
  const feed = mesh(new THREE.CylinderGeometry(0.006, 0.006, r * 0.6, 4), M.metal); feed.rotation.x = -Math.PI / 3; feed.position.set(0, r * 0.15, r * 0.12); head.add(feed);
  g.userData.head = head;
  return g;
}

export function rover(d: Detail, scale = 1, pressurised = false) {
  const M = mats(); const g = new THREE.Group();
  const body = pressurised ? mesh(new THREE.CapsuleGeometry(0.11, 0.26, 4, seg(d, 16, 8)), M.white) : mesh(new THREE.BoxGeometry(0.42, 0.06, 0.24), M.metal);
  if (pressurised) { body.rotation.z = Math.PI / 2; body.position.y = 0.2; const w = mesh(new THREE.BoxGeometry(0.06, 0.06, 0.16), M.blueGlow, false); w.position.set(0.24, 0.24, 0); g.add(w); }
  else body.position.y = 0.13;
  g.add(body);
  if (!pressurised) {
    const seat = mesh(new THREE.BoxGeometry(0.08, 0.06, 0.18), M.dark); seat.position.set(-0.04, 0.19, 0); g.add(seat);
    const mast = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.18, 5), M.metal); mast.position.set(0.16, 0.24, 0.08); g.add(mast);
    const ant = mesh(new THREE.SphereGeometry(0.035, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.plain); ant.position.set(0.16, 0.33, 0.08); ant.rotation.x = Math.PI; g.add(ant);
  }
  const wheel = new THREE.CylinderGeometry(0.055, 0.055, 0.04, seg(d, 16, 8)); const wheels: THREE.Mesh[] = [];
  for (const x of pressurised ? [-0.17, 0, 0.17] : [-0.15, 0.15]) for (const z of [-0.14, 0.14]) { const w = mesh(wheel, M.tire); w.rotation.x = Math.PI / 2; w.position.set(x, 0.055, z); g.add(w); wheels.push(w); }
  g.scale.setScalar(scale);
  g.userData.wheels = wheels;
  return g;
}

/** stainless steel lander (Starship-class) with legs and flaps */
export function starship(d: Detail, h: number, hls = false) {
  const M = mats(); const g = new THREE.Group(); const S = seg(d, 40, 12);
  const r = h * 0.075;
  const body = mesh(new THREE.CylinderGeometry(r, r, h * 0.78, S), hls ? M.plain : M.steel); body.position.y = h * 0.39 + 0.02; g.add(body);
  const prof: [number, number][] = []; for (let q = 0; q <= 12; q++) { const t = q / 12; prof.push([r * Math.cos(t * Math.PI / 2) ** 0.6, t * h * 0.22]); }
  const nose = lathe(prof, d, hls ? M.plain : M.steel); nose.position.y = h * 0.78 + 0.02; g.add(nose);
  if (hls) { const band = mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, h * 0.12, S), M.dark); band.position.y = h * 0.1; g.add(band); }
  const tiles = mesh(new THREE.CylinderGeometry(r * 1.004, r * 1.004, h * 0.78, S, 1, true, -Math.PI / 2, Math.PI), M.black); tiles.position.copy(body.position); if (!hls) g.add(tiles);
  if (!hls) for (const [y, w, l] of [[h * 0.12, r * 1.3, h * 0.16], [h * 0.82, r * 0.8, h * 0.1]] as const) for (const sx of [-1, 1]) {
    const f = mesh(new THREE.BoxGeometry(w, l, 0.012), M.black); f.position.set(sx * (r + w / 2 - 0.01), y, 0); f.rotation.z = sx * 0.05; g.add(f);
  }
  const wins = mesh(new THREE.BoxGeometry(r * 0.6, h * 0.03, 0.01), M.glow, false); wins.position.set(0, h * 0.8, r * 0.99); g.add(wins);
  const leg = new THREE.BoxGeometry(0.02, h * 0.18, 0.04);
  for (let q = 0; q < 6; q++) { const a = (q / 6) * Math.PI * 2; const l = mesh(leg, M.dark); l.position.set(Math.cos(a) * r * 1.05, h * 0.07, Math.sin(a) * r * 1.05); l.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); g.add(l); }
  return g;
}

export function landingPad(d: Detail, r: number) {
  const M = mats();
  const p = mesh(new THREE.CylinderGeometry(r, r * 1.04, 0.04, seg(d, 48, 16)), [M.concrete, M.pad, M.concrete] as unknown as THREE.Material);
  p.position.y = 0.02;
  const lights = new THREE.Group();
  const n = seg(d, 16, 8);
  for (let q = 0; q < n; q++) { const a = (q / n) * Math.PI * 2; lights.add(at(mesh(new THREE.SphereGeometry(0.012, 6, 4), M.redGlow, false), Math.cos(a) * r * 0.98, 0.045, Math.sin(a) * r * 0.98)); }
  const g = new THREE.Group(); g.add(p, lights); return g;
}

export function crate(w: number, h: number, l: number, m?: THREE.Material) { return mesh(new THREE.BoxGeometry(w, h, l), m ?? mats().plain); }

export function rocks(d: Detail, n: number, area: number, heightAt: (x: number, z: number) => number, color: number, keepOut: { x: number; z: number; r: number }[], seed = 1) {
  let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const geo = new THREE.DodecahedronGeometry(1, d === "high" ? 1 : 0);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let q = 0; q < pos.count; q++) pos.setXYZ(q, pos.getX(q) * (0.8 + Math.random() * 0.4), pos.getY(q) * (0.55 + Math.random() * 0.3), pos.getZ(q) * (0.8 + Math.random() * 0.4));
  geo.computeVertexNormals();
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }), n);
  im.castShadow = true; im.receiveShadow = true;
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e = new THREE.Euler();
  let k = 0;
  for (let t = 0; t < n * 4 && k < n; t++) {
    const x = (r() - 0.5) * area, z = (r() - 0.5) * area;
    if (keepOut.some((o) => Math.hypot(x - o.x, z - o.z) < o.r)) continue;
    const sz = 0.012 + r() ** 4 * 0.11;
    e.set(r() * 6, r() * 6, r() * 6); q4.setFromEuler(e);
    m4.compose(new THREE.Vector3(x, heightAt(x, z) + sz * 0.2, z), q4, new THREE.Vector3(sz, sz, sz)); im.setMatrixAt(k++, m4);
  }
  im.count = k;
  return im;
}

/** palm-like and pine-like trees for the Florida coast */
export function trees(d: Detail, n: number, area: number, heightAt: (x: number, z: number) => number, accept: (x: number, z: number) => boolean, seed = 3) {
  let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const crown = new THREE.IcosahedronGeometry(1, d === "high" ? 1 : 0);
  const im = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0x2f5a22, roughness: 0.9, flatShading: true }), n);
  im.castShadow = true; im.receiveShadow = true;
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  let k = 0;
  for (let t = 0; t < n * 6 && k < n; t++) {
    const x = (r() - 0.5) * area, z = (r() - 0.5) * area; if (!accept(x, z)) continue;
    const sz = 0.05 + r() * 0.07;
    m4.compose(new THREE.Vector3(x, heightAt(x, z) + sz * 0.9, z), new THREE.Quaternion(), new THREE.Vector3(sz, sz * 1.2, sz)); im.setMatrixAt(k, m4);
    im.setColorAt(k, col.setHSL(0.27 + r() * 0.06, 0.45, 0.18 + r() * 0.1)); k++;
  }
  im.count = k;
  return im;
}
