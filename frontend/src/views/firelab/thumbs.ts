/** Small rendered previews of the objects in the room library (drawn once, cached as data URLs). */
import * as THREE from "three";

const cache = new Map<string, string>();

function model(id: string): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x6d6e6c, roughness: 0.8 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m = mat) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(b.geometry), new THREE.LineBasicMaterial({ color: 0x1b1c1c })); e.position.copy(b.position); g.add(e);
  };
  if (id === "rack") { box(1.05, 2, 0.8, 0, 1, 0); for (let y = 0.35; y < 1.9; y += 0.35) box(0.95, 0.04, 0.02, 0, y, 0.41, dark); }
  else if (id === "locker") { box(0.6, 1.8, 0.6, 0, 0.9, 0); box(0.02, 1.7, 0.02, 0, 0.9, 0.31, dark); box(0.06, 0.2, 0.02, 0.1, 1.0, 0.31, dark); }
  else if (id === "bench") { box(1.6, 0.06, 0.7, 0, 0.87, 0); for (const x of [-0.72, 0.72]) for (const z of [-0.28, 0.28]) box(0.06, 0.84, 0.06, x, 0.42, z, dark); }
  else if (id === "bunk") { box(2, 0.12, 0.9, 0, 0.3, 0, dark); box(1.9, 0.14, 0.82, 0, 0.43, 0); box(0.08, 0.6, 0.9, -0.96, 0.3, 0, dark); }
  else if (id === "cargo") { box(0.48, 0.45, 0.8, -0.26, 0.23, 0); box(0.48, 0.45, 0.8, 0.26, 0.23, 0); box(0.5, 0.42, 0.78, 0, 0.67, 0); }
  else { box(0.16, 2, 1.6, 0, 1, 0); }
  return g;
}

export function thumb(id: string): string {
  if (cache.has(id)) return cache.get(id)!;
  if (!shared) {
    shared = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); shared.setSize(160, 120); shared.setPixelRatio(2);
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(3, 5, 4); scene.add(sun);
  const m = model(id); scene.add(m);
  const bb = new THREE.Box3().setFromObject(m), c = bb.getCenter(new THREE.Vector3()), r = bb.getSize(new THREE.Vector3()).length() / 2;
  const cam = new THREE.PerspectiveCamera(30, 160 / 120, 0.1, 50);
  cam.position.copy(c).add(new THREE.Vector3(1, 0.75, 1.2).normalize().multiplyScalar(r / Math.sin((15 * Math.PI) / 180))); cam.lookAt(c);
  shared.render(scene, cam);
  const url = shared.domElement.toDataURL("image/png");
  cache.set(id, url);
  scene.traverse((o) => { const mm = o as THREE.Mesh; mm.geometry?.dispose(); });
  return url;
}
let shared: THREE.WebGLRenderer | null = null;
