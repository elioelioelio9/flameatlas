/**
 * The four diorama scenes. Each returns a group in tile coordinates (10 × 10 units, ground ≈ y 0), an update()
 * for animation (astronauts, rovers, rocket liftoff, visiting vehicles), the object whose interior is simulated
 * in the fire lab, and suggested lighting / camera. `detail: "low"` gives the miniature version used on the planets.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { buildTile, type Detail, type Pad, type WorldId } from "./tiles";
import {
  astronaut, crate, dish, dome, landingPad, launchTower, launchVehicle, lightningMast, mats, moduleH, moduleV, rocks, rover,
  solarField, starship, trees, tunnel, vsat, walker,
} from "./models";
import { Puffs } from "./particles";

export interface WorldScene {
  id: WorldId;
  group: THREE.Group;
  /** object whose interior is the fire-lab habitat (its world position anchors labels and clicks) */
  habitat: THREE.Object3D;
  update: (dt: number, t: number) => void;
  setViewportHeight: (px: number) => void;
  /** scale applied to the group (keeps particle sizes consistent) */
  setScale: (k: number) => void;
  /** centre of the base on the ground, tile coordinates */
  anchor: THREE.Vector3;
  sun: { dir: THREE.Vector3; color: number; intensity: number; ambient: number; sky: number | null };
  camera: { pos: THREE.Vector3; target: THREE.Vector3 };
  dispose: () => void;
}

export const WORLD_TEXT: Record<WorldId, { name: string; habitat: string }> = {
  earth: { name: "Earth — launch complex", habitat: "Crew capsule on the pad" },
  iss: { name: "Low Earth orbit — ISS", habitat: "Node 1 · US Lab · Node 2" },
  moon: { name: "Moon — south-pole base", habitat: "Surface habitat (lab, crew, airlock)" },
  mars: { name: "Mars — Jezero outpost", habitat: "Two-deck habitat" },
};

type Updater = (dt: number, t: number) => void;

function finish(id: WorldId, group: THREE.Group, habitat: THREE.Object3D, ups: Updater[], extra: Partial<WorldScene>, disposers: (() => void)[], puffs: Puffs[] = []): WorldScene {
  return {
    id, group, habitat,
    update: (dt, t) => ups.forEach((u) => u(dt, t)),
    setViewportHeight: (px) => puffs.forEach((p) => p.setViewportHeight(px)),
    setScale: (k) => puffs.forEach((p) => p.setScale(k)),
    anchor: extra.anchor ?? new THREE.Vector3(),
    sun: extra.sun!, camera: extra.camera!,
    dispose: () => { disposers.forEach((d) => d()); puffs.forEach((p) => p.dispose()); group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry) m.geometry.dispose(); }); },
  };
}

/** a small group of walkers on loops around the base */
function crew(d: Detail, group: THREE.Group, ups: Updater[], heightAt: (x: number, z: number) => number, loops: [number, number][][], gait: "walk" | "hop", speed: number, scale: number) {
  loops.forEach((loop, q) => {
    const w = walker(d, loop, heightAt, { scale, speed: speed * (0.85 + (q % 3) * 0.12), gait, offset: q * 0.37 });
    group.add(w.object); ups.push((dt) => w.update(dt));
  });
}
const ring = (cx: number, cz: number, rx: number, rz: number, n = 6, phase = 0): [number, number][] =>
  Array.from({ length: n }, (_, q) => [cx + Math.cos(phase + (q / n) * Math.PI * 2) * rx, cz + Math.sin(phase + (q / n) * Math.PI * 2) * rz]);

// =================================================================== EARTH: launch complex, rocket lifting off
function earth(d: Detail, bare = false): WorldScene {
  const padP: Pad = { x: -0.6, z: 0.2, r: 1.25, h: 0.16 };
  const vab: Pad = { x: -3.4, z: -2.9, r: 1.0, h: 0.1 };
  const tile = buildTile("earth", d, [padP, vab, { x: -2.0, z: -1.35, r: 0.35, h: 0.13 }]);
  const g = tile.group; const ups: Updater[] = []; const M = mats();
  const H = bare ? () => 0.13 : tile.heightAt;

  // pad hardstand, crawlerway and flame trench
  const hard = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.06, d === "high" ? 8 : 6), M.concrete); hard.position.set(padP.x, padP.h + 0.0, padP.z); hard.rotation.y = Math.PI / 8; hard.receiveShadow = true; g.add(hard);
  const trench = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.07, 0.36), M.black); trench.position.set(padP.x, padP.h + 0.005, padP.z); g.add(trench);
  const crawl = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 4.1), M.concrete); crawl.rotation.x = -Math.PI / 2; crawl.rotation.z = -0.68; crawl.position.set(-2.1, 0.135, -1.4); crawl.receiveShadow = true; if (!bare) g.add(crawl);

  // mobile launcher + tower + vehicle
  const ml = launchTower(d); ml.position.set(padP.x, padP.h + 0.22, padP.z); g.add(ml);
  const rocket = launchVehicle(d); const rocketBase = new THREE.Vector3(padP.x, padP.h + 0.38, padP.z); rocket.position.copy(rocketBase); g.add(rocket);
  for (const [x, z] of [[-1.7, -0.7], [0.5, -0.7], [-0.6, 1.4]]) { const m = lightningMast(2.7); m.position.set(x, H(x, z), z); g.add(m); }
  const wt = new THREE.Group(); wt.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6), M.metal)); const sph = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 10), M.plain); sph.position.y = 0.48; wt.add(sph); wt.position.set(0.7, 0.55, 1.1); g.add(wt);

  // vehicle assembly building and crew building
  const vb = new THREE.Group();
  const big = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.45, 1.05), M.plain); big.position.y = 0.72; big.castShadow = true; vb.add(big);
  const low = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.45, 1.05), M.plain); low.position.set(0.95, 0.22, 0); low.castShadow = true; vb.add(low);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.32, 1.2, 0.01), M.dark); door.position.set(0, 0.62, 0.53); vb.add(door);
  for (let q = 0; q < 6; q++) { const st = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.012, 1.06), M.metal); st.position.y = 0.2 + q * 0.22; vb.add(st); }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.5, 0.36), M.red); stripe.position.set(-0.63, 1.05, -0.2); vb.add(stripe);
  vb.position.set(vab.x, vab.h, vab.z); vb.rotation.y = -0.68; if (!bare) g.add(vb);
  const cb = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.16, 0.3), M.plain); cb.position.set(-2.0, 0.21, -1.35); cb.castShadow = true; g.add(cb);
  const cbWin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.01), M.glow); cbWin.position.set(-2.0, 0.24, -1.196); g.add(cbWin);

  // vegetation
  if (bare) { /* no vegetation on the globe */ } else if (d === "high") g.add(trees(d, 520, 9.6, H, (x, z) => H(x, z) > 0.07 && Math.hypot(x - padP.x, z - padP.z) > 1.55 && Math.hypot(x - vab.x, z - vab.z) > 1.3 && Math.abs((x + 2.1) * Math.sin(0.68) + (z + 1.4) * Math.cos(0.68)) > 0.35));
  else g.add(trees(d, 90, 9.6, H, (x, z) => H(x, z) > 0.07 && Math.hypot(x - padP.x, z - padP.z) > 1.55 && Math.hypot(x - vab.x, z - vab.z) > 1.3));

  // spectators: crew and ground team near the crew building
  crew(d, g, ups, H, [ring(-2.0, -0.95, 0.35, 0.18, 6), ring(-2.35, -1.0, 0.2, 0.25, 5, 1), ring(-1.65, -1.05, 0.25, 0.15, 5, 2)], "walk", 0.1, 0.17);

  // ----- liftoff: flame core (additive), steam deluge clouds, climb-out smoke trail
  const flame = new Puffs({ max: d === "high" ? 1400 : 260, additive: true, size: [0.16, 0.42], color: [0xfff6d8, 0xff7a1a], opacity: [0.9, 0], fadeIn: 0.02, billow: 0.3, drag: 0.5 });
  const steam = new Puffs({ max: d === "high" ? 1400 : 260, size: [0.35, 1.7], color: [0xffffff, 0xb9b6b0], opacity: [0.85, 0], fadeIn: 0.08, billow: 0.75, drag: 0.55, accel: [0, 0.09, 0] });
  const trail = new Puffs({ max: d === "high" ? 900 : 160, size: [0.15, 0.9], color: [0xf4f1ea, 0xa8a49c], opacity: [0.75, 0], fadeIn: 0.05, billow: 0.7, drag: 0.3, accel: [0.02, 0.02, 0] });
  g.add(flame.points, steam.points, trail.points);
  const plumeLight = new THREE.PointLight(0xffa04a, 0, 9, 1.4); g.add(plumeLight);
  const CYCLE = 26; const nozzles: [number, number][] = [[0.2, 0], [-0.2, 0], [0.07, 0.07], [-0.07, 0.07], [0.07, -0.07], [-0.07, -0.07]];
  let emitAcc = 0;
  ups.push((dt, t) => {
    const c = t % CYCLE;
    const firing = c > 2 && c < 22;
    const rise = c > 4.5 ? 0.5 * 0.028 * (c - 4.5) ** 2 : 0;
    rocket.position.set(rocketBase.x + rise * 0.04, rocketBase.y + rise, rocketBase.z);
    rocket.rotation.z = -Math.min(0.12, rise * 0.012);
    rocket.visible = c < 22;
    const ny = rocket.position.y - 0.02;
    emitAcc += dt * (d === "high" ? 1 : 0.25);
    const ticks = Math.floor(emitAcc * 60); emitAcc -= ticks / 60;
    const ramp = Math.min(1, (c - 2) / 1.2);
    if (firing) for (let k = 0; k < ticks; k++) {
      for (const [ox, oz] of nozzles) for (let q = 0; q < (ox * ox > 0.03 ? 3 : 2); q++)
        flame.emit(rocket.position.x + ox + (Math.random() - 0.5) * 0.04, ny - 0.04, rocket.position.z + oz + (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.4, -3.6 * ramp - Math.random(), (Math.random() - 0.5) * 0.4, 0.16 + Math.random() * 0.1);
      const near = ny - padP.h < 1.6;
      if (near) for (let q = 0; q < 5; q++) { const side = Math.random() < 0.5 ? -1 : 1; steam.emit(padP.x + side * 0.95, padP.h + 0.08, padP.z + (Math.random() - 0.5) * 0.3, side * (1.4 + Math.random() * 1.2) * ramp, 0.1 + Math.random() * 0.25, (Math.random() - 0.5) * 0.7, 5 + Math.random() * 4); }
      if (rise > 0.3) for (let q = 0; q < 3; q++) trail.emit(rocket.position.x + (Math.random() - 0.5) * 0.1, ny - 0.2 - Math.random() * 0.4, rocket.position.z + (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1, -0.2, (Math.random() - 0.5) * 0.1, 6 + Math.random() * 3);
    }
    flame.step(dt); steam.step(dt); trail.step(dt);
    plumeLight.position.set(rocket.position.x, ny - 0.3, rocket.position.z);
    plumeLight.intensity = firing ? (14 + Math.random() * 5) * ramp : 0;
    const warm = new THREE.Color(firing ? 0.35 * ramp : 0, firing ? 0.16 * ramp : 0, 0);
    steam.setLight(warm, plumeLight.position, 1.6); trail.setLight(warm, plumeLight.position, 1.2);
    const w = g.userData.water as THREE.Texture | undefined; if (w) w.offset.set(t * 0.004, t * 0.003);
  });
  // the fire lab follows the crew capsule at the top of the stack
  const capsule = new THREE.Object3D(); capsule.position.set(0, 2.98, 0); rocket.add(capsule);

  return finish("earth", g, capsule, ups, {
    sun: { dir: new THREE.Vector3(-0.6, 0.75, 0.4).normalize(), color: 0xfff1dc, intensity: 3.2, ambient: 0.55, sky: 0x9cc4e8 },
    camera: { pos: new THREE.Vector3(6.5, 4.8, 8.2), target: new THREE.Vector3(-0.4, 1.3, 0) }, anchor: new THREE.Vector3(-1.1, padP.h, -0.4),
  }, [tile.dispose], [flame, steam, trail]);
}

// =================================================================== MOON: south-pole surface base
function moon(d: Detail, bare = false): WorldScene {
  const base: Pad = { x: 0.3, z: 0.4, r: 2.3, h: 0.0 }, lpad: Pad = { x: -2.9, z: 2.7, r: 0.75, h: 0.0 };
  const tile = buildTile("moon", d, [base, lpad]);
  const g = tile.group; const ups: Updater[] = []; const H = bare ? () => 0 : tile.heightAt; const M = mats();
  const regolith = new THREE.MeshStandardMaterial({ color: 0x8c8a86, roughness: 1 });

  const hab = moduleH(d, 1.7, 0.27); hab.position.set(0.3, 0, 0.3); g.add(hab);       // the fire-lab habitat (10 m module)
  const airlock = moduleH(d, 0.42, 0.2, { windows: false }); airlock.position.set(1.42, 0, 0.3); g.add(airlock);
  const m2 = moduleH(d, 1.2, 0.25, { berm: regolith }); m2.position.set(-0.3, 0, -1.25); m2.rotation.y = 0.5; g.add(m2);
  const d1 = dome(d, 0.55); d1.position.set(-1.35, 0, 0.55); g.add(d1);
  const gh = dome(d, 0.45, true); gh.position.set(1.15, 0, -1.25); g.add(gh);
  g.add(tunnel(d, [[-0.55, 0.22, 0.3], [-0.85, 0.2, 0.45], [-0.95, 0.2, 0.52]], 0.1));
  g.add(tunnel(d, [[0.3, 0.2, 0.0], [0.15, 0.2, -0.6], [-0.05, 0.2, -1.0]], 0.09));
  g.add(tunnel(d, [[0.95, 0.2, 0.05], [1.1, 0.2, -0.5], [1.12, 0.18, -0.82]], 0.08));
  const arrays: THREE.Group[] = [];
  for (const [x, z] of [[2.6, 1.7], [3.1, 0.9], [2.4, 2.6], [3.4, 2.0]]) { const v = vsat(d, 1.5); v.position.set(x, H(x, z), z); g.add(v); arrays.push(v); }
  const dsh = dish(d, 0.35, 0.55); dsh.position.set(-1.4, 0, -0.75); g.add(dsh);
  for (const [x, z, w] of [[0.9, 1.1, 0.16], [1.1, 1.25, 0.12], [-0.6, 1.3, 0.2]] as const) { const c = crate(w, w * 0.7, w); c.position.set(x, w * 0.35, z); g.add(c); }
  const lp = landingPad(d, 0.7); lp.position.set(lpad.x, 0, lpad.z); g.add(lp);
  const hls = starship(d, 2.3, true); hls.position.set(lpad.x, 0.04, lpad.z); g.add(hls);
  const ltv = rover(d, 0.75); g.add(ltv);
  const pr = rover(d, 0.9, true); pr.position.set(-0.6, 0, 1.75); pr.rotation.y = 0.4; g.add(pr);
  if (!bare) g.add(rocks(d, d === "high" ? 420 : 60, 9.6, H, 0x55534f, [{ x: base.x, z: base.z, r: 2.2 }, { x: lpad.x, z: lpad.z, r: 0.9 }], 7));
  crew(d, g, ups, H, [ring(0.3, 1.0, 0.7, 0.3, 6), ring(-0.7, 1.2, 0.45, 0.35, 5, 1), ring(2.0, 1.3, 0.5, 0.6, 5, 2), ring(-1.6, 2.0, 0.6, 0.5, 6, 3)], "hop", 0.13, 0.17);
  const path = new THREE.CatmullRomCurve3(ring(0.4, 0.5, 2.3, 2.0, 10).map(([x, z]) => new THREE.Vector3(x, 0, z)), true);
  let s = 0; const p = new THREE.Vector3(), tg = new THREE.Vector3();
  ups.push((dt, t) => {
    s = (s + Math.max(0, dt) * 0.012) % 1; path.getPointAt(s, p); path.getTangentAt(s, tg);
    ltv.position.set(p.x, H(p.x, p.z), p.z); ltv.rotation.y = Math.atan2(tg.x, tg.z) - Math.PI / 2;
    (ltv.userData.wheels as THREE.Mesh[]).forEach((w) => (w.rotation.y += dt * 2));
    arrays.forEach((a, q) => ((a.userData.head as THREE.Group).rotation.y = t * 0.02 + q * 0.05));
    (dsh.userData.head as THREE.Group).rotation.y = Math.sin(t * 0.1) * 0.6;
  });
  return finish("moon", g, hab, ups, {
    sun: { dir: new THREE.Vector3(-0.85, 0.28, 0.35).normalize(), color: 0xffffff, intensity: 3.4, ambient: 0.1, sky: null },
    camera: { pos: new THREE.Vector3(6.8, 4.6, 7.4), target: new THREE.Vector3(0, 0.2, 0.2) }, anchor: new THREE.Vector3(0, 0, 0.6),
  }, [tile.dispose]);
}

// =================================================================== MARS: outpost
function mars(d: Detail, bare = false): WorldScene {
  const base: Pad = { x: 0.8, z: 0.9, r: 2.4, h: 0.12 }, lpad: Pad = { x: -2.2, z: 3.3, r: 0.75, h: 0.1 };
  const tile = buildTile("mars", d, [base, lpad, { x: 3.4, z: -1.8, r: 0.9, h: 0.2 }]);
  const g = tile.group; const ups: Updater[] = []; const H = bare ? () => base.h : tile.heightAt; const M = mats();
  const y0 = base.h;

  const hab = moduleV(d, 0.4, 0.66, true); hab.position.set(0.8, y0, 0.9); g.add(hab);          // the fire-lab habitat (two decks)
  const ring6: [number, number, number][] = [[2.1, 0.5, 0.2], [1.6, 2.1, -1.0], [-0.4, 1.9, 0.9], [-0.5, 0.0, 2.0], [0.9, -0.5, 1.4]];
  ring6.forEach(([x, z, ry], q) => {
    const m = q === 1 ? dome(d, 0.45, true) : q === 3 ? dome(d, 0.5) : moduleH(d, 0.95, 0.2);
    m.position.set(x, y0, z); if (q !== 1 && q !== 3) m.rotation.y = ry; g.add(m);
    g.add(tunnel(d, [[0.8 + (x - 0.8) * 0.2, y0 + 0.16, 0.9 + (z - 0.9) * 0.2], [0.8 + (x - 0.8) * 0.55, y0 + 0.15, 0.9 + (z - 0.9) * 0.55], [0.8 + (x - 0.8) * 0.78, y0 + 0.15, 0.9 + (z - 0.9) * 0.78]], 0.07));
  });
  const gh2 = dome(d, 0.38, true); gh2.position.set(2.5, y0, 1.7); g.add(gh2);
  // comms tower
  const tw = new THREE.Group(); const twm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.3, 0.14), M.white); twm.position.y = 0.65; twm.castShadow = true; tw.add(twm);
  for (let q = 0; q < 6; q++) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.03, 0.145), M.blueGlow); w.position.y = 0.2 + q * 0.18; tw.add(w); }
  const dsh = dish(d, 0.22, 0.25); dsh.position.y = 1.3; tw.add(dsh); tw.position.set(-0.6, y0, -0.9); g.add(tw);
  const sf = solarField(d, 4, 6, 0.32, 0.22, 0.5); sf.position.set(3.4, 0.2, -1.8); sf.rotation.y = 0.3; g.add(sf);
  const lp = landingPad(d, 0.75); lp.position.set(lpad.x, lpad.h, lpad.z); g.add(lp);
  const ship = starship(d, 2.4); ship.position.set(lpad.x, lpad.h + 0.04, lpad.z); g.add(ship);
  const rv = rover(d, 0.75, true); g.add(rv);
  for (const [x, z] of [[1.6, -0.3], [1.8, -0.2], [-0.2, 2.8]]) { const c = crate(0.14, 0.1, 0.14, M.orange); c.position.set(x, H(x, z) + 0.05, z); g.add(c); }
  if (!bare) g.add(rocks(d, d === "high" ? 380 : 50, 9.6, H, 0x8a4a2c, [{ x: base.x, z: base.z, r: 2.4 }, { x: lpad.x, z: lpad.z, r: 0.95 }, { x: 3.4, z: -1.8, r: 1.1 }], 13));
  crew(d, g, ups, H, [ring(0.8, 0.9, 0.85, 0.7, 7), ring(-0.9, 2.4, 0.5, 0.45, 5, 1), ring(2.6, -0.6, 0.55, 0.5, 6, 2), ring(1.2, 2.6, 0.5, 0.35, 5, 3), ring(-1.3, 0.6, 0.35, 0.6, 5, 4)], "walk", 0.11, 0.17);
  const path = new THREE.CatmullRomCurve3(ring(0.6, 0.8, 2.6, 2.2, 10, 0.4).map(([x, z]) => new THREE.Vector3(x, 0, z)), true);
  let s = 0.3; const p = new THREE.Vector3(), tg = new THREE.Vector3();
  // dust devils of fine dust drifting across the plain
  const dust = new Puffs({ max: d === "high" ? 500 : 80, size: [0.2, 0.9], color: [0xd8a173, 0xc58b62], opacity: [0.18, 0], fadeIn: 0.2, billow: 0.8, drag: 0.1 });
  g.add(dust.points);
  ups.push((dt, t) => {
    s = (s + Math.max(0, dt) * 0.011) % 1; path.getPointAt(s, p); path.getTangentAt(s, tg);
    rv.position.set(p.x, H(p.x, p.z), p.z); rv.rotation.y = Math.atan2(tg.x, tg.z) - Math.PI / 2;
    (rv.userData.wheels as THREE.Mesh[]).forEach((w) => (w.rotation.y += dt * 2));
    (dsh.userData.head as THREE.Group).rotation.y = t * 0.15;
    const dx = -3 + ((t * 0.12) % 7), dz = -3.5 + Math.sin(t * 0.05) * 1.5;
    if (Math.random() < (d === "high" ? 0.6 : 0.15)) { const a = Math.random() * 6.28, r = Math.random() * 0.15; dust.emit(dx + Math.cos(a) * r, H(dx, dz) + Math.random() * 0.6, dz + Math.sin(a) * r, Math.cos(a + 1.6) * 0.25 + 0.1, 0.12, Math.sin(a + 1.6) * 0.25, 3 + Math.random() * 2); }
    dust.step(dt);
  });
  return finish("mars", g, hab, ups, {
    sun: { dir: new THREE.Vector3(-0.5, 0.62, 0.55).normalize(), color: 0xffe2c4, intensity: 3.0, ambient: 0.45, sky: 0xc9a07e },
    camera: { pos: new THREE.Vector3(6.8, 5.2, 7.6), target: new THREE.Vector3(0.3, 0.4, 0.6) }, anchor: new THREE.Vector3(0.4, base.h, 1.3),
  }, [tile.dispose], [dust]);
}

// =================================================================== ISS: low Earth orbit
let issCache: Promise<THREE.Object3D> | null = null;
export function loadISS(): Promise<THREE.Object3D> {
  issCache ??= new Promise((resolve, reject) => {
    const draco = new DRACOLoader().setDecoderPath("/assets/draco/");
    new GLTFLoader().setDRACOLoader(draco).load("/assets/models/iss.glb", (gltf) => {
      const m = gltf.scene;
      const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const s = 1 / Math.max(size.x, size.y, size.z);
      m.position.sub(c).multiplyScalar(s); m.scale.setScalar(s);
      const metal = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.42, metalness: 0.55 });
      const array = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.3, metalness: 0.75, side: THREE.DoubleSide, emissive: 0x120a02 });
      m.traverse((o) => {
        const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
        mesh.geometry.computeBoundingBox(); const b = mesh.geometry.boundingBox!.getSize(new THREE.Vector3()); const dims = [b.x, b.y, b.z].sort((a, z) => a - z);
        if (/^(bendedtru|pCylinder)/.test(mesh.name)) { mesh.visible = false; return; }
        mesh.material = dims[0] < dims[2] * 0.05 && dims[1] > dims[2] * 0.12 ? array : metal;
        mesh.castShadow = true;
      });
      const holder = new THREE.Group(); holder.add(m); holder.rotation.set(0, 0, Math.PI / 2); resolve(holder);
    }, undefined, reject);
  });
  return issCache.then((o) => o.clone(true));
}

export function dragon(d: Detail) {
  const M = mats(); const g = new THREE.Group(); const S = d === "high" ? 32 : 10;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.16, S), M.plain); cap.position.y = 0.08; g.add(cap);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, S, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.plain); nose.position.y = 0.16; g.add(nose);
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, S), M.black); g.add(shield);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.17, S), M.plain); trunk.position.y = -0.095; g.add(trunk);
  const sol = new THREE.Mesh(new THREE.CylinderGeometry(0.122, 0.122, 0.12, S, 1, true, 0, Math.PI), M.solar); sol.position.y = -0.095; g.add(sol);
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.005), M.blueGlow); win.position.set(0, 0.1, 0.09); g.add(win);
  return g;
}

function iss(d: Detail, _bare = false): WorldScene {
  const tile = buildTile("iss", d);
  const g = tile.group; const ups: Updater[] = [];
  const station = new THREE.Group(); station.position.set(0, 2.4, 0); g.add(station);
  const scale = d === "high" ? 6.2 : 6.2;
  const hab = new THREE.Object3D(); station.add(hab);
  loadISS().then((m) => { m.scale.setScalar(scale); station.add(m); }).catch(() => {
    // fallback: simple truss + modules
    const M = mats(); const t = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.08, 0.08), M.metal); station.add(t);
    const mod = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 16), M.white); mod.rotation.x = Math.PI / 2; station.add(mod);
  });
  // EVA astronaut moving along the truss, tethered
  const eva = astronaut(d, 0.09); station.add(eva.group);
  const dr = dragon(d); dr.scale.setScalar(1.3); station.add(dr);
  ups.push((dt, t) => {
    station.rotation.y = Math.sin(t * 0.03) * 0.08; station.position.y = 2.4 + Math.sin(t * 0.4) * 0.03;
    const u = (t * 0.04) % 2, x = u < 1 ? -0.9 + u * 1.6 : 0.7 - (u - 1) * 1.6;
    eva.group.position.set(x, 0.16, 0.07); eva.group.rotation.set(0.3, Math.PI / 2 * (u < 1 ? 1 : -1), 0.4);
    eva.animate(t * 1.4, "float");
    const c = (t % 40) / 40, dist = 2.6 * (1 - Math.min(1, c * 1.15));
    dr.position.set(0.05, 0.02, 0.9 + dist); dr.rotation.set(-Math.PI / 2, 0, t * 0.05);
    dr.visible = c < 0.95;
  });
  return finish("iss", g, hab, ups, {
    sun: { dir: new THREE.Vector3(-0.7, 0.6, 0.4).normalize(), color: 0xffffff, intensity: 3.6, ambient: 0.18, sky: null },
    camera: { pos: new THREE.Vector3(6.0, 5.0, 7.4), target: new THREE.Vector3(0, 1.4, 0) },
  }, [tile.dispose]);
}

/** `bare`: no terrain tile and no scattered rocks / trees — the base alone, to sit on a planet globe */
export function buildWorld(id: WorldId, d: Detail, opts: { bare?: boolean } = {}): WorldScene {
  const w = id === "earth" ? earth(d, !!opts.bare) : id === "moon" ? moon(d, !!opts.bare) : id === "mars" ? mars(d, !!opts.bare) : iss(d, !!opts.bare);
  if (opts.bare) w.group.children.forEach((o) => { if (o.userData.tile) o.visible = false; });
  return w;
}

/** surround a diorama with lights (and an optional star field) in its own scene */
export function stageLights(scene: THREE.Scene, w: WorldScene) {
  const objs: THREE.Object3D[] = [];
  const sun = new THREE.DirectionalLight(w.sun.color, w.sun.intensity);
  sun.position.copy(w.sun.dir).multiplyScalar(14); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.left = sc.bottom = -8; sc.right = sc.top = 8; sc.near = 1; sc.far = 40; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  objs.push(sun, new THREE.HemisphereLight(w.sun.sky ?? 0x8899aa, w.id === "mars" ? 0x5a3220 : 0x222222, w.sun.ambient));
  if (w.sun.sky === null) {
    const N = 2500, p = new Float32Array(N * 3), c = new Float32Array(N * 3);
    for (let q = 0; q < N; q++) { const u = Math.random() * 2 - 1, th = Math.random() * 6.283, r = 120, s = Math.sqrt(1 - u * u); p.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], q * 3); const b = 0.3 + Math.random() ** 3 * 0.7; c.set([b, b, b], q * 3); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(p, 3)); sg.setAttribute("color", new THREE.BufferAttribute(c, 3));
    objs.push(new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.35, vertexColors: true, toneMapped: false })));
  }
  objs.forEach((o) => scene.add(o));
  scene.background = new THREE.Color(w.sun.sky === null ? 0x030406 : 0x0b0d10);
  w.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = o.castShadow || false; o.receiveShadow = true; } });
  return () => objs.forEach((o) => scene.remove(o));
}
