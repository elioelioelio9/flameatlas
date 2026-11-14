/**
 * Square "diorama" terrain tiles: a procedural height field on top, geological strata on the four cut faces.
 * Every world (Earth launch site, Moon, Mars, Earth-from-orbit for the ISS) has its own height and colour model.
 */
import * as THREE from "three";
import { craterHeight, fbm2, fbm3, lerp, noise2, ridged2, rng, smoothstep, type Crater } from "./noise";

export type WorldId = "earth" | "moon" | "mars" | "iss";
export type Detail = "high" | "low";

export interface Pad { x: number; z: number; r: number; h: number }
export interface Tile {
  group: THREE.Group;
  size: number;
  heightAt: (x: number, z: number) => number;
  dispose: () => void;
}

interface WorldModel {
  height: (x: number, z: number) => number;
  color: (x: number, z: number, h: number, slope: number, c: THREE.Color) => void;
  strata: (y: number, x: number, z: number, c: THREE.Color) => void;
  depth: number;
  roughness: number;
  sea?: { level: number; color: number; deep: number };
}

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

/** blend a flat platform into the height field */
function withPads(base: (x: number, z: number) => number, pads: Pad[]) {
  return (x: number, z: number) => {
    let h = base(x, z);
    for (const p of pads) {
      const d = Math.hypot(x - p.x, z - p.z);
      const t = 1 - smoothstep(p.r, p.r * 1.45 + 0.25, d);
      h = lerp(h, p.h, t);
    }
    return h;
  };
}

function marsModel(pads: Pad[]): WorldModel {
  const r = rng(11); const craters: Crater[] = [];
  for (let q = 0; q < 14; q++) craters.push({ x: (r() - 0.5) * 10, z: (r() - 0.5) * 10, r: 0.15 + r() ** 2 * 0.9, depth: 0.08 + r() * 0.12 });
  const base = (x: number, z: number) => {
    const big = fbm2(x * 0.12 + 3, z * 0.12 - 1, 4, 3) * 0.55;
    const mesa = smoothstep(0.42, 0.55, ridged2(x * 0.09 + 7, z * 0.09 + 2, 4, 5)) * 0.75;
    const volcano = 1.35 * Math.exp(-((x + 3.2) ** 2 + (z + 3.0) ** 2) / 3.2) - 0.3 * Math.exp(-((x + 3.2) ** 2 + (z + 3.0) ** 2) / 0.12);
    const gully = ridged2(x * 0.6, z * 0.6, 4, 9) * 0.12;
    const dunes = Math.sin(x * 4.2 + z * 1.6 + fbm2(x * 0.5, z * 0.5, 2, 4) * 3) * 0.018 * smoothstep(0.1, -0.2, big);
    return big + mesa + volcano + gully + dunes + craterHeight(craters, x, z) + fbm2(x * 2.5, z * 2.5, 3, 21) * 0.03;
  };
  const dust = C(0.78, 0.47, 0.27), rust = C(0.6, 0.29, 0.15), basalt = C(0.33, 0.17, 0.11), pale = C(0.86, 0.66, 0.48);
  return {
    height: withPads(base, pads), depth: 0.85, roughness: 0.96,
    color: (x, z, h, slope, c) => {
      const n = fbm2(x * 0.7, z * 0.7, 4, 33) * 0.5 + 0.5, m = fbm2(x * 3, z * 3, 3, 44) * 0.5 + 0.5;
      c.copy(rust).lerp(dust, smoothstep(0.25, 0.75, n));
      c.lerp(pale, smoothstep(0.75, 1.3, h) * 0.6 + smoothstep(0.62, 0.9, m) * 0.18);
      c.lerp(basalt, smoothstep(0.35, 0.8, slope) * 0.75);
      c.multiplyScalar(0.9 + m * 0.2);
    },
    strata: (y, x, z, c) => {
      const t = y * 9 + noise2(x * 1.3 + z * 1.3, y * 3, 5) * 0.8;
      const band = Math.sin(t) * 0.5 + 0.5, fine = Math.sin(t * 3.7) * 0.5 + 0.5;
      c.setRGB(0.72, 0.36, 0.22).lerp(C(0.86, 0.55, 0.38), band * 0.55).lerp(C(0.5, 0.22, 0.14), fine * 0.3);
      c.multiplyScalar(0.85 + 0.15 * smoothstep(-0.85, 0, y));
    },
  };
}

function moonModel(pads: Pad[]): WorldModel {
  const r = rng(5); const craters: Crater[] = [];
  for (let q = 0; q < 90; q++) { const s = r() ** 3; craters.push({ x: (r() - 0.5) * 11, z: (r() - 0.5) * 11, r: 0.06 + s * 1.6, depth: 0.05 + s * 0.35 }); }
  craters.push({ x: 3.0, z: -2.6, r: 1.5, depth: 0.55 });
  const base = (x: number, z: number) => fbm2(x * 0.15, z * 0.15, 4, 1) * 0.35 + craterHeight(craters, x, z) + fbm2(x * 3, z * 3, 3, 2) * 0.02;
  const hi = C(0.36, 0.355, 0.345), lo = C(0.24, 0.24, 0.235), mare = C(0.16, 0.16, 0.165);
  return {
    height: withPads(base, pads), depth: 0.8, roughness: 1,
    color: (x, z, h, slope, c) => {
      const n = fbm2(x * 0.3 + 9, z * 0.3, 4, 7) * 0.5 + 0.5, m = fbm2(x * 4, z * 4, 3, 8) * 0.5 + 0.5;
      c.copy(lo).lerp(hi, smoothstep(0.3, 0.75, n)).lerp(mare, smoothstep(0.62, 0.8, 1 - n) * 0.6);
      c.lerp(C(0.46, 0.46, 0.45), smoothstep(0.35, 0.7, slope) * 0.35);
      c.multiplyScalar(0.9 + m * 0.18);
    },
    strata: (y, x, z, c) => {
      const t = y * 7 + noise2(x + z, y * 4, 3) * 0.6; const band = Math.sin(t) * 0.5 + 0.5;
      c.setRGB(0.3, 0.3, 0.29).lerp(C(0.2, 0.2, 0.2), band * 0.6);
      if (y > -0.12) c.lerp(C(0.38, 0.375, 0.37), 0.6);
    },
  };
}

function earthModel(pads: Pad[]): WorldModel {
  // Florida-like launch coast: land to the west (x < ~2), Atlantic to the east
  const coast = (x: number, z: number) => x - (2.2 + fbm2(z * 0.35, 1, 3, 12) * 0.9 + Math.sin(z * 0.4) * 0.3);
  const base = (x: number, z: number) => {
    const d = coast(x, z);
    const land = 0.09 + fbm2(x * 0.4, z * 0.4, 4, 3) * 0.06 + fbm2(x * 3, z * 3, 3, 4) * 0.012;
    const sea = -0.18 - smoothstep(0, 3, d) * 0.4 + fbm2(x, z, 2, 5) * 0.03;
    const beach = 0.025;
    if (d < -0.45) return land;
    if (d < 0) return lerp(beach, land, smoothstep(0, -0.45, d));
    return lerp(beach, sea, smoothstep(0, 0.5, d));
  };
  const sand = C(0.86, 0.79, 0.6), grass = C(0.3, 0.42, 0.18), marsh = C(0.42, 0.45, 0.25), forest = C(0.16, 0.28, 0.12), seabed = C(0.7, 0.66, 0.5);
  return {
    height: withPads(base, pads), depth: 0.8, roughness: 0.9, sea: { level: 0, color: 0x1f6f8b, deep: 0x0b3550 },
    color: (x, z, h, slope, c) => {
      const d = coast(x, z), n = fbm2(x * 0.8, z * 0.8, 4, 21) * 0.5 + 0.5, m = fbm2(x * 5, z * 5, 3, 22) * 0.5 + 0.5;
      if (h < 0.01) { c.copy(seabed).multiplyScalar(0.8 + m * 0.2); return; }
      c.copy(grass).lerp(marsh, smoothstep(0.4, 0.7, n)).lerp(forest, smoothstep(0.62, 0.8, fbm2(x * 1.4 + 4, z * 1.4, 3, 9) * 0.5 + 0.5));
      c.lerp(sand, smoothstep(-0.55, -0.1, d));
      c.multiplyScalar(0.85 + m * 0.3);
    },
    strata: (y, x, z, c) => {
      const t = y * 10 + noise2(x + z, y * 5, 7) * 0.7; const band = Math.sin(t) * 0.5 + 0.5;
      if (y > -0.06) c.setRGB(0.3, 0.22, 0.14);
      else c.setRGB(0.66, 0.56, 0.4).lerp(C(0.5, 0.42, 0.32), band * 0.7).lerp(C(0.74, 0.7, 0.62), smoothstep(-0.4, -0.8, y) * 0.5);
    },
  };
}

function orbitModel(): WorldModel {
  // a square of Earth seen from orbit: curved ocean, continents, cloud decks
  const base = (x: number, z: number) => -(x * x + z * z) * 0.012;
  const ocean = C(0.02, 0.07, 0.2), shallow = C(0.04, 0.2, 0.32), land = C(0.2, 0.26, 0.12), desert = C(0.52, 0.42, 0.27), cloud = C(0.85, 0.87, 0.9);
  return {
    height: base, depth: 0.6, roughness: 0.9,
    color: (x, z, _h, _s, c) => {
      const cont = fbm2(x * 0.18 + 5, z * 0.18, 5, 41);
      c.copy(ocean).lerp(shallow, smoothstep(-0.05, 0.05, cont) * 0.6);
      if (cont > 0.06) c.copy(land).lerp(desert, smoothstep(0, 0.4, fbm2(x * 0.5, z * 0.5, 3, 42)));
      const cl = fbm2(x * 0.35 + Math.sin(z * 0.3) * 1.5, z * 0.35, 6, 43);
      c.lerp(cloud, smoothstep(0.12, 0.42, cl) * 0.92);
    },
    strata: (y, x, z, c) => {
      const t = -y / 0.6; const n = fbm3(x, y * 4, z, 2, 3) * 0.08;
      c.setRGB(0.42, 0.33, 0.25).lerp(C(0.62, 0.22, 0.08), smoothstep(0.35, 0.9, t + n)).lerp(C(1, 0.55, 0.1), smoothstep(0.85, 1, t + n) * 0.7);
    },
  };
}

let normalTex: THREE.Texture | null = null;
/** tiling micro-relief normal map (pebbles and grains), shared by every tile */
function detailNormal(): THREE.Texture {
  if (normalTex) return normalTex;
  const N = 256, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d")!;
  const img = g.createImageData(N, N); const H = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    // periodic by sampling on a torus
    const a = (x / N) * Math.PI * 2, b = (y / N) * Math.PI * 2;
    H[y * N + x] = fbm3(Math.cos(a) * 3, Math.sin(a) * 3 + Math.cos(b) * 3, Math.sin(b) * 3, 5, 77);
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hx = H[y * N + ((x + 1) % N)] - H[y * N + ((x + N - 1) % N)], hy = H[((y + 1) % N) * N + x] - H[((y + N - 1) % N) * N + x];
    const nx = -hx * 6, ny = -hy * 6, l = Math.hypot(nx, ny, 1);
    const o = (y * N + x) * 4; img.data[o] = (nx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  normalTex = new THREE.CanvasTexture(c); normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping; normalTex.anisotropy = 8;
  return normalTex;
}

export function buildTile(world: WorldId, detail: Detail, pads: Pad[] = []): Tile {
  const model = world === "mars" ? marsModel(pads) : world === "moon" ? moonModel(pads) : world === "earth" ? earthModel(pads) : orbitModel();
  const S = 10, half = S / 2, res = detail === "high" ? 220 : 72;
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];

  // ---------------------------------------------------------- top surface
  const n1 = res + 1, pos = new Float32Array(n1 * n1 * 3), col = new Float32Array(n1 * n1 * 3), uv = new Float32Array(n1 * n1 * 2);
  const H = new Float32Array(n1 * n1);
  for (let j = 0; j <= res; j++) for (let i = 0; i <= res; i++) {
    const x = -half + (i / res) * S, z = -half + (j / res) * S; H[j * n1 + i] = model.height(x, z);
  }
  const cc = new THREE.Color(), step = S / res;
  for (let j = 0; j <= res; j++) for (let i = 0; i <= res; i++) {
    const q = j * n1 + i, x = -half + i * step, z = -half + j * step, h = H[q];
    const hx = H[j * n1 + Math.min(res, i + 1)] - H[j * n1 + Math.max(0, i - 1)], hz = H[Math.min(res, j + 1) * n1 + i] - H[Math.max(0, j - 1) * n1 + i];
    const slope = Math.hypot(hx, hz) / (2 * step);
    model.color(x, z, h, slope, cc); cc.convertSRGBToLinear();
    pos.set([x, h, z], q * 3); col.set([cc.r, cc.g, cc.b], q * 3); uv.set([i / res, j / res], q * 2);
  }
  const idx: number[] = [];
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) { const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); topGeo.setAttribute("color", new THREE.BufferAttribute(col, 3)); topGeo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  topGeo.setIndex(idx); topGeo.computeVertexNormals(); disposables.push(topGeo);
  const nt = detailNormal();
  const topMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: model.roughness, metalness: 0, normalMap: detail === "high" ? nt : null, normalScale: new THREE.Vector2(0.55, 0.55) });
  if (topMat.normalMap) { const t = nt.clone(); t.needsUpdate = true; t.repeat.set(14, 14); topMat.normalMap = t; disposables.push(t); }
  disposables.push(topMat);
  const top = new THREE.Mesh(topGeo, topMat); top.userData.tile = true; top.receiveShadow = true; top.castShadow = detail === "high"; top.name = "terrain";
  group.add(top);

  // ---------------------------------------------------------- cut faces with strata
  const rows = detail === "high" ? 36 : 12, y0 = -model.depth;
  const sidePos: number[] = [], sideCol: number[] = [], sideIdx: number[] = [];
  const edges: [number, number, number, number][] = [ // start i,j and step di,dj along the edge (outward-facing order)
    [0, 0, 1, 0], [res, 0, 0, 1], [res, res, -1, 0], [0, res, 0, -1],
  ];
  for (const [i0, j0, di, dj] of edges) {
    const base = sidePos.length / 3;
    for (let s = 0; s <= res; s++) {
      const i = i0 + di * s, j = j0 + dj * s, x = -half + i * step, z = -half + j * step, ht = H[j * n1 + i];
      for (let r = 0; r <= rows; r++) {
        const t = r / rows, y = lerp(ht, y0, t);
        model.strata(y, x, z, cc);
        if (r === 0) cc.multiplyScalar(0.92);
        cc.convertSRGBToLinear();
        sidePos.push(x, y, z); sideCol.push(cc.r, cc.g, cc.b);
      }
    }
    for (let s = 0; s < res; s++) for (let r = 0; r < rows; r++) {
      const a = base + s * (rows + 1) + r, b = a + 1, c = a + rows + 1, d = c + 1;
      sideIdx.push(a, b, c, b, d, c);
    }
  }
  const sideGeo = new THREE.BufferGeometry();
  sideGeo.setAttribute("position", new THREE.Float32BufferAttribute(sidePos, 3)); sideGeo.setAttribute("color", new THREE.Float32BufferAttribute(sideCol, 3));
  sideGeo.setIndex(sideIdx); sideGeo.computeVertexNormals(); disposables.push(sideGeo);
  const sideMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }); disposables.push(sideMat);
  const sides = new THREE.Mesh(sideGeo, sideMat); sides.userData.tile = true; sides.receiveShadow = true; group.add(sides);
  const bottomGeo = new THREE.PlaneGeometry(S, S); bottomGeo.rotateX(Math.PI / 2); bottomGeo.translate(0, y0, 0); disposables.push(bottomGeo);
  const bottom = new THREE.Mesh(bottomGeo, sideMat); bottom.userData.tile = true; group.add(bottom);

  // ---------------------------------------------------------- water (Earth): translucent box clipped to the tile
  if (model.sea) {
    const wg = new THREE.BoxGeometry(S - 0.004, -y0 * 0.9, S - 0.004); wg.translate(0, model.sea.level - (-y0 * 0.9) / 2, 0); disposables.push(wg);
    const wm = new THREE.MeshPhysicalMaterial({ color: model.sea.color, roughness: 0.08, metalness: 0, transmission: 0, transparent: true, opacity: 0.72, clearcoat: 1, clearcoatRoughness: 0.1, depthWrite: false });
    disposables.push(wm);
    const water = new THREE.Mesh(wg, wm); water.renderOrder = 1; water.name = "water"; water.userData.tile = true; group.add(water);
    // waves: subtle normal map on the surface only
    if (detail === "high") { const t = nt.clone(); t.needsUpdate = true; t.repeat.set(6, 6); wm.normalMap = t; wm.normalScale.set(0.25, 0.25); disposables.push(t); group.userData.water = t; }
  }

  // ---------------------------------------------------------- orbit tile: atmosphere glow layer
  if (world === "iss") {
    const ag = new THREE.BoxGeometry(S, 1.1, S); ag.translate(0, -0.12, 0); disposables.push(ag);
    const am = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
      fragmentShader: "varying vec3 vP; void main(){ float g = -0.012*dot(vP.xz, vP.xz); if (vP.y < g) discard; float t = clamp((vP.y - g)/0.42, 0., 1.); float a = pow(1.-t, 1.6)*0.6; gl_FragColor = vec4(vec3(0.25,0.5,1.0)*a, a); }",
    });
    disposables.push(am); const atm = new THREE.Mesh(ag, am); atm.userData.tile = true; group.add(atm);
  }

  const heightAt = (x: number, z: number) => model.height(x, z);
  return { group, size: S, heightAt, dispose: () => disposables.forEach((d) => d.dispose()) };
}
