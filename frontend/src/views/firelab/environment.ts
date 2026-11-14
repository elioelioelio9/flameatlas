/**
 * The world around the simulated cabin. Instead of a flat photograph, the inside view reuses the same animated
 * diorama as the outside view (terrain, other modules, crew, rovers, dust, the ISS model with its visiting vehicle),
 * scaled to metres so that the habitat module sits exactly around the solver's grid. The hull of the module and any
 * part of the diorama that overlaps the grid are cut open on the camera side by a clipping plane, so the exterior
 * stays visible while you look inside.
 */
import * as THREE from "three";
import { buildWorld, type WorldScene } from "../../scenes/worlds";
import type { WorldId } from "../../scenes/tiles";
import type { Habitat } from "../../sim/habitats";
import type { CabinFire } from "../../sim/firesim";

export interface Environment {
  update: (dt: number, t: number, camera: THREE.Camera) => void;
  setViewportHeight: (px: number) => void;
  /** metres per unit of the exterior model: overview distances scale with it */
  k: number;
  /** world position (metres, grid frame) of a room of this base */
  roomPos: (room: string, out: THREE.Vector3) => THREE.Vector3;
  dispose: () => void;
}

const worldOf = (hab: Habitat): WorldId => hab.world;
/** metres per tile unit: Moon 10 m module = 1.7 units, Mars 6 m habitat = 0.8 units, Earth 5 m capsule = 0.18 units, ISS 109 m = 6.2 units */
const SCALE: Record<WorldId, number> = { moon: 9.92 / 1.7, mars: (15.1 * 0.2 * 1.03) / 0.4, earth: (16.1 * 0.16) / 0.09, iss: 109 / 6.2 };

function stars(radius: number, n = 4000) {
  const p = new Float32Array(n * 3), c = new Float32Array(n * 3);
  for (let q = 0; q < n; q++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    p.set([radius * s * Math.cos(th), radius * u, radius * s * Math.sin(th)], q * 3);
    const b = 0.25 + Math.random() ** 3 * 0.75; c.set([b, b, b], q * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3)); g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, toneMapped: false, depthWrite: false }));
  pts.frustumCulled = false; return pts;
}

/** vertical gradient sky dome (Earth blue, Mars butterscotch), fades into fog at the horizon */
function skyDome(radius: number, top: number, horizon: number) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, toneMapped: false,
    uniforms: { cTop: { value: new THREE.Color(top) }, cHor: { value: new THREE.Color(horizon) } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    fragmentShader: "uniform vec3 cTop; uniform vec3 cHor; varying vec3 vP; void main(){ float t = smoothstep(-0.05, 0.6, vP.y); gl_FragColor = vec4(mix(cHor, cTop, t), 1.); }",
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), m); s.frustumCulled = false; return s;
}

/** textured planet with a thin blue rim (Earth seen from the ISS or from the Moon) */
function planet(url: string, r: number, rim: number | null) {
  const g = new THREE.Group();
  const t = new THREE.TextureLoader().load(url); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const body = new THREE.Mesh(new THREE.SphereGeometry(r, 128, 64), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0, envMapIntensity: 0 }));
  g.add(body);
  if (rim !== null) {
    const am = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { c: { value: new THREE.Color(rim) } },
      vertexShader: "varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }",
      fragmentShader: "uniform vec3 c; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1. - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(c*f*1.6, f); }",
    });
    g.add(new THREE.Mesh(new THREE.SphereGeometry(r * 1.025, 96, 48), am));
  }
  return { group: g, body };
}

export function buildEnvironment(hab: Habitat, scene: THREE.Scene, sim: CabinFire, renderer: THREE.WebGLRenderer): Environment {
  renderer.localClippingEnabled = true;
  const id = worldOf(hab);
  const { lx, ly, lz, dx } = sim;
  const objs: THREE.Object3D[] = [];
  const add = (o: THREE.Object3D) => { scene.add(o); objs.push(o); return o; };

  const w: WorldScene = buildWorld(id, "high");
  const root = new THREE.Group(); root.add(w.group); add(root);
  w.group.updateMatrixWorld(true);

  // ---------------------------------------------------- fit the diorama to the grid (metres)
  // one scale per base, so every room of a base is drawn at the same size; the grid of the active room sits at the origin
  const k = SCALE[id]; const target = new THREE.Vector3(); const pin = new THREE.Vector3();
  const habObj = hab.room === "main" ? w.habitat : w.rooms[hab.room] ?? w.habitat;
  const Y = new THREE.Vector3(0, 1, 0);
  if (hab.fit === "module") {
    // horizontal cylinder lying along its own x axis: turn the whole base so that axis is the grid's x, widen the hull to wrap the grid
    const rTile = new THREE.Box3().setFromObject(habObj).getSize(new THREE.Vector3()).y / 2;
    root.rotation.y = -habObj.rotation.y;
    const rk = Math.hypot(ly / 2, lz / 2) * 1.04;
    habObj.scale.set(1, rk / (rTile * k), rk / (rTile * k));
    target.set(lx / 2, ly / 2 - rk, lz / 2);
  } else if (hab.fit === "dome") {
    habObj.children.forEach((c) => { if ((c as THREE.Mesh).geometry?.type === "BoxGeometry") c.visible = false; }); // plant rows are solver cells here
    target.set(lx / 2, -0.03, lz / 2);
  } else if (hab.fit === "box") {
    target.set(lx / 2, ly / 2, lz / 2);
  } else if (id === "moon") {
    const rk = Math.hypot(ly / 2, lz / 2) * 1.04;
    habObj.scale.set(1, rk / (0.27 * k), rk / (0.27 * k));
    target.set(lx / 2, ly / 2 - rk, lz / 2);
  } else if (id === "mars") {
    const cyl = hab.cylinder!;
    const sy = ly / (0.66 * k); habObj.scale.set(1, sy, 1);
    target.set(cyl.cx * dx, -0.06 * k * sy, cyl.cz * dx);
  } else if (id === "earth") {
    // crew capsule at the top of the launch vehicle: the grid replaces the capsule, the escape tower stays above it
    const cyl = hab.cylinder!;
    const rocket = habObj.parent!;
    rocket.children.forEach((c) => { if (c.position.y > 2.84 && c.position.y < 3.12) c.visible = false; });
    target.set(cyl.cx * dx, 0, cyl.cz * dx);
  } else {
    w.group.children.forEach((o) => { if (o.userData.tile) o.visible = false; });
    target.set(lx / 2, ly / 2, lz / 2);
  }
  if (id === "iss") w.group.children.forEach((o) => { if (o.userData.tile) o.visible = false; });
  root.updateMatrixWorld(true);
  if (hab.fit === "main" && id === "earth") habObj.parent!.localToWorld(pin.set(0, 2.83, 0)); else habObj.getWorldPosition(pin);
  root.scale.setScalar(k);
  root.position.copy(target).addScaledVector(pin, -k);
  w.setScale(k);
  root.updateMatrixWorld(true);

  // ---------------------------------------------------- sky, light, far scenery
  const sunDir = w.sun.dir.clone().applyAxisAngle(Y, root.rotation.y);
  const sun = new THREE.DirectionalLight(w.sun.color, w.sun.intensity * 0.7); sun.position.copy(sunDir).multiplyScalar(100); add(sun); add(sun.target);
  add(new THREE.HemisphereLight(w.sun.sky ?? 0x8899aa, id === "mars" ? 0x5a3220 : 0x222222, w.sun.ambient * 0.8));
  let earthBody: THREE.Mesh | null = null;
  if (id === "moon" || id === "iss") {
    scene.background = new THREE.Color(0x020304);
    add(stars(3500));
    if (id === "moon") { const e = planet("/assets/textures/earth.jpg", 60, 0x9ec2ff); e.group.position.set(-900, 700, -2200); e.group.rotation.z = 0.4; add(e.group); earthBody = e.body; }
    else {
      // Earth 400 km below, seen at the scale of the station: a large sphere well under the grid
      const e = planet("/assets/textures/earth.jpg", 2600, 0x8fb8ff); e.group.position.set(lx / 2, -2900, lz / 2 - 400); e.group.rotation.set(0.5, 0, 0.25); add(e.group); earthBody = e.body;
    }
  } else if (id === "mars") {
    scene.background = new THREE.Color(0xc29b7c);
    add(skyDome(3000, 0xb59a83, 0xd8b08a));
    scene.fog = new THREE.Fog(0xcfa785, 10 * k * 0.6, 10 * k * 6);
  } else {
    scene.background = new THREE.Color(0x9cc4e8);
    add(skyDome(4000, 0x5f8fc9, 0xcfe0ef));
    scene.fog = new THREE.Fog(0xc4d8ea, 10 * k * 0.8, 10 * k * 5);
  }

  // ---------------------------------------------------- cut-away: whatever overlaps the grid opens on the camera side
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  const centre = new THREE.Vector3(lx / 2, ly / 2, lz / 2);
  const gridBox = new THREE.Box3(new THREE.Vector3(-0.4, -1.5, -0.4), new THREE.Vector3(lx + 0.4, ly + 0.6, lz + 0.4));
  const clipped = new Set<THREE.Material>(); const box = new THREE.Box3();
  const inTile = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.userData.tile) return true; return false; };
  const scan = () => {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh || m.userData.cutChecked) return; m.userData.cutChecked = true;
      if (inTile(m) || !m.visible) return;
      box.setFromObject(m); if (!box.intersectsBox(gridBox)) return;
      const cut = (mat: THREE.Material) => { const c = mat.clone(); c.clippingPlanes = [plane]; c.side = THREE.DoubleSide; clipped.add(c); return c; };
      m.material = Array.isArray(m.material) ? m.material.map(cut) : cut(m.material);
      m.castShadow = false;
    });
  };
  scan();

  const flat = new THREE.Vector3(); let scanT = 0;
  return {
    k,
    roomPos: (room, out) => { const o = room === "main" ? w.habitat : w.rooms[room]; return o ? o.getWorldPosition(out) : out.set(lx / 2, ly, lz / 2); },
    setViewportHeight: (px) => w.setViewportHeight(px),
    update: (dt, t, camera) => {
      // keep the launch pad before ignition and the station still: the grid does not move with them
      w.update(dt, id === "earth" ? 1 + (t % 0.9) : t);
      if (id === "iss" && habObj.parent) { habObj.parent.rotation.y = 0; habObj.parent.position.y = 2.4; }
      if (earthBody) earthBody.rotation.y += dt * (id === "iss" ? 0.004 : 0.002);
      scanT += dt; if (scanT > 0.5 && t < 30) { scanT = 0; scan(); } // the ISS model arrives asynchronously
      flat.copy(centre).sub(camera.position); flat.y = 0;
      if (flat.lengthSq() > 1e-6) { flat.normalize(); plane.setFromNormalAndCoplanarPoint(flat, centre.clone().addScaledVector(flat, -0.05)); }
    },
    dispose: () => {
      objs.forEach((o) => scene.remove(o)); scene.fog = null; clipped.forEach((m) => m.dispose()); w.dispose();
    },
  };
}
