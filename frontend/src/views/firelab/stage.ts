/**
 * Neutral analysis stage for a room: flat grey background, a metric floor grid and x / y / z axes from the room
 * origin (0, 0, 0) = the corner of the solver grid. No decoration, nothing that can z-fight with the room.
 */
import * as THREE from "three";

export interface Stage { labels: { text: string; pos: THREE.Vector3; axis?: boolean }[]; dispose: () => void }

export function buildStage(scene: THREE.Scene, lx: number, ly: number, lz: number): Stage {
  scene.background = new THREE.Color(0x4b4a47);
  const objs: THREE.Object3D[] = [];
  const add = <T extends THREE.Object3D>(o: T) => { scene.add(o); objs.push(o); return o; };

  // floor grid, 0.5 m cells, major line every metre, extending 3 m around the room
  const pad = 3, x0 = -pad, x1 = Math.ceil(lx) + pad, z0 = -pad, z1 = Math.ceil(lz) + pad;
  const minor: number[] = [], major: number[] = [];
  for (let x = x0; x <= x1 + 1e-6; x += 0.5) (Math.abs(x - Math.round(x)) < 1e-6 ? major : minor).push(x, -0.004, z0, x, -0.004, z1);
  for (let z = z0; z <= z1 + 1e-6; z += 0.5) (Math.abs(z - Math.round(z)) < 1e-6 ? major : minor).push(x0, -0.004, z, x1, -0.004, z);
  const lines = (pts: number[], opacity: number) => {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xf0f0ed, transparent: true, opacity, depthWrite: false })));
  };
  lines(minor, 0.06); lines(major, 0.16);
  // a matt floor under the grid catches the room's light and shadow
  const floor = add(new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshStandardMaterial({ color: 0x45443f, roughness: 1 })));
  floor.rotation.x = -Math.PI / 2; floor.position.set((x0 + x1) / 2, -0.012, (z0 + z1) / 2);

  // axes from the origin, slightly beyond the room
  const ax = [[0, 0, 0, lx + 0.8, 0, 0], [0, 0, 0, 0, ly + 0.6, 0], [0, 0, 0, 0, 0, lz + 0.8]].flat();
  const ag = new THREE.BufferGeometry(); ag.setAttribute("position", new THREE.Float32BufferAttribute(ax, 3));
  const axes = add(new THREE.LineSegments(ag, new THREE.LineBasicMaterial({ color: 0xf0f0ed, transparent: true, opacity: 0.85, depthTest: false })));
  axes.renderOrder = 9;
  // ticks every metre
  const tk: number[] = [];
  for (let x = 1; x <= lx + 1e-6; x++) tk.push(x, 0, 0, x, 0, -0.12);
  for (let z = 1; z <= lz + 1e-6; z++) tk.push(0, 0, z, -0.12, 0, z);
  for (let y = 1; y <= ly + 1e-6; y++) tk.push(0, y, 0, -0.12, y, 0);
  const tg = new THREE.BufferGeometry(); tg.setAttribute("position", new THREE.Float32BufferAttribute(tk, 3));
  const ticks = add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0xf0f0ed, transparent: true, opacity: 0.7, depthTest: false }))); ticks.renderOrder = 9;

  const labels: Stage["labels"] = [
    { text: "x", pos: new THREE.Vector3(lx + 0.95, 0, 0), axis: true },
    { text: "y", pos: new THREE.Vector3(0, ly + 0.75, 0), axis: true },
    { text: "z", pos: new THREE.Vector3(0, 0, lz + 0.95), axis: true },
  ];
  for (let x = 2; x <= lx + 1e-6; x += 2) labels.push({ text: `${x}`, pos: new THREE.Vector3(x, 0, -0.32) });
  for (let z = 2; z <= lz + 1e-6; z += 2) labels.push({ text: `${z}`, pos: new THREE.Vector3(-0.32, 0, z) });
  labels.push({ text: "0", pos: new THREE.Vector3(-0.25, 0, -0.25) });
  for (let y = 1; y <= ly + 1e-6; y++) labels.push({ text: `${y}`, pos: new THREE.Vector3(-0.3, y, 0) });

  return { labels, dispose: () => objs.forEach((o) => { scene.remove(o); const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material)?.dispose?.(); }) };
}
