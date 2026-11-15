/**
 * 3-D interiors built from the same grid as the solver, so what you see is exactly what the flow sees.
 *  - domain walls: inward-facing planes (front-face culling turns them into a cut-away from outside)
 *  - furniture, partitions, decks, closed hatches: exposed faces of the solver's solid cells (voxel surface)
 *  - decor that the solver does not resolve (handrails, lights, cables, hatch frames) is kept thin and labelled as such
 *  - backdrops are authentic NASA photographs (Apollo 17, Curiosity, ISS Earth limb, JSC mockup facility)
 */
import * as THREE from "three";
import type { Furniture, Habitat } from "../../sim/habitats";
import type { CabinFire } from "../../sim/firesim";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  return [c, c.getContext("2d")!] as const;
}
const rnd = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
function tex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

/** paint helpers produce a colour map plus a matching height map (used as bump map) */
function rackPair(kind: "iss" | "node"): [THREE.Texture, THREE.Texture] {
  const R = 256, H = 512;
  const [c, g] = canvas(R * 4, H); const [cb, gb] = canvas(R * 4, H);
  const r = rnd(kind === "iss" ? 7 : 19);
  const both = (fn: (g: CanvasRenderingContext2D, colour: boolean) => void) => { fn(g, true); fn(gb, false); };
  for (let k = 0; k < 4; k++) {
    const x0 = k * R;
    both((q, col) => { q.fillStyle = col ? (kind === "iss" ? "#b8b4a8" : "#b0ab9d") : "#808080"; q.fillRect(x0, 0, R, H); q.strokeStyle = col ? "#7f7a6e" : "#303030"; q.lineWidth = 6; q.strokeRect(x0 + 3, 3, R - 6, H - 6); });
    let y = 20;
    while (y < H - 30) {
      const hh = Math.min(48 + Math.floor(r() * 4) * 26, H - 24 - y);
      const type = r();
      if (kind === "iss") {
        both((q, col) => {
          q.fillStyle = col ? (type < 0.55 ? "#c7c3b6" : type < 0.8 ? "#a5a092" : "#36383b") : (type < 0.8 ? "#a0a0a0" : "#5a5a5a");
          q.fillRect(x0 + 18, y, R - 36, hh - 6);
          q.strokeStyle = col ? "#7b766a" : "#202020"; q.lineWidth = 2; q.strokeRect(x0 + 18, y, R - 36, hh - 6);
          if (type >= 0.8) { q.fillStyle = col ? "#16181a" : "#404040"; q.fillRect(x0 + 30, y + 8, 64, Math.min(30, hh - 22)); for (let n = 0; n < 5; n++) { q.fillStyle = col ? "#6b7076" : "#c0c0c0"; q.beginPath(); q.arc(x0 + 120 + n * 22, y + 20, 6, 0, 7); q.fill(); } }
          else { q.fillStyle = col ? "#6f6b60" : "#d0d0d0"; q.fillRect(x0 + 32, y + hh / 2 - 8, 14, 10); q.fillRect(x0 + R - 46, y + hh / 2 - 8, 14, 10); if (col) { q.fillStyle = "#4e4c46"; q.fillRect(x0 + R / 2 - 30, y + 10, 60, 5); } }
        });
      } else {
        let x = x0 + 16;
        while (x < x0 + R - 28) {
          const w = Math.min(70 + Math.floor(r() * 3) * 30, x0 + R - 16 - x); const light = r() < 0.75;
          both((q, col) => {
            q.fillStyle = col ? (light ? "#dcd7c9" : "#8f99a1") : "#b8b8b8"; q.beginPath(); q.roundRect(x + 2, y + 2, w - 4, hh - 4, 8); q.fill();
            q.strokeStyle = col ? "#9b9586" : "#606060"; q.lineWidth = 2; q.stroke();
            if (col) { q.fillStyle = "rgba(60,60,60,.22)"; q.fillRect(x + w / 2 - 3, y + 2, 6, hh - 4); q.fillStyle = "#4b4d50"; q.fillRect(x + 8, y + 8, 20, 5); }
          });
          x += w;
        }
      }
      y += hh;
    }
  }
  return [tex(c), tex(cb, false)];
}

function panelPair(tone: string, seed: number): [THREE.Texture, THREE.Texture] {
  // soft-goods / padded wall panels of a surface habitat
  const [c, g] = canvas(512, 512); const [cb, gb] = canvas(512, 512); const r = rnd(seed);
  g.fillStyle = tone; g.fillRect(0, 0, 512, 512); gb.fillStyle = "#808080"; gb.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 128) for (let x = 0; x < 512; x += 128) {
    const inset = 6;
    g.fillStyle = r() < 0.15 ? "#9da3a6" : tone; g.fillRect(x + inset, y + inset, 128 - 2 * inset, 128 - 2 * inset);
    g.strokeStyle = "rgba(40,40,40,.28)"; g.lineWidth = 3; g.strokeRect(x + inset, y + inset, 128 - 2 * inset, 128 - 2 * inset);
    gb.fillStyle = "#b4b4b4"; gb.fillRect(x + inset + 4, y + inset + 4, 120 - 2 * inset, 120 - 2 * inset);
    if (r() < 0.25) { g.fillStyle = "#3c3e41"; g.fillRect(x + 40, y + 50, 48, 6); }
    if (r() < 0.2) { g.fillStyle = "#2a2c2e"; g.fillRect(x + 30, y + 30, 68, 40); gb.fillStyle = "#5a5a5a"; gb.fillRect(x + 30, y + 30, 68, 40); }
  }
  return [tex(c), tex(cb, false)];
}

function gratingPair(): [THREE.Texture, THREE.Texture] {
  const [c, g] = canvas(256, 256); const [cb, gb] = canvas(256, 256);
  g.fillStyle = "#4a4c4e"; g.fillRect(0, 0, 256, 256); gb.fillStyle = "#909090"; gb.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) { g.fillStyle = "#2b2c2d"; g.fillRect(0, y, 256, 5); gb.fillStyle = "#303030"; gb.fillRect(0, y, 256, 5); }
  for (let x = 0; x < 256; x += 64) { g.fillStyle = "#5c5e60"; g.fillRect(x, 0, 4, 256); }
  return [tex(c), tex(cb, false)];
}

function grilleTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = "#bdb9ad"; g.fillRect(0, 0, 256, 256); g.fillStyle = "#4d4c48"; g.fillRect(16, 16, 224, 224);
  g.fillStyle = "#9c988c"; for (let y = 22; y < 236; y += 9) g.fillRect(20, y, 216, 4);
  return tex(c);
}

export interface HabitatScene {
  group: THREE.Group;
  surfaces: THREE.Mesh[];               // ignitable / probe-able
  rebuildSolids: () => void;            // call after a door changes
  setCutaway: (on: boolean) => void;    // translucent intermediate decks when seen from outside
  dispose: () => void;
}

const FURN_COLOUR: Record<Furniture["kind"], number> = {
  rack: 0xb8b4a8, bench: 0xc9c9c4, bunk: 0x7d8790, deck: 0x55585a, partition: 0xc2bfb6, bulkhead: 0xb3afa3, locker: 0xc8c2b2,
};

export function buildHabitatScene(hab: Habitat, sim: CabinFire): HabitatScene {
  const group = new THREE.Group();
  const surfaces: THREE.Mesh[] = [];
  const { lx, ly, lz, dx } = sim;
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => { disposables.push(x); return x; };

  // ------------------------------------------------ domain walls
  if (hab.walls === "racks" || hab.walls === "panels") {
    const isLabUnused = false; void isLabUnused;
    const [pc, pb] = panelPair("#d5d3cc", 3), [gc, gb] = gratingPair();
    for (const z of hab.zones) {
      const x0 = (z.box[0] - 1) * dx, x1 = z.box[1] * dx, len = x1 - x0;
      const sides: [string, THREE.Euler, THREE.Vector3, number][] = [
        ["floor", new THREE.Euler(-Math.PI / 2, 0, 0), new THREE.Vector3(x0 + len / 2, 0, lz / 2), lz],
        ["ceiling", new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Vector3(x0 + len / 2, ly, lz / 2), lz],
        ["port", new THREE.Euler(0, 0, 0), new THREE.Vector3(x0 + len / 2, ly / 2, 0), ly],
        ["starboard", new THREE.Euler(0, Math.PI, 0), new THREE.Vector3(x0 + len / 2, ly / 2, lz), ly],
      ];
      for (const [name, rot, pos, w] of sides) {
        let map: THREE.Texture, bump: THREE.Texture, repU = 1, repV = 1;
        if (name === "floor") { [map, bump] = [gc, gb]; repU = len / 1.2; repV = w / 1.2; }
        else { [map, bump] = [pc, pb]; repU = len / 2.4; repV = w / 2.4; }
        const m = map.clone(); m.needsUpdate = true; m.repeat.set(repU, repV);
        const b = bump.clone(); b.needsUpdate = true; b.repeat.set(repU, repV);
        const mat = keep(name === "floor" ? new THREE.MeshStandardMaterial({ map: m, bumpMap: b, bumpScale: 1.6, roughness: 0.78, metalness: 0.05 }) : new THREE.MeshStandardMaterial({ color: name === "ceiling" ? 0xe6e4de : 0xd3d1ca, roughness: 0.9 }));
        const mesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(len, w)), mat);
        mesh.rotation.copy(rot); mesh.position.copy(pos);
        if (name === "starboard") { const uv = mesh.geometry.attributes.uv as THREE.BufferAttribute; for (let q = 0; q < uv.count; q++) uv.setX(q, 1 - uv.getX(q)); }
        mesh.userData = { surface: name, zone: z.id };
        group.add(mesh); surfaces.push(mesh);
      }
    }
    // end walls (grilles where vents are; plain panels otherwise)
    const gt = grilleTexture();
    for (const [x, rotY] of [[0, Math.PI / 2], [lx, -Math.PI / 2]] as const) {
      const mesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(lz, ly)), keep(new THREE.MeshStandardMaterial({ map: hab.walls === "racks" ? gt : pc, roughness: 0.8 })));
      mesh.rotation.y = rotY; mesh.position.set(x, ly / 2, lz / 2); mesh.userData = { surface: x === 0 ? "fwd" : "aft" }; (mesh.material as THREE.MeshStandardMaterial).map = null; (mesh.material as THREE.MeshStandardMaterial).color.set(0xcfcdc6);
      group.add(mesh); surfaces.push(mesh);
    }
  } else {
    // cylindrical shell (Mars): inner surface only, floors and ceiling
    const cyl = hab.cylinder!; const R = cyl.r * dx, Rt = (cyl.rTop ?? cyl.r) * dx, cx = (cyl.cx - 0.5) * dx, cz = (cyl.cz - 0.5) * dx;
    const [pc, pb] = panelPair("#d9d4c8", 11), [gc, gb] = gratingPair();
    const m = pc.clone(); m.needsUpdate = true; m.repeat.set((2 * Math.PI * R) / 2.4, ly / 2.4);
    const b = pb.clone(); b.needsUpdate = true; b.repeat.copy(m.repeat);
    const shellGeo = cyl.dome ? new THREE.SphereGeometry(R, 72, 24, 0, Math.PI * 2, Math.acos(Math.min(1, ly / R)), Math.PI / 2 - Math.acos(Math.min(1, ly / R))).translate(0, -ly / 2, 0) : new THREE.CylinderGeometry(Rt, R, ly, 72, 1, true);
    const shell = new THREE.Mesh(keep(shellGeo), keep(new THREE.MeshStandardMaterial({ color: 0xd6d4cd, roughness: 0.9, side: THREE.BackSide })));
    shell.position.set(cx, ly / 2, cz); shell.userData = { surface: "shell" }; group.add(shell); surfaces.push(shell);
    for (const [y, up] of [[0, true], [ly, false]] as const) {
      const fm = (up ? gc : pc).clone(); fm.needsUpdate = true; fm.repeat.set((2 * R) / 1.2, (2 * R) / 1.2);
      const disk = new THREE.Mesh(keep(new THREE.CircleGeometry(up ? R : cyl.dome ? Math.sqrt(Math.max(0, R * R - ly * ly)) : Rt, 72)), keep(up ? new THREE.MeshStandardMaterial({ map: fm, roughness: 0.85 }) : new THREE.MeshStandardMaterial({ color: 0xe6e4de, roughness: 0.9 })));
      disk.rotation.x = up ? -Math.PI / 2 : Math.PI / 2; disk.position.set(cx, y, cz); disk.userData = { surface: up ? "floor" : "ceiling" };
      group.add(disk); surfaces.push(disk);
    }
  }

  // ------------------------------------------------ solids (voxel surface), rebuilt when doors change
  const solidGroup = new THREE.Group(); group.add(solidGroup);
  const furnMats = new Map<string, THREE.MeshStandardMaterial>();
  const [dc, db] = gratingPair(); const [rc2, rb2] = [dc, db];
  const matFor = (kind: Furniture["kind"]) => {
    if (!furnMats.has(kind)) {
      const opts: THREE.MeshStandardMaterialParameters = { color: FURN_COLOUR[kind], roughness: kind === "bench" ? 0.45 : 0.75, metalness: kind === "bulkhead" ? 0.25 : 0.06, side: THREE.DoubleSide };
      if (kind === "deck") { const t = dc.clone(); t.needsUpdate = true; t.repeat.set(1 / 1.2, 1 / 1.2); opts.map = t; opts.color = 0xffffff; }
      if (false as boolean) { const t = rc2.clone(); t.needsUpdate = true; t.repeat.set(1 / 4.2, 1 / 2.1); opts.map = t; opts.color = 0xffffff; const bb = rb2.clone(); bb.needsUpdate = true; bb.repeat.copy(t.repeat); opts.bumpMap = bb; opts.bumpScale = 1.2; }
      furnMats.set(kind, keep(new THREE.MeshStandardMaterial(opts)));
    }
    return furnMats.get(kind)!;
  };
  const kindOfCell = (i: number, j: number, k: number): Furniture["kind"] | null => {
    for (const f of hab.solids) { const b = f.box; if (i >= b[0] && i <= b[1] && j >= b[2] && j <= b[3] && k >= b[4] && k <= b[5]) return f.kind; }
    for (const d of hab.doors) { const b = d.box; if (i >= b[0] && i <= b[1] && j >= b[2] && j <= b[3] && k >= b[4] && k <= b[5]) return "bulkhead"; }
    return null;
  };
  const rebuildSolids = () => {
    solidGroup.children.forEach((o) => (o as THREE.Mesh).geometry.dispose());
    solidGroup.clear();
    for (let s = surfaces.length - 1; s >= 0; s--) if (surfaces[s].userData.solid) surfaces.splice(s, 1);
    const byKind = new Map<string, { pos: number[]; nor: number[]; uv: number[] }>();
    const { nx, ny, nz } = sim;
    const dirs: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
      if (!sim.solid[sim.IX(i - 1, j - 1, k - 1)]) continue;
      const kind = kindOfCell(i, j, k); if (!kind || (kind === "deck" && hab.cylinder)) continue; // smooth shell / deck drawn below
      for (const [ddx, ddy, ddz] of dirs) {
        const ni = i + ddx, nj = j + ddy, nk = k + ddz;
        if (ni < 1 || nj < 1 || nk < 1 || ni > nx || nj > ny || nk > nz) continue;
        if (sim.solid[sim.IX(ni - 1, nj - 1, nk - 1)]) continue;
        const e = byKind.get(kind) ?? { pos: [], nor: [], uv: [] }; byKind.set(kind, e);
        const cx = (i - 0.5) * dx, cy = (j - 0.5) * dx, cz = (k - 0.5) * dx, h = dx / 2;
        const c = [cx + ddx * h, cy + ddy * h, cz + ddz * h];
        const axis = ddx ? 0 : ddy ? 1 : 2;
        const tu = axis === 0 ? 2 : 0, tv = axis === 1 ? 2 : 1;
        const corner = (su: number, sv: number) => { const p = [...c]; p[tu] += su * h; p[tv] += sv * h; return p; };
        const quad = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
        const n = [ddx, ddy, ddz];
        const sign = (axis === 2 ? 1 : -1) * (ddx + ddy + ddz); // winding so the face normal matches n
        const order = sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
        for (const o of order) { e.pos.push(...quad[o]); e.nor.push(...n); e.uv.push(quad[o][tu], quad[o][tv]); }
      }
    }
    for (const [kind, e] of byKind) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(e.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(e.nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(e.uv, 2));
      const mesh = new THREE.Mesh(g, matFor(kind as Furniture["kind"]));
      mesh.userData = { surface: kind, solid: true };
      solidGroup.add(mesh); surfaces.push(mesh);
    }
    // round intermediate decks (cylindrical habitats): smooth disks with the hatch cut out when open
    if (hab.cylinder) for (const f of hab.solids.filter((q) => q.kind === "deck")) {
      const cyl = hab.cylinder; const R = cyl.r * dx, cx = (cyl.cx - 0.5) * dx, cz = (cyl.cz - 0.5) * dx;
      const shape = new THREE.Shape(); shape.absarc(0, 0, R, 0, Math.PI * 2, false);
      for (const d of hab.doors) {
        const b = d.box; if (!sim.doorOpen[d.id] || b[2] !== f.box[2]) continue;
        const x0 = (b[0] - 1) * dx - cx, x1 = b[1] * dx - cx, z0 = (b[4] - 1) * dx - cz, z1 = b[5] * dx - cz;
        const hole = new THREE.Path(); hole.moveTo(x0, -z0); hole.lineTo(x1, -z0); hole.lineTo(x1, -z1); hole.lineTo(x0, -z1); hole.lineTo(x0, -z0); shape.holes.push(hole);
      }
      const geo = new THREE.ExtrudeGeometry(shape, { depth: dx, bevelEnabled: false, curveSegments: 48 });
      geo.rotateX(-Math.PI / 2); geo.translate(cx, (f.box[2] - 1) * dx, cz);
      const mesh = new THREE.Mesh(geo, deckMat); mesh.userData = { surface: "deck", solid: true };
      solidGroup.add(mesh); surfaces.push(mesh);
    }
  };
  const deckTex = gratingPair()[0]; deckTex.repeat.set(1 / 1.2, 1 / 1.2);
  const deckMat = keep(new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.8, metalness: 0.2, transparent: true, opacity: 1, side: THREE.DoubleSide }));
  rebuildSolids();

  // ------------------------------------------------ decor not resolved by the solver
  const railMat = keep(new THREE.MeshStandardMaterial({ color: 0xb4a77c, roughness: 0.4, metalness: 0.6 }));
  const lightMat = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 0.4 }));
  const cableMat = keep(new THREE.MeshStandardMaterial({ color: 0x2c2e31, roughness: 0.6 }));
  if (hab.walls === "racks") {
    const rails: THREE.Matrix4[] = [];
    for (const z of hab.zones) {
      const x0 = (z.box[0] - 1) * dx, x1 = z.box[1] * dx;
      for (let x = x0 + 0.6; x < x1 - 0.4; x += 1.3) {
        for (const zz of [0.05, lz - 0.05]) for (const y of [0.42, ly - 0.42]) rails.push(new THREE.Matrix4().makeTranslation(x, y, zz));
        for (const y of [0.05, ly - 0.05]) rails.push(new THREE.Matrix4().makeTranslation(x + 0.6, y, 0.45));
      }
      for (let x = x0 + 0.9; x < x1 - 0.6; x += 2.1) for (const zz of [0.08, lz - 0.08]) {
        const fx = new THREE.Mesh(keep(new THREE.BoxGeometry(0.9, 0.05, 0.12)), lightMat); fx.position.set(x, ly - 0.06, zz); group.add(fx);
      }
    }
    void rails; void railMat;
    // hatch frames on bulkhead doors
    const frameMat = keep(new THREE.MeshStandardMaterial({ color: 0x8d8a82, roughness: 0.45, metalness: 0.55 }));
    for (const d of hab.doors) {
      const b = d.box; const x = (b[0] - 0.5) * dx;
      const y0 = (b[2] - 1) * dx, y1 = b[3] * dx, z0 = (b[4] - 1) * dx, z1 = b[5] * dx, e = 0.08;
      for (const [w, h, y, z] of [[z1 - z0 + 2 * e, e, y0 - e / 2, (z0 + z1) / 2], [z1 - z0 + 2 * e, e, y1 + e / 2, (z0 + z1) / 2], [e, y1 - y0, (y0 + y1) / 2, z0 - e / 2], [e, y1 - y0, (y0 + y1) / 2, z1 + e / 2]] as const) {
        const m = new THREE.Mesh(keep(new THREE.BoxGeometry(dx + 0.12, h, w)), frameMat); m.position.set(x, y, z); group.add(m);
      }
    }
    for (let q = 0; q < 0; q++) {
      const pts: THREE.Vector3[] = []; for (let x = 3.2; x <= 11.1; x += 0.9) pts.push(new THREE.Vector3(x, 0.06 + q * 0.035 + Math.sin(x * 2 + q) * 0.01, 0.07 + q * 0.03));
      group.add(new THREE.Mesh(keep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.014, 6)), cableMat));
    }
  } else {
    // surface habitats: recessed ceiling light panels per zone, handrail along walls
    for (const z of hab.zones) {
      const x0 = (z.box[0] - 1) * dx, x1 = z.box[1] * dx, ytop = z.box[3] * dx;
      const xs = hab.cylinder ? [(hab.cylinder.cx - 0.5) * dx - 0.9, (hab.cylinder.cx - 0.5) * dx + 0.9] : [x0 + (x1 - x0) * 0.3, x0 + (x1 - x0) * 0.7];
      for (const x of xs) {
        const fx = new THREE.Mesh(keep(new THREE.BoxGeometry(0.9, 0.03, 0.5)), lightMat);
        fx.position.set(x, ytop - 0.02, hab.cylinder ? (hab.cylinder.cz - 0.5) * dx + 0.6 : lz / 2); group.add(fx);
      }
    }
  }

  // ------------------------------------------------ vents (visible grilles on the domain faces)
  const ventMat = keep(new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
  for (const v of hab.vents) {
    const a0 = (v.a[0] - 1) * dx, a1 = v.a[1] * dx, b0 = (v.b[0] - 1) * dx, b1 = v.b[1] * dx;
    const g = keep(new THREE.PlaneGeometry(a1 - a0, b1 - b0));
    const m = new THREE.Mesh(g, ventMat);
    const e = 0.004;
    if (v.face === "x0" || v.face === "x1") { m.rotation.y = v.face === "x0" ? Math.PI / 2 : -Math.PI / 2; m.position.set(v.face === "x0" ? e : lx - e, (a0 + a1) / 2, (b0 + b1) / 2); m.scale.set((b1 - b0) / (a1 - a0), (a1 - a0) / (b1 - b0), 1); }
    else if (v.face === "y0" || v.face === "y1") { m.rotation.x = v.face === "y0" ? -Math.PI / 2 : Math.PI / 2; m.position.set((a0 + a1) / 2, v.face === "y0" ? e : ly - e, (b0 + b1) / 2); }
    else { m.rotation.y = v.face === "z0" ? 0 : Math.PI; m.position.set((a0 + a1) / 2, (b0 + b1) / 2, v.face === "z0" ? e : lz - e); }
    m.userData = { vent: v.id };
    group.add(m);
  }

  const setCutaway = (on: boolean) => { deckMat.opacity = on ? 0.28 : 1; deckMat.depthWrite = !on; };
  return { group, surfaces, rebuildSolids, setCutaway, dispose: () => disposables.forEach((d) => d.dispose()) };
}

/** authentic NASA photograph used as the environment around the habitat */
export function buildBackdrop(hab: Habitat, scene: THREE.Scene, sim: CabinFire): () => void {
  const loader = new THREE.TextureLoader();
  const objs: THREE.Object3D[] = [];
  const cx = sim.lx / 2, cz = sim.lz / 2;
  const loadTex = (url: string) => { const t = loader.load(url); t.colorSpace = THREE.SRGBColorSpace; return t; };
  if (hab.backdrop === "moon" || hab.backdrop === "mars") {
    const isMoon = hab.backdrop === "moon";
    const t = loadTex(isMoon ? "/assets/photos/nasa_jsc2004e20304.jpg" : "/assets/photos/pano_mars.webp");
    t.wrapS = THREE.RepeatWrapping;
    const R = 70, H = isMoon ? (2 * Math.PI * R * 485) / 4096 : (2 * Math.PI * R * 810) / 2916;
    const pano = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 96, 1, true), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, transparent: !isMoon, depthWrite: false, toneMapped: false }));
    pano.position.set(cx, isMoon ? H * 0.32 : H * 0.18, cz);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(R, 96), new THREE.MeshStandardMaterial({ color: isMoon ? 0x575652 : 0x7a4f33, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -0.02, cz);
    scene.background = new THREE.Color(isMoon ? 0x000000 : 0xb59a83);
    if (!isMoon) scene.fog = new THREE.Fog(0xb59a83, 30, 120);
    objs.push(pano, ground);
  } else if (hab.backdrop === "earth") {
    scene.background = new THREE.Color(0x0e1116);
  } else {
    const t = loadTex("/assets/photos/nasa_iss040e080833.jpg");
    scene.background = t;
    scene.backgroundIntensity = hab.backdrop === "orbit" ? 0.42 : 0.3;
    scene.backgroundBlurriness = 0;
  }
  objs.forEach((o) => scene.add(o));
  return () => { objs.forEach((o) => scene.remove(o)); scene.fog = null; };
}

/** small, physical ignition source: an avionics box with an overheating cable bundle */
export function buildIgnitionSource(): THREE.Group {
  // a flat electric igniter strip at the edge of the fuel panel: no cables, no detail
  const g = new THREE.Group();
  const hot = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.6, emissive: 0xff5a1a, emissiveIntensity: 0 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.3), hot); bar.position.set(0.39, 0.01, 0); g.add(bar);
  g.userData.hot = hot;
  return g;
}
