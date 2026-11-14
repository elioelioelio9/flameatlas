import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ALARM, D_MODEL, MATERIALS, StationFire, type FlameState, type Params, type ZoneStat } from "../sim/fluid3d";
import { HABITATS, habitatById, type Habitat } from "../sim/habitats";
import { evidenceFor } from "../sim/evidence";
import { useApp } from "../state";
import { buildBackdrop, buildHabitatScene, buildIgnitionSource } from "./firelab/station";
import { flameMaterial, sliceMaterial, volumeMaterial } from "./firelab/shaders";
import { cmap, cmapCss, CMAP_ID, type CMap } from "./firelab/colormaps";

// ------------------------------------------------------------------ configuration
const GRAVITY = [
  { id: "orbit", label: "Orbit", g: 0 },
  { id: "moon", label: "Moon", g: 1.62 },
  { id: "mars", label: "Mars", g: 3.71 },
  { id: "earth", label: "Earth", g: 9.81 },
];

export interface FirePreset { id: string; habitat: Habitat["id"]; label: string; g: number; vent: number; o2: number; p: number; material: string; hint: string }
export const PRESETS: FirePreset[] = [
  { id: "iss", habitat: "iss", label: "ISS, ventilation on", g: 0, vent: 15, o2: 21, p: 101.3, material: "pmma", hint: "Today's station: forced airflow feeds the flame and carries smoke downstream." },
  { id: "ventoff", habitat: "iss", label: "ISS, fans off", g: 0, vent: 0, o2: 21, p: 101.3, material: "pmma", hint: "Standard first response: without buoyancy, a flame in still air starves." },
  { id: "explo", habitat: "iss", label: "34 % O₂ exploration cabin", g: 0, vent: 0, o2: 34, p: 56.5, material: "pmma", hint: "Oxygen-rich, low-pressure atmosphere: does starving still work?" },
  { id: "moon", habitat: "moon", label: "Moon base", g: 1.62, vent: 10, o2: 34, p: 56.5, material: "cotton", hint: "Weak buoyancy, oxygen-rich air. No NASA flight data yet." },
  { id: "mars", habitat: "mars", label: "Mars habitat", g: 3.71, vent: 10, o2: 30, p: 70, material: "cotton", hint: "0.38 g, assumed exploration atmosphere. No NASA flight data yet." },
  { id: "earth", habitat: "earth", label: "Earth, 1 g mockup", g: 9.81, vent: 10, o2: 21, p: 101.3, material: "pmma", hint: "Hot gas rises: the fire we know." },
];

type Volume = "smoke" | "heat" | "co2" | "off";
type SliceField = "temperature" | "o2" | "co2" | "smoke" | "speed" | "vorticity" | "peclet" | "pressure" | "off";
type Axis = "x" | "y" | "z";
type Nav = "orbit" | "walk";
type Tool = "ignite" | "probe" | "extinguish";
type Density = "coarse" | "medium" | "fine";
type Seeds = "vents" | "fire" | "plane";

interface FieldDef { label: string; unit: string; cmap: CMap; range: (p: Params) => [number, number]; fmt: (v: number) => string; note: string }
const FIELDS: Record<Exclude<SliceField, "off">, FieldDef> = {
  temperature: { label: "Temperature", unit: "°C", cmap: "inferno", range: () => [20, 320], fmt: (v) => v.toFixed(0), note: "Hot gas rises with gravity, stays at the flame in orbit." },
  o2: { label: "Oxygen", unit: "% vol", cmap: "viridis", range: (p) => [p.o2 * 100 - 5, p.o2 * 100], fmt: (v) => v.toFixed(1), note: "Dark = oxygen consumed by the flame (the starving zone)." },
  co2: { label: "CO₂", unit: "% vol", cmap: "plasma", range: () => [0, 3], fmt: (v) => v.toFixed(2), note: "Combustion product (and extinguisher agent), carried by the flow." },
  smoke: { label: "Smoke", unit: "rel.", cmap: "gray", range: () => [0, 1], fmt: (v) => v.toFixed(2), note: `Detector alarm threshold: ${ALARM}.` },
  speed: { label: "Air speed |u|", unit: "m/s", cmap: "viridis", range: () => [0, 0.35], fmt: (v) => v.toFixed(3), note: "Convection: ventilation jets, hatch jets, buoyant plumes." },
  vorticity: { label: "Vorticity |∇×u|", unit: "1/s", cmap: "plasma", range: () => [0, 2], fmt: (v) => v.toFixed(2), note: "Where the flow rolls up into eddies (turbulent mixing)." },
  peclet: { label: "Cell Péclet number, log₁₀", unit: "", cmap: "diverging", range: () => [-2, 2], fmt: (v) => v.toFixed(1), note: "Blue: diffusion dominates transport. Red: convection dominates." },
  pressure: { label: "Pressure correction p′", unit: "model", cmap: "diverging", range: () => [-0.002, 0.002], fmt: (v) => v.toExponential(0), note: "Dynamic pressure that keeps the flow divergence-free (relative)." },
};

const MAT_COLOR: Record<string, [number, number, number]> = { pmma: [214, 222, 226], cotton: [226, 216, 190], cable: [70, 72, 76], nomex: [205, 190, 120] };

interface Probe { x: number; y: number; z: number; T: number; o2: number; co2: number; smoke: number; speed: number; vel: [number, number, number]; vort: number; pe: number; zone: string }
interface Hud {
  t: number; state: FlameState; hrr: number; minO2: number; cells: number; charred: number; fuel: number;
  det: { id: string; label: string; alarmAt: number | null; reading: number }[]; zones: ZoneStat[]; probe: Probe | null; where: string;
  diag: { ms: number; cfl: number; res: number; vmax: number; ke: number; dp: number; cells: number };
  sources: { id: number; material: string; alive: boolean; burning: number; charred: number; at: number }[];
  range: [number, number] | null; uref: number; discharging: boolean;
}
const EMPTY_HUD: Hud = { t: 0, state: "idle", hrr: 0, minO2: 0.21, cells: 0, charred: 0, fuel: 0, det: [], zones: [], probe: null, where: "", diag: { ms: 0, cfl: 0, res: 0, vmax: 0, ke: 0, dp: 0, cells: 0 }, sources: [], range: null, uref: 0.3, discharging: false };

function download(name: string, text: string, type = "text/csv") {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
}

export default function FireLab() {
  const { openDrawer, go, firePreset, setFirePreset } = useApp();
  const mountRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const hrrRef = useRef<HTMLCanvasElement>(null);
  const profileRef = useRef<HTMLCanvasElement>(null);
  const probeRef = useRef<HTMLCanvasElement>(null);

  const initial = PRESETS.find((p) => p.id === firePreset) ?? PRESETS[0];
  const [habitatId, setHabitatId] = useState<Habitat["id"]>(initial.habitat);
  const [preset, setPreset] = useState(initial.id);
  const [gravity, setGravity] = useState(GRAVITY.find((g) => g.g === initial.g)!.id);
  const [vent, setVent] = useState(initial.vent);
  const [o2, setO2] = useState(initial.o2);
  const [pressure, setPressure] = useState(initial.p);
  const [materialId, setMaterialId] = useState(initial.material);
  const [turb, setTurb] = useState(true);
  const [doors, setDoors] = useState<Record<string, boolean>>({});

  const [volume, setVolume] = useState<Volume>("smoke");
  const [volGain, setVolGain] = useState(1);
  const [slice, setSlice] = useState<SliceField>("temperature");
  const [axis, setAxis] = useState<Axis>(initial.g > 0 ? "x" : "z");
  const [slicePos, setSlicePos] = useState(0.5);
  const [sliceOpacity, setSliceOpacity] = useState(0.85);
  const [autoRange, setAutoRange] = useState(false);
  const [contours, setContours] = useState(true);
  const [vectors, setVectors] = useState(true);
  const [density, setDensity] = useState<Density>("medium");
  const [vecAuto, setVecAuto] = useState(true);
  const [stream, setStream] = useState(false);
  const [seeds, setSeeds] = useState<Seeds>("vents");
  const [tracers, setTracers] = useState(true);
  const [particles, setParticles] = useState(true);
  const [ao, setAo] = useState(true);
  const [nav, setNav] = useState<Nav>("orbit");
  const [tool, setTool] = useState<Tool>("ignite");
  const [speed, setSpeed] = useState(4);
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  const [simRev, setSimRev] = useState(0);

  const hab = habitatById(habitatId);
  const params: Params = useMemo(() => ({
    gravity: GRAVITY.find((g) => g.id === gravity)!.g, ventSpeed: vent / 100, o2: o2 / 100, pressureKpa: pressure,
    material: MATERIALS.find((m) => m.id === materialId)!, confinement: turb ? 0.35 : 0,
  }), [gravity, vent, o2, pressure, materialId, turb]);

  const simRef = useRef<StationFire | null>(null);
  const paramsRef = useRef(params); paramsRef.current = params;
  const live = useRef({ volume, volGain, slice, axis, slicePos, sliceOpacity, autoRange, contours, vectors, density, vecAuto, stream, seeds, tracers, particles, ao, nav, tool, speed, paused });
  live.current = { volume, volGain, slice, axis, slicePos, sliceOpacity, autoRange, contours, vectors, density, vecAuto, stream, seeds, tracers, particles, ao, nav, tool, speed, paused };
  const api = useRef<{ jump: (id: string) => void; ignite: () => void; outside: () => void; door: (id: string, open: boolean) => void; snapshot: () => void; step: () => void; clearProbe: () => void; probeCsv: () => void } | null>(null);

  useEffect(() => { const s = simRef.current; if (!s) return; const o2Changed = Math.abs(s.params.o2 - params.o2) > 1e-6; s.setParams(params); if (o2Changed && s.state === "idle") s.Y.fill(params.o2); }, [params]);

  const applyPreset = (pr: FirePreset) => {
    setPreset(pr.id);
    setGravity(GRAVITY.find((g) => g.g === pr.g)!.id);
    setVent(pr.vent); setO2(pr.o2); setPressure(pr.p); setMaterialId(pr.material);
    setAxis(pr.g > 0 ? "x" : "z"); setSlicePos(0.5);
    if (pr.habitat !== habitatId) setHabitatId(pr.habitat);
    else { const s = simRef.current!; s.setParams({ gravity: pr.g, ventSpeed: pr.vent / 100, o2: pr.o2 / 100, pressureKpa: pr.p, material: MATERIALS.find((m) => m.id === pr.material)! }); s.reset(); }
  };
  useEffect(() => {
    if (!firePreset) return;
    const pr = PRESETS.find((p) => p.id === firePreset); if (pr) applyPreset(pr);
    setFirePreset(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firePreset]);

  // ------------------------------------------------------------------ three.js scene (rebuilt per habitat)
  useEffect(() => {
    const mount = mountRef.current!;
    const sim = new StationFire(hab, paramsRef.current);
    simRef.current = sim;
    setDoors({ ...sim.doorOpen }); setSimRev((r) => r + 1); setHud(EMPTY_HUD);
    const { lx, ly, lz, dx, nx, ny, nz } = sim;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.82;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.22;
    const disposeBackdrop = buildBackdrop(hab, scene, sim);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.03, 400);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.minDistance = 0.6; controls.maxDistance = 60;
    const L = Math.max(lx, lz);
    const outside = () => {
      if (hab.id === "mars") { camera.position.set(lx / 2 - 5.5, ly + 5.5, lz / 2 + 7.5); controls.target.set(lx / 2, ly * 0.4, lz / 2); }
      else { camera.position.set(lx / 2 - L * 0.18, ly + L * 0.3, lz + L * 0.42); controls.target.set(lx / 2 + L * 0.03, ly * 0.3, lz / 2); }
    };
    outside();

    scene.add(new THREE.HemisphereLight(0xf0f0ed, 0x4a4842, 0.45));
    for (const z of hab.zones) {
      const b = z.box; const pl = new THREE.PointLight(0xfff4e6, hab.walls === "racks" ? 0.9 : 1.6, 9, 1.5);
      pl.position.set(((b[0] + b[1]) / 2 - 0.5) * dx, (b[3] - 1) * dx - 0.15, lz / 2); scene.add(pl);
    }
    if (hab.backdrop === "moon" || hab.backdrop === "mars") { const sun = new THREE.DirectionalLight(0xffffff, hab.backdrop === "moon" ? 2.2 : 1.4); sun.position.set(-20, 18, 12); scene.add(sun); }
    const flameLight = new THREE.PointLight(0xff9a40, 0, 5, 1.6); scene.add(flameLight);

    const habScene = buildHabitatScene(hab, sim);
    scene.add(habScene.group);

    // 3-D textures (R = value, G = gas mask)
    const nCell = nx * ny * nz;
    const volData = new Uint8Array(nCell * 2), sliceData = new Uint8Array(nCell * 2);
    const mk3d = (d: Uint8Array) => { const t = new THREE.Data3DTexture(d, nx, ny, nz); t.format = THREE.RGFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true; return t; };
    const volTex = mk3d(volData), sliceTex = mk3d(sliceData);
    const dims = new THREE.Vector3(lx, ly, lz);
    const volMat = volumeMaterial(volTex, dims);
    const volBox = new THREE.Mesh(new THREE.BoxGeometry(lx - 0.02, ly - 0.02, lz - 0.02), volMat);
    volBox.position.set(lx / 2, ly / 2, lz / 2); volBox.renderOrder = 3; scene.add(volBox);
    const slMat = sliceMaterial(sliceTex, dims);
    const slicePlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), slMat); slicePlane.renderOrder = 2; scene.add(slicePlane);
    const sliceEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0xf0f0ed, transparent: true, opacity: 0.35 }));
    scene.add(sliceEdge);

    // velocity glyphs: slender arrow of unit length along +y, scaled in y by |u|
    const shaft = new THREE.CylinderGeometry(0.0045, 0.0045, 0.72, 5); shaft.translate(0, 0.36, 0);
    const head = new THREE.ConeGeometry(0.018, 0.28, 8); head.translate(0, 0.86, 0);
    const MAXA = 4000;
    const arrows = new THREE.InstancedMesh(mergeGeometries([shaft, head])!, new THREE.MeshBasicMaterial({ toneMapped: false }), MAXA);
    arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage); arrows.setColorAt(0, new THREE.Color()); arrows.renderOrder = 4; arrows.frustumCulled = false;
    scene.add(arrows);

    // streamlines
    const MAXS = 40000;
    const stPos = new Float32Array(MAXS * 6), stCol = new Float32Array(MAXS * 6);
    const stGeo = new THREE.BufferGeometry();
    stGeo.setAttribute("position", new THREE.BufferAttribute(stPos, 3)); stGeo.setAttribute("color", new THREE.BufferAttribute(stCol, 3));
    const streamLines = new THREE.LineSegments(stGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, toneMapped: false }));
    streamLines.frustumCulled = false; scene.add(streamLines);
    let streamAt = -1, streamKey = "";

    // air tracers (white) and smoke parcels (grey, Lagrangian) — one Points cloud each
    const mkCloud = (n: number, size: number, color: number, opacity: number) => {
      const pos = new Float32Array(n * 3).fill(-999); const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, color, transparent: true, opacity, depthWrite: false, sizeAttenuation: true })); pts.frustumCulled = false; scene.add(pts);
      return { pos, g, pts, next: 0, n };
    };
    const tr = mkCloud(2500, 0.02, 0xf0f0ed, 0.7);
    const sm = mkCloud(7000, 0.045, 0x5c5d5f, 0.55);
    const smAge = new Float32Array(sm.n);
    const co = mkCloud(2500, 0.06, 0xf4f4f2, 0.45);

    // flames
    const NF = 3000;
    const fPos = new Float32Array(NF * 3).fill(-999), fCol = new Float32Array(NF * 3), fSize = new Float32Array(NF);
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute("position", new THREE.BufferAttribute(fPos, 3)); fGeo.setAttribute("color", new THREE.BufferAttribute(fCol, 3)); fGeo.setAttribute("size", new THREE.BufferAttribute(fSize, 1));
    const flames = new THREE.Points(fGeo, flameMaterial()); flames.renderOrder = 5; flames.frustumCulled = false; scene.add(flames);

    // fuel panels + igniters, one per source
    const panels = new Map<number, { mesh: THREE.Mesh; data: Uint8Array; tex: THREE.DataTexture; igniter: THREE.Group }>();
    const axisVec = (a: number) => new THREE.Vector3(a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0);
    const syncPanels = () => {
      for (const [id, p] of panels) if (!sim.sources.some((s) => s.id === id)) { scene.remove(p.mesh); scene.remove(p.igniter); panels.delete(id); }
      for (const s of sim.sources) {
        if (panels.has(s.id)) continue;
        const data = new Uint8Array(15 * 7 * 4); const tex = new THREE.DataTexture(data, 15, 7, THREE.RGBAFormat); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(15 * dx, 7 * dx), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }));
        const n = new THREE.Vector3(...s.n), eu = axisVec(s.tu), ev = axisVec(s.tv);
        mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(eu, ev, new THREE.Vector3().crossVectors(eu, ev)));
        const surf = new THREE.Vector3(sim.centre(s.i), sim.centre(s.j), sim.centre(s.k)).addScaledVector(n, -dx / 2);
        mesh.position.copy(surf).addScaledVector(n, 0.005);
        const igniter = buildIgnitionSource();
        igniter.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(eu, n, new THREE.Vector3().crossVectors(eu, n)));
        igniter.position.copy(surf).addScaledVector(eu, -0.5);
        scene.add(mesh); scene.add(igniter);
        panels.set(s.id, { mesh, data, tex, igniter });
      }
    };

    // detectors
    const detMeshes = sim.detectors.map((d) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 20), new THREE.MeshStandardMaterial({ color: 0x62676a, emissive: 0x000000 }));
      m.position.set(sim.centre(d.i), d.kind === "duct" ? sim.centre(d.j) : d.j * dx - 0.02, sim.centre(d.k));
      scene.add(m); return m;
    });

    // probe
    const probeMark = new THREE.Group();
    probeMark.add(new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 12), new THREE.MeshBasicMaterial({ color: 0xf0f0ed, toneMapped: false })));
    probeMark.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([-1, 1].flatMap((s) => [new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.15, 0, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, s * 0.15, 0), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, s * 0.15)])), new THREE.LineBasicMaterial({ color: 0xf0f0ed })));
    probeMark.visible = false; scene.add(probeMark);
    let probe: THREE.Vector3 | null = null;
    const probeHist: { t: number; T: number; o2: number; co2: number; smoke: number; speed: number }[] = [];

    // post-processing
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const gtao = new GTAOPass(scene, camera, 512, 512);
    gtao.blendIntensity = 0.85;
    composer.addPass(gtao);
    const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.35, 0.25, 0.985);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // ---------------- walk mode (free flight with collisions against the solver's solids)
    const keys = new Set<string>();
    let yaw = -Math.PI / 2, pitch = 0;
    const walkPos = new THREE.Vector3();
    const blocked = (p: THREE.Vector3) => {
      const r = 0.16;
      for (const o of [[0, 0, 0], [r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]]) if (sim.isSolidAt(p.x + o[0], p.y + o[1], p.z + o[2])) return true;
      return false;
    };
    const moveWalk = (d: THREE.Vector3) => {
      for (const a of ["x", "y", "z"] as const) { const n = walkPos.clone(); n[a] += d[a]; if (!blocked(n)) walkPos.copy(n); }
    };
    const startWalk = () => {
      const ig = hab.ignition; walkPos.set(sim.centre(Math.max(2, ig.i - 14)), Math.min(ly - 0.3, hab.gravity > 0 ? 1.6 : ly / 2), lz / 2);
      if (hab.id === "mars") walkPos.set(sim.centre(8), 1.6, sim.centre(18));
      for (let q = 0; q < 40 && blocked(walkPos); q++) walkPos.x += dx;
      yaw = -Math.PI / 2; pitch = -0.12;
    };
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (live.current.nav !== "walk") return;
      const tag = (e.target as HTMLElement)?.tagName; if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift"].includes(k)) { if (down) keys.add(k); else keys.delete(k); if (k.startsWith("arrow") || k === " ") e.preventDefault(); }
    };
    const kd = (e: KeyboardEvent) => onKey(e, true), ku = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);

    // ---------------- pointer: drag vs click
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down: { x: number; y: number } | null = null, lastP = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; lastP = { x: e.clientX, y: e.clientY }; };
    const onMove = (e: PointerEvent) => {
      if (!down || live.current.nav !== "walk") return;
      yaw -= (e.clientX - lastP.x) * 0.0042; pitch = Math.max(-1.35, Math.min(1.35, pitch - (e.clientY - lastP.y) * 0.0042));
      lastP = { x: e.clientX, y: e.clientY };
    };
    const surfaceHit = (targets: THREE.Object3D[]) => {
      const hit = ray.intersectObjects(targets, false)[0]; if (!hit) return null;
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      // back-face hits of double-sided meshes: make the normal face the camera
      if (n.dot(ray.ray.direction) > 0) n.negate();
      return { hit, n };
    };
    const onUp = (e: PointerEvent) => {
      const d0 = down; down = null;
      if (!d0 || Math.hypot(e.clientX - d0.x, e.clientY - d0.y) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const tool = live.current.tool;
      if (tool === "ignite") {
        const sh = surfaceHit(habScene.surfaces); if (!sh) return;
        const a = [Math.abs(sh.n.x), Math.abs(sh.n.y), Math.abs(sh.n.z)]; const ax = a.indexOf(Math.max(...a));
        const n: [number, number, number] = [0, 0, 0]; n[ax] = Math.sign([sh.n.x, sh.n.y, sh.n.z][ax]) || 1;
        const p = sh.hit.point.clone().addScaledVector(new THREE.Vector3(...n), dx * 0.5);
        const [i, j, k] = sim.cellOf(p.x, p.y, p.z);
        sim.ignite(i, j, k, n, paramsRef.current.material);
      } else {
        const targets: THREE.Object3D[] = slicePlane.visible && tool === "probe" ? [slicePlane, ...habScene.surfaces] : habScene.surfaces;
        const sh = surfaceHit(targets); if (!sh) return;
        const p = sh.hit.point.clone();
        if (sh.hit.object !== slicePlane) p.addScaledVector(sh.n, tool === "extinguish" ? 0.35 : 0.12);
        p.set(Math.max(0.05, Math.min(lx - 0.05, p.x)), Math.max(0.05, Math.min(ly - 0.05, p.y)), Math.max(0.05, Math.min(lz - 0.05, p.z)));
        if (tool === "probe") { probe = p; probeMark.position.copy(p); probeMark.visible = true; probeHist.length = 0; }
        else {
          // aim at the nearest burning cell, else straight off the wall
          let best: THREE.Vector3 | null = null, bd = 1e9;
          for (const c of sim.fire) { const f = sim.fuel.find((q) => q.c === c); if (!f) continue; const q = new THREE.Vector3(sim.centre(f.i), sim.centre(f.j), sim.centre(f.k)); const dd = q.distanceTo(p); if (dd < bd) { bd = dd; best = q; } }
          const dir = best && bd < 3 ? best.clone().sub(p).normalize() : sh.n.clone();
          const target = best && bd < 3 ? p.clone().lerp(best, 0.7) : p;
          sim.discharge(target.x, target.y, target.z, [dir.x, dir.y, dir.z], 8);
        }
      }
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);

    let navWas: Nav = "orbit";
    const setNavMode = (n: Nav) => { controls.enabled = n === "orbit"; habScene.setCutaway(n === "orbit"); if (n === "walk") startWalk(); else outside(); };
    habScene.setCutaway(true);
    let wantShot = false;
    api.current = {
      jump: (id) => {
        const z = hab.zones.find((q) => q.id === id)!; const b = z.box;
        const cx = ((b[0] + b[1]) / 2 - 0.5) * dx, cy = ((b[2] + b[3]) / 2 - 0.5) * dx;
        if (live.current.nav === "walk") { walkPos.set(hab.id === "mars" ? sim.centre(8) : (b[0] - 0.5) * dx + 0.6, hab.id === "mars" ? cy + 0.4 : Math.min(cy + 0.4, ly - 0.3), hab.id === "mars" ? sim.centre(18) : lz / 2); for (let q = 0; q < 40 && blocked(walkPos); q++) walkPos.x += dx; yaw = -Math.PI / 2; pitch = -0.1; }
        else { camera.position.set(cx - 1.8, (b[3]) * dx + 3.2, lz + 3.6); controls.target.set(cx, cy, lz / 2); }
      },
      ignite: () => { const ig = hab.ignition; sim.ignite(ig.i, ig.j, ig.k, ig.n, paramsRef.current.material); },
      outside,
      door: (id, open) => { sim.setDoor(id, open); habScene.rebuildSolids(); setDoors({ ...sim.doorOpen }); },
      snapshot: () => { wantShot = true; },
      step: () => { sim.step(0.06); },
      clearProbe: () => { probe = null; probeMark.visible = false; probeHist.length = 0; },
      probeCsv: () => download(`fire_lab_probe_${hab.id}.csv`, ["t_s,T_C,O2_pct,CO2_pct,smoke,speed_m_s", ...probeHist.map((h) => [h.t.toFixed(2), h.T.toFixed(2), h.o2.toFixed(3), h.co2.toFixed(4), h.smoke.toFixed(5), h.speed.toFixed(4)].join(","))].join("\n")),
    };

    const resize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h, false); composer.setSize(w, h); gtao.setSize(w, h);
      renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
      camera.aspect = w / h; camera.updateProjectionMatrix();
      (flames.material as THREE.ShaderMaterial).uniforms.uScale.value = h * 0.9 * renderer.getPixelRatio();
    };
    const ro = new ResizeObserver(resize); ro.observe(mount); resize();

    // ---------------- field upload
    let curRange: [number, number] | null = null;
    const fieldValue = (f: Exclude<SliceField, "off">, c: number, P: Params) => {
      switch (f) {
        case "temperature": return 20 + sim.T[c];
        case "o2": return sim.Y[c] * 100;
        case "co2": return sim.C[c] * 100;
        case "smoke": return sim.S[c];
        case "speed": return Math.hypot(sim.u[c], sim.v[c], sim.w[c]);
        case "vorticity": return sim.vort[c];
        case "pressure": return sim.p[c];
        case "peclet": { const D = D_MODEL * Math.sqrt(101.325 / Math.max(10, P.pressureKpa)); return Math.log10(Math.max(1e-4, (Math.hypot(sim.u[c], sim.v[c], sim.w[c]) * dx) / D)); }
      }
    };
    const uploadFields = () => {
      const L_ = live.current, P = sim.params;
      if (L_.volume !== "off") {
        let q = 0;
        for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++, q += 2) {
          const c = sim.IX(i, j, k);
          const v = L_.volume === "smoke" ? Math.sqrt(sim.S[c] / 1.2) : L_.volume === "heat" ? sim.T[c] / 220 : sim.C[c] / 0.03;
          volData[q] = Math.max(0, Math.min(255, v * 255)); volData[q + 1] = sim.solid[c] ? 0 : 255;
        }
        volTex.needsUpdate = true;
      }
      if (L_.slice !== "off") {
        const f = FIELDS[L_.slice];
        if (L_.slice === "vorticity" && P.confinement <= 0) sim.computeVorticity();
        let [lo, hi] = f.range(P);
        if (L_.autoRange) {
          let mn = Infinity, mx = -Infinity;
          for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { const c = sim.IX(i, j, k); if (sim.solid[c]) continue; const v = fieldValue(L_.slice, c, P); if (v < mn) mn = v; if (v > mx) mx = v; }
          if (mx - mn < 1e-9) mx = mn + 1e-9; lo = mn; hi = mx;
        }
        curRange = [lo, hi];
        let q = 0;
        for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++, q += 2) {
          const c = sim.IX(i, j, k);
          sliceData[q] = Math.max(0, Math.min(255, ((fieldValue(L_.slice, c, P) - lo) / (hi - lo)) * 255)); sliceData[q + 1] = sim.solid[c] ? 0 : 255;
        }
        sliceTex.needsUpdate = true;
        slMat.uniforms.uCmap.value = CMAP_ID[f.cmap];
        slMat.uniforms.uAlphaMode.value = L_.slice === "o2" ? 2 : L_.slice === "peclet" || L_.slice === "pressure" ? 0 : 1;
      } else curRange = null;
    };
    const sliceCoord = (a: Axis, s: number) => 0.03 + s * ((a === "x" ? lx : a === "y" ? ly : lz) - 0.06);
    const placeSlice = () => {
      const L_ = live.current;
      slicePlane.visible = sliceEdge.visible = L_.slice !== "off";
      const c = sliceCoord(L_.axis, L_.slicePos);
      if (L_.axis === "x") { slicePlane.scale.set(lz, ly, 1); slicePlane.rotation.set(0, Math.PI / 2, 0); slicePlane.position.set(c, ly / 2, lz / 2); }
      else if (L_.axis === "y") { slicePlane.scale.set(lx, lz, 1); slicePlane.rotation.set(-Math.PI / 2, 0, 0); slicePlane.position.set(lx / 2, c, lz / 2); }
      else { slicePlane.scale.set(lx, ly, 1); slicePlane.rotation.set(0, 0, 0); slicePlane.position.set(lx / 2, ly / 2, c); }
      sliceEdge.position.copy(slicePlane.position); sliceEdge.rotation.copy(slicePlane.rotation); sliceEdge.scale.copy(slicePlane.scale);
      slMat.uniforms.uContours.value = L_.contours ? 1 : 0; slMat.uniforms.uOpacity.value = L_.sliceOpacity;
    };
    const planePoints = (a: Axis, s: number, spacing: number): [number, number, number][] => {
      const c = sliceCoord(a, s); const pts: [number, number, number][] = [];
      const range = (L: number) => { const n = Math.max(2, Math.floor(L / spacing)); return Array.from({ length: n }, (_, q) => ((q + 0.5) / n) * L); };
      if (a === "x") for (const y of range(ly)) for (const z of range(lz)) pts.push([c, y, z]);
      else if (a === "y") for (const x of range(lx)) for (const z of range(lz)) pts.push([x, c, z]);
      else for (const x of range(lx)) for (const y of range(ly)) pts.push([x, y, c]);
      return pts.filter(([x, y, z]) => !sim.isSolidAt(x, y, z));
    };

    const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), upV = new THREE.Vector3(0, 1, 0), dirV = new THREE.Vector3(), scV = new THREE.Vector3(), pV = new THREE.Vector3(), colC = new THREE.Color();
    let uref = 0.3;
    const placeArrows = () => {
      const L_ = live.current;
      if (!L_.vectors) { arrows.count = 0; return; }
      const spacing = dx * (L_.density === "coarse" ? 4 : L_.density === "medium" ? 2.5 : 1.6);
      const pts = planePoints(L_.axis, L_.slicePos, spacing);
      const vel = pts.map(([x, y, z]) => sim.velocity(x, y, z));
      const sp = vel.map((v) => Math.hypot(v[0], v[1], v[2]));
      if (L_.vecAuto) { const sorted = [...sp].sort((a, b) => a - b); uref = Math.max(1e-4, sorted[Math.floor(sorted.length * 0.9)] ?? 0.01); } else uref = 0.3;
      const thick = spacing * 3.2;
      let n = 0;
      for (let q = 0; q < pts.length && n < MAXA; q++) {
        const s = sp[q]; if (s < uref * 0.03) continue;
        const [ux, vy, wz] = vel[q]; dirV.set(ux / s, vy / s, wz / s); qt.setFromUnitVectors(upV, dirV);
        const len = Math.min(1.25, s / uref) * spacing * 0.92;
        pV.set(...pts[q]); scV.set(thick, len, thick); m4.compose(pV, qt, scV); arrows.setMatrixAt(n, m4);
        const [r, g, b] = cmap("viridis", 0.12 + 0.88 * Math.min(1, s / uref)); arrows.setColorAt(n, colC.setRGB(r, g, b)); n++;
      }
      arrows.count = n; arrows.instanceMatrix.needsUpdate = true; if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;
    };

    const traceStreamlines = () => {
      const L_ = live.current;
      const seedsP: THREE.Vector3[] = [];
      if (L_.seeds === "vents") for (const v of hab.vents) if (v.kind === "supply") {
        for (let a = v.a[0]; a <= v.a[1]; a += 2) for (let b = v.b[0]; b <= v.b[1]; b += 2) {
          const off = dx * 0.6;
          const p = v.face === "x0" ? [off, sim.centre(a), sim.centre(b)] : v.face === "x1" ? [lx - off, sim.centre(a), sim.centre(b)] : v.face === "y1" ? [sim.centre(a), ly - off, sim.centre(b)] : v.face === "y0" ? [sim.centre(a), off, sim.centre(b)] : v.face === "z0" ? [sim.centre(a), sim.centre(b), off] : [sim.centre(a), sim.centre(b), lz - off];
          seedsP.push(new THREE.Vector3(...p));
        }
      }
      if (L_.seeds === "fire") for (const s of sim.sources) for (let q = 0; q < 40; q++) seedsP.push(new THREE.Vector3(sim.centre(s.i) + (Math.random() - 0.5) * 2.4, sim.centre(s.j) + (Math.random() - 0.2) * 1.2, sim.centre(s.k) + (Math.random() - 0.5) * 1.2));
      if (L_.seeds === "plane" || !seedsP.length) planePoints(L_.axis, L_.slicePos, dx * 4).forEach((p) => seedsP.push(new THREE.Vector3(...p)));
      let n = 0; const h = dx * 0.4;
      const both = L_.seeds !== "vents";
      for (const s0 of seedsP) for (const dirSign of both ? [1, -1] : [1]) {
        const p = s0.clone();
        for (let st = 0; st < 700 && n < MAXS; st++) {
          const [u1, v1, w1] = sim.velocity(p.x, p.y, p.z); const s1 = Math.hypot(u1, v1, w1); if (s1 < 1e-4) break;
          const mx = p.x + dirSign * (u1 / s1) * h * 0.5, my = p.y + dirSign * (v1 / s1) * h * 0.5, mz = p.z + dirSign * (w1 / s1) * h * 0.5;
          const [u2, v2, w2] = sim.velocity(mx, my, mz); const s2 = Math.hypot(u2, v2, w2); if (s2 < 1e-4) break;
          const qx = p.x + dirSign * (u2 / s2) * h, qy = p.y + dirSign * (v2 / s2) * h, qz = p.z + dirSign * (w2 / s2) * h;
          if (sim.isSolidAt(qx, qy, qz)) break;
          const [r, g, b] = cmap("viridis", 0.12 + 0.88 * Math.min(1, s2 / Math.max(uref, 1e-4)));
          stPos.set([p.x, p.y, p.z, qx, qy, qz], n * 6); stCol.set([r, g, b, r, g, b], n * 6);
          p.set(qx, qy, qz); n++;
        }
      }
      stGeo.setDrawRange(0, n * 2); stGeo.attributes.position.needsUpdate = true; stGeo.attributes.color.needsUpdate = true;
    };

    const advectCloud = (cl: ReturnType<typeof mkCloud>, dt: number, D: number, kill: (o: number) => boolean) => {
      const sd = Math.sqrt(2 * D * Math.max(dt, 1e-6));
      for (let q = 0; q < cl.n; q++) {
        const o = q * 3; if (cl.pos[o] < -900) continue;
        const [u1, v1, w1] = sim.velocity(cl.pos[o], cl.pos[o + 1], cl.pos[o + 2]);
        const [u2, v2, w2] = sim.velocity(cl.pos[o] + u1 * dt * 0.5, cl.pos[o + 1] + v1 * dt * 0.5, cl.pos[o + 2] + w1 * dt * 0.5);
        const nx_ = cl.pos[o] + u2 * dt + (Math.random() - 0.5) * sd, ny_ = cl.pos[o + 1] + v2 * dt + (Math.random() - 0.5) * sd, nz_ = cl.pos[o + 2] + w2 * dt + (Math.random() - 0.5) * sd;
        if (!sim.isSolidAt(nx_, ny_, nz_)) { cl.pos[o] = nx_; cl.pos[o + 1] = ny_; cl.pos[o + 2] = nz_; }
        if (kill(o)) cl.pos[o] = -999;
      }
      cl.g.attributes.position.needsUpdate = true;
    };
    const emit = (cl: ReturnType<typeof mkCloud>, x: number, y: number, z: number) => { const o = (cl.next++ % cl.n) * 3; cl.pos[o] = x; cl.pos[o + 1] = y; cl.pos[o + 2] = z; return o / 3; };

    // ---------------- loop
    let raf = 0, last = performance.now(), acc = 0, hudT = 0;
    const DT = 0.06;
    const v3 = new THREE.Vector3();
    const cBlue = new THREE.Color(0.18, 0.36, 1.0), cOrange = new THREE.Color(1.0, 0.45, 0.12), cYellow = new THREE.Color(1.0, 0.78, 0.4);
    const outOfDomain = (p: Float32Array, o: number) => p[o] < 0.01 || p[o] > lx - 0.01 || p[o + 1] < 0.01 || p[o + 1] > ly - 0.01 || p[o + 2] < 0.01 || p[o + 2] > lz - 0.01;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dtw = Math.min(0.05, (now - last) / 1000); last = now;
      const L_ = live.current;
      if (L_.nav !== navWas) { setNavMode(L_.nav); navWas = L_.nav; }
      let simDt = 0;
      if (!L_.paused) { acc += dtw * L_.speed; let n = 0; while (acc >= DT && n < 4) { sim.step(DT); acc -= DT; n++; simDt += DT; } if (n === 4) acc = 0; }
      const P = sim.params;
      gtao.enabled = L_.ao;

      uploadFields();
      volBox.visible = L_.volume !== "off";
      volMat.uniforms.uMode.value = L_.volume === "smoke" ? 0 : L_.volume === "heat" ? 1 : 2; volMat.uniforms.uGain.value = L_.volGain;
      placeSlice(); placeArrows();
      streamLines.visible = L_.stream;
      const key = `${L_.seeds}|${L_.axis}|${L_.slicePos}`;
      if (L_.stream && (streamAt < 0 || sim.time - streamAt > 1.0 || key !== streamKey)) { traceStreamlines(); streamAt = sim.time; streamKey = key; }

      // tracers from supply vents
      tr.pts.visible = L_.tracers;
      if (L_.tracers && simDt > 0 && P.ventSpeed > 0) {
        for (const v of hab.vents) if (v.kind === "supply") {
          const nEmit = Math.round(160 * simDt * (P.ventSpeed / 0.15));
          for (let q = 0; q < nEmit; q++) {
            const a = (v.a[0] - 1 + Math.random() * (v.a[1] - v.a[0] + 1)) * dx, b = (v.b[0] - 1 + Math.random() * (v.b[1] - v.b[0] + 1)) * dx, off = 0.05;
            const p = v.face === "x0" ? [off, a, b] : v.face === "x1" ? [lx - off, a, b] : v.face === "y1" ? [a, ly - off, b] : v.face === "y0" ? [a, off, b] : v.face === "z0" ? [a, b, off] : [a, b, lz - off];
            emit(tr, p[0], p[1], p[2]);
          }
        }
      }
      if (L_.tracers && simDt > 0) advectCloud(tr, simDt, 0, (o) => outOfDomain(tr.pos, o));

      // smoke parcels from burning cells
      sm.pts.visible = L_.particles;
      if (simDt > 0) {
        if (L_.particles) for (const c of sim.fire) {
          const f = sim.fuel.find((q) => q.c === c); if (!f) continue; const so = sim.sources.find((s) => s.id === f.src)!;
          const rate = sim.burn[c] * so.material.smoke * 1400 * simDt; const nE = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
          for (let q = 0; q < nE; q++) { const idx = emit(sm, sim.centre(f.i) + (Math.random() - 0.5) * dx, sim.centre(f.j) + (Math.random() - 0.5) * dx, sim.centre(f.k) + (Math.random() - 0.5) * dx); smAge[idx] = 0; }
        }
        advectCloud(sm, simDt, 2e-3, (o) => { smAge[o / 3] += simDt; return smAge[o / 3] > 400 || outOfDomain(sm.pos, o); });
        // CO2 discharge cloud
        for (const d of sim.discharges) if (sim.time <= d.until) for (let q = 0; q < 50 * simDt * 10; q++) emit(co, sim.centre(d.i) + (Math.random() - 0.5) * 0.3, sim.centre(d.j) + (Math.random() - 0.5) * 0.3, sim.centre(d.k) + (Math.random() - 0.5) * 0.3);
        advectCloud(co, simDt, 4e-3, (o) => outOfDomain(co.pos, o) || Math.random() < simDt * 0.25);
      }

      // panels
      syncPanels();
      for (const s of sim.sources) {
        const pnl = panels.get(s.id)!; const base = MAT_COLOR[s.material.id] ?? [200, 200, 200];
        pnl.data.fill(0);
        for (const f of sim.fuel) {
          if (f.src !== s.id) continue;
          const o = ((f.b + 3) * 15 + (f.a + 7)) * 4;
          let r = base[0], g = base[1], b = base[2];
          if (sim.char.has(f.c)) { r = 24; g = 22; b = 20; } else if (sim.fire.has(f.c)) { const k = Math.min(1, sim.burn[f.c] / 0.05); r = 90 + 165 * k; g = 40 + 70 * k; b = 20; }
          pnl.data[o] = r; pnl.data[o + 1] = g; pnl.data[o + 2] = b; pnl.data[o + 3] = 175;
        }
        pnl.tex.needsUpdate = true;
        (pnl.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = s.alive ? 0.3 : 0;
        (pnl.igniter.userData.hot as THREE.MeshStandardMaterial).emissiveIntensity = s.alive ? Math.max(0.4, 4 * Math.exp(-(sim.time - s.ignitedAt) / 6)) : 0.08;
      }

      // flames
      const gmix = Math.sqrt(Math.min(1, P.gravity / 9.81));
      let f = 0, total = 0; const cen = new THREE.Vector3();
      for (const c of sim.fire) {
        const fc = sim.fuel.find((q) => q.c === c); if (!fc) continue;
        const so = sim.sources.find((s) => s.id === fc.src)!; const n = so.n;
        const b = sim.burn[c]; total += b;
        const x0 = sim.centre(fc.i) - n[0] * dx / 2, y0 = sim.centre(fc.j) - n[1] * dx / 2, z0 = sim.centre(fc.k) - n[2] * dx / 2;
        cen.x += x0 * b; cen.y += y0 * b; cen.z += z0 * b;
        const [ux, vy, wz] = sim.velocity(sim.centre(fc.i), sim.centre(fc.j), sim.centre(fc.k));
        const inten = Math.min(1.4, b / 0.03), warm = Math.min(1, gmix + Math.max(0, P.o2 - 0.21) * 4 + inten * 0.15);
        for (let q = 0; q < 10 && f < NF; q++, f++) {
          const r = Math.random();
          const tu = (Math.random() - 0.5) * dx, tv = (Math.random() - 0.5) * dx;
          const off = 0.015 + r * (0.04 + 0.05 * inten);
          let px = x0 + n[0] * off + (so.tu === 0 ? tu : so.tv === 0 ? tv : 0) + ux * 0.9 * r;
          let py = y0 + n[1] * off + (so.tu === 1 ? tu : so.tv === 1 ? tv : 0) + vy * 0.25 * r + (gmix > 0 ? r * (0.05 + 0.5 * gmix) * (0.4 + inten) * (n[1] === -1 ? 0.15 : 1) : 0);
          let pz = z0 + n[2] * off + (so.tu === 2 ? tu : so.tv === 2 ? tv : 0) + wz * 0.9 * r;
          px = Math.max(0.01, Math.min(lx - 0.01, px)); py = Math.max(0.01, Math.min(ly - 0.01, py)); pz = Math.max(0.01, Math.min(lz - 0.01, pz));
          fPos.set([px, py, pz], f * 3);
          const c0 = cBlue.clone().lerp(cOrange, warm).lerp(cYellow, warm * r * 0.7);
          const k = 1.5 * (0.45 + 0.55 * Math.min(1, inten)) * (reduceMotion ? 0.9 : 0.75 + Math.random() * 0.5);
          fCol.set([c0.r * k, c0.g * k, c0.b * k], f * 3);
          fSize[f] = (0.1 + 0.18 * Math.min(1, inten)) * (1 - 0.45 * r) * (1 + 0.5 * gmix);
        }
      }
      fGeo.setDrawRange(0, f); fGeo.attributes.position.needsUpdate = true; fGeo.attributes.color.needsUpdate = true; fGeo.attributes.size.needsUpdate = true;
      if (total > 0) { flameLight.position.copy(cen.multiplyScalar(1 / total)); flameLight.position.y += 0.2; flameLight.intensity = Math.min(6, total * 6); flameLight.color.copy(cBlue.clone().lerp(cOrange, Math.min(1, gmix + Math.max(0, P.o2 - 0.21) * 4))); } else flameLight.intensity = 0;

      sim.detectors.forEach((d, q) => {
        const m = detMeshes[q].material as THREE.MeshStandardMaterial;
        m.emissive.set(d.alarmAt !== null ? (Math.floor(now / 400) % 2 ? 0xffffff : 0x333333) : 0x000000);
        m.color.set(d.alarmAt !== null ? 0xffffff : d.reading > ALARM * 0.4 ? 0xa7a9aa : 0x62676a);
      });

      if (L_.nav === "walk") {
        const fwd = new THREE.Vector3(Math.cos(pitch) * -Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * -Math.cos(yaw));
        const right = new THREE.Vector3().crossVectors(fwd, upV).normalize(); const spd = 1.6 * dtw; const mv = new THREE.Vector3();
        if (keys.has("w") || keys.has("arrowup")) mv.addScaledVector(fwd, spd);
        if (keys.has("s") || keys.has("arrowdown")) mv.addScaledVector(fwd, -spd);
        if (keys.has("d") || keys.has("arrowright")) mv.addScaledVector(right, spd);
        if (keys.has("a") || keys.has("arrowleft")) mv.addScaledVector(right, -spd);
        if (keys.has("e") || keys.has(" ")) mv.y += spd;
        if (keys.has("q") || keys.has("shift")) mv.y -= spd;
        if (mv.lengthSq() > 0) moveWalk(mv);
        camera.position.copy(walkPos); camera.lookAt(walkPos.clone().add(fwd));
      } else controls.update();

      composer.render();
      if (wantShot) { wantShot = false; const a = document.createElement("a"); a.href = renderer.domElement.toDataURL("image/png"); a.download = `fire_lab_${hab.id}_t${sim.time.toFixed(0)}s.png`; a.click(); }

      const lab = labelsRef.current;
      if (lab) {
        const w = mount.clientWidth, h = mount.clientHeight;
        const place = (el: Element | null, p: THREE.Vector3 | null) => {
          if (!el) return; const e2 = el as HTMLElement;
          if (!p) { e2.style.display = "none"; return; }
          v3.copy(p).project(camera);
          const vis = v3.z < 1 && v3.z > -1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
          e2.style.display = vis ? "block" : "none";
          e2.style.transform = `translate(${((v3.x + 1) / 2) * w}px, ${((1 - v3.y) / 2) * h}px)`;
        };
        sim.detectors.forEach((d, q) => place(lab.querySelector(`[data-det="${d.id}"]`), d.alarmAt !== null ? detMeshes[q].position : null));
        hab.zones.forEach((z) => { const b = z.box; place(lab.querySelector(`[data-mod="${z.id}"]`), L_.nav === "walk" ? null : new THREE.Vector3(((b[0] + b[1]) / 2 - 0.5) * dx, b[3] * dx + 0.25, hab.id === "mars" ? -0.2 : lz / 2)); });
        lab.querySelectorAll("[data-src]").forEach((el) => { const id = Number((el as HTMLElement).dataset.src); const p = panels.get(id); place(el, p ? p.igniter.position.clone().add(new THREE.Vector3(0, 0.18, 0)) : null); });
        place(lab.querySelector("[data-l=probe]"), probe);
      }

      if (now - hudT > 250) {
        hudT = now;
        let pr: Probe | null = null;
        if (probe) {
          const vel = sim.velocity(probe.x, probe.y, probe.z); const sp = Math.hypot(...vel);
          const D = D_MODEL * Math.sqrt(101.325 / Math.max(10, P.pressureKpa));
          if (P.confinement <= 0) sim.computeVorticity();
          const zone = hab.zones.find((z) => { const [i, j, k] = sim.cellOf(probe!.x, probe!.y, probe!.z); const b = z.box; return i >= b[0] && i <= b[1] && j >= b[2] && j <= b[3] && k >= b[4] && k <= b[5]; });
          pr = { x: probe.x, y: probe.y, z: probe.z, T: 20 + sim.at(sim.T, probe.x, probe.y, probe.z), o2: sim.at(sim.Y, probe.x, probe.y, probe.z) * 100, co2: sim.at(sim.C, probe.x, probe.y, probe.z) * 100, smoke: sim.at(sim.S, probe.x, probe.y, probe.z), speed: sp, vel, vort: sim.at(sim.vort, probe.x, probe.y, probe.z), pe: (sp * dx) / D, zone: zone?.name ?? "Opening" };
          if (simDt > 0 || !probeHist.length) { probeHist.push({ t: sim.time, T: pr.T, o2: pr.o2, co2: pr.co2, smoke: pr.smoke, speed: sp }); if (probeHist.length > 1200) probeHist.shift(); }
        }
        let whereZ = "";
        if (L_.nav === "walk") { const [i, j, k] = sim.cellOf(camera.position.x, camera.position.y, camera.position.z); whereZ = hab.zones.find((z) => { const b = z.box; return i >= b[0] && i <= b[1] && j >= b[2] && j <= b[3] && k >= b[4] && k <= b[5]; })?.name ?? "a hatchway"; }
        setHud({
          t: sim.time, state: sim.state, hrr: sim.hrr, minO2: sim.minO2, cells: sim.fire.size, charred: sim.char.size, fuel: sim.fuel.length,
          det: sim.detectors.map((d) => ({ id: d.id, label: d.label, alarmAt: d.alarmAt, reading: d.reading })), zones: sim.zoneStats(), probe: pr, where: whereZ,
          diag: { ms: sim.stepMs, cfl: sim.cfl, res: sim.divResidual, vmax: sim.maxSpeed, ke: sim.kinetic, dp: sim.dp, cells: nCell },
          sources: sim.sources.map((s) => ({ id: s.id, material: s.material.label, alive: s.alive, burning: sim.fuel.filter((f) => f.src === s.id && sim.fire.has(f.c)).length, charred: sim.fuel.filter((f) => f.src === s.id && sim.char.has(f.c)).length, at: s.ignitedAt })),
          range: curRange, uref, discharging: sim.discharges.some((d) => sim.time <= d.until),
        });
        drawHRR(hrrRef.current, sim); drawProfile(profileRef.current, sim); drawProbe(probeRef.current, probeHist);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp);
      disposeBackdrop(); habScene.dispose(); pmrem.dispose();
      controls.dispose(); composer.dispose(); renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habitatId]);

  // ------------------------------------------------------------------ UI
  const sim = simRef.current;
  void simRev;
  const evidence = evidenceFor(params);
  const since = hud.t - (sim?.ignitedAt ?? 0);
  const fired = hud.state !== "idle";
  const toolHint = { ignite: "Click any wall, rack, bench or floor to start a fire (up to 4 sources).", probe: "Click the colour plane or a wall to read local values.", extinguish: "Click near the fire to discharge a CO₂ extinguisher for 8 s." }[tool];
  const status = {
    idle: toolHint,
    burning: `Burning · ${since.toFixed(0)} s · ${hud.sources.filter((s) => s.alive).length} active source${hud.sources.filter((s) => s.alive).length === 1 ? "" : "s"}${hud.discharging ? " · CO₂ discharge" : ""}`,
    extinguished: `Fire out after ${since.toFixed(0)} s (oxygen starvation or extinguisher)`,
    "burnt-out": `Fuel consumed after ${since.toFixed(0)} s`,
  }[hud.state];
  const fd = slice !== "off" ? FIELDS[slice] : null;
  const range = hud.range ?? (fd ? fd.range(params) : [0, 1]);
  const hottest = hud.zones.length ? hud.zones.reduce((a, b) => (b.maxT > a.maxT ? b : a)) : null;
  const leanest = hud.zones.length ? hud.zones.reduce((a, b) => (b.meanO2 < a.meanO2 ? b : a)) : null;
  const smokiest = hud.zones.length ? hud.zones.reduce((a, b) => (b.smoke > a.smoke ? b : a)) : null;
  const pct = (x: number) => `${(x * 100).toFixed(2)} %`;
  const coord = (a: Axis) => (sim ? (a === "x" ? sim.lx : a === "y" ? sim.ly : sim.lz) : 1);

  return (
    <div className="lab">
      <header className="lab-head">
        <div>
          <p className="mono meta">Simulation · {hab.place}</p>
          <h1>{hab.name}</h1>
          <p className="lede">{hab.note}</p>
        </div>
        <div className="lab-pick">
          <nav className="habitats" aria-label="Habitat">
            {HABITATS.map((h) => <button key={h.id} className="tlink" aria-pressed={habitatId === h.id} onClick={() => { const pr = PRESETS.find((p) => p.habitat === h.id)!; applyPreset(pr); }}>{h.short}</button>)}
          </nav>
          <nav className="presets" aria-label="Scenarios">
            {PRESETS.filter((p) => p.habitat === habitatId).map((p) => <button key={p.id} className="tlink" aria-pressed={preset === p.id} onClick={() => applyPreset(p)} title={p.hint}>{p.label}</button>)}
          </nav>
        </div>
      </header>

      <section className="lab-stage" aria-label="3-D simulation">
        <div className={`lab-canvas tool-${tool}`} ref={mountRef} />
        <div className="lab-labels" ref={labelsRef} aria-hidden="true">
          {hab.zones.map((z) => <div key={z.id} className="tag mod" data-mod={z.id}>{z.name}</div>)}
          {hud.det.map((d) => <div key={d.id} className="tag det alarm" data-det={d.id}>Smoke alarm +{d.alarmAt !== null ? (d.alarmAt - (sim?.ignitedAt ?? 0)).toFixed(0) : 0} s</div>)}
          {hud.sources.map((s) => <div key={s.id} className="tag src" data-src={s.id}>Source {s.id + 1} · {s.material}{s.alive ? "" : " · out"}</div>)}
          {hud.probe && <div className="tag probe" data-l="probe">{hud.probe.T.toFixed(0)} °C · {hud.probe.o2.toFixed(1)} % O₂</div>}
        </div>
        <div className="lab-status mono">{status}{hud.where && <span> · you are in {hud.where}</span>}</div>
        {fd && (
          <div className="cmap-legend">
            <div className="cl-title">{fd.label}{fd.unit && <span> ({fd.unit})</span>}{autoRange && <span> · auto range</span>}</div>
            <div className="cl-bar" style={{ background: cmapCss(fd.cmap) }} />
            <div className="cl-ticks mono"><span>{fd.fmt(range[0])}</span><span>{fd.fmt((range[0] + range[1]) / 2)}</span><span>{fd.fmt(range[1])}</span></div>
            {vectors && <div className="cl-vec mono"><i />arrow at one spacing = {(hud.uref * 100).toFixed(hud.uref < 0.01 ? 2 : 1)} cm/s{vecAuto ? " (auto)" : ""}</div>}
            <div className="cl-note">{fd.note}</div>
          </div>
        )}
        {nav === "walk" && <div className="walk-help mono">Drag to look · W A S D to move · E / Q up and down · walls and furniture are solid</div>}
        <div className="stage-bar">
          <div className="seg" role="group" aria-label="Navigation">
            <button aria-pressed={nav === "orbit"} onClick={() => setNav("orbit")}>Outside</button>
            <button aria-pressed={nav === "walk"} onClick={() => setNav("walk")}>Walk inside</button>
          </div>
          <div className="seg" role="group" aria-label="Go to zone">
            {hab.zones.map((z) => <button key={z.id} onClick={() => api.current?.jump(z.id)}>{z.name.split(" (")[0]}</button>)}
          </div>
          <span className="grow" />
          <div className="seg" role="group" aria-label="Click tool">
            <button aria-pressed={tool === "ignite"} onClick={() => setTool("ignite")}>Ignite</button>
            <button aria-pressed={tool === "probe"} onClick={() => setTool("probe")}>Probe</button>
            <button aria-pressed={tool === "extinguish"} onClick={() => setTool("extinguish")}>CO₂ extinguisher</button>
          </div>
          <div className="seg" role="group" aria-label="Speed">
            {[1, 4, 10].map((s) => <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>)}
          </div>
          <button className="tlink" onClick={() => setPaused(!paused)}>{paused ? "Run" : "Pause"}</button>
          {paused && <button className="tlink" onClick={() => api.current?.step()}>Step</button>}
          <button className="tlink" onClick={() => { sim?.reset(); }}>Reset</button>
        </div>
      </section>

      <section className="lab-cols four">
        <div className="col">
          <h2 className="col-h">Atmosphere</h2>
          <div className="row"><span>Gravity</span><div className="seg">{GRAVITY.map((g) => <button key={g.id} aria-pressed={gravity === g.id} onClick={() => setGravity(g.id)}>{g.label}</button>)}</div></div>
          <label className="range"><span>Fans <b className="mono">{vent === 0 ? "off" : `${vent} cm/s`}</b></span><input type="range" min={0} max={40} step={1} value={vent} onChange={(e) => setVent(Number(e.target.value))} /></label>
          <label className="range"><span>Oxygen <b className="mono">{o2} %</b></span><input type="range" min={15} max={40} step={0.5} value={o2} onChange={(e) => setO2(Number(e.target.value))} /></label>
          <label className="range"><span>Cabin pressure <b className="mono">{pressure.toFixed(1)} kPa</b></span><input type="range" min={50} max={105} step={0.5} value={pressure} onChange={(e) => setPressure(Number(e.target.value))} /></label>
          <label className="row check"><input type="checkbox" checked={turb} onChange={(e) => setTurb(e.target.checked)} /><span>Resolve small eddies (vorticity confinement)</span></label>
        </div>

        <div className="col">
          <h2 className="col-h">Fire and response</h2>
          <div className="row"><span>Fuel for new sources</span><select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>{MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
          <ul className="srcs">
            {hud.sources.length === 0 && <li className="faint">No source yet. Use Ignite on the stage, or <button className="tlink inline" onClick={() => api.current?.ignite()}>start the default fire</button>.</li>}
            {hud.sources.map((s) => <li key={s.id}><span>Source {s.id + 1} · {s.material}</span><span className="mono">{s.alive ? `${s.burning} cells burning` : "out"} · {s.charred} charred</span></li>)}
          </ul>
          <div className="mini-h">Hatches and doors</div>
          {hab.doors.map((d) => (
            <label key={d.id} className="row check"><input type="checkbox" checked={doors[d.id] ?? d.openDefault} onChange={(e) => api.current?.door(d.id, e.target.checked)} /><span>{d.label} {doors[d.id] ?? d.openDefault ? "open" : "closed"}</span></label>
          ))}
          <div className="row tight">
            <button className="tlink" onClick={() => setVent(0)}>Shut down fans</button>
            <button className="tlink" onClick={() => setTool("extinguish")}>Use CO₂ extinguisher</button>
          </div>
        </div>

        <div className="col">
          <h2 className="col-h">Display</h2>
          <div className="row"><span>Volume</span><div className="seg">{(["smoke", "heat", "co2", "off"] as Volume[]).map((v) => <button key={v} aria-pressed={volume === v} onClick={() => setVolume(v)}>{v === "co2" ? "CO₂" : v[0].toUpperCase() + v.slice(1)}</button>)}</div></div>
          {volume !== "off" && <label className="range"><span>Volume density <b className="mono">{volGain.toFixed(1)}×</b></span><input type="range" min={0.2} max={3} step={0.1} value={volGain} onChange={(e) => setVolGain(Number(e.target.value))} /></label>}
          <div className="row"><span>Cut plane</span><select value={slice} onChange={(e) => setSlice(e.target.value as SliceField)}>{Object.entries(FIELDS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}<option value="off">Hidden</option></select></div>
          <div className="row"><span>Orientation</span><div className="seg"><button aria-pressed={axis === "z"} onClick={() => setAxis("z")}>Lengthwise</button><button aria-pressed={axis === "y"} onClick={() => setAxis("y")}>Horizontal</button><button aria-pressed={axis === "x"} onClick={() => setAxis("x")}>Cross-section</button></div></div>
          <label className="range"><span>Position <b className="mono">{(0.03 + slicePos * (coord(axis) - 0.06)).toFixed(2)} m</b></span><input type="range" min={0} max={1} step={0.005} value={slicePos} onChange={(e) => setSlicePos(Number(e.target.value))} /></label>
          <label className="range"><span>Plane opacity <b className="mono">{Math.round(sliceOpacity * 100)} %</b></span><input type="range" min={0.1} max={1} step={0.05} value={sliceOpacity} onChange={(e) => setSliceOpacity(Number(e.target.value))} /></label>
          <div className="checks">
            <label className="check"><input type="checkbox" checked={contours} onChange={(e) => setContours(e.target.checked)} />Iso-lines</label>
            <label className="check"><input type="checkbox" checked={autoRange} onChange={(e) => setAutoRange(e.target.checked)} />Auto range</label>
            <label className="check"><input type="checkbox" checked={vectors} onChange={(e) => setVectors(e.target.checked)} />Velocity vectors</label>
            <label className="check"><input type="checkbox" checked={vecAuto} onChange={(e) => setVecAuto(e.target.checked)} />Auto-scale vectors</label>
            <label className="check"><input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} />Streamlines</label>
            <label className="check"><input type="checkbox" checked={tracers} onChange={(e) => setTracers(e.target.checked)} />Air tracers</label>
            <label className="check"><input type="checkbox" checked={particles} onChange={(e) => setParticles(e.target.checked)} />Smoke parcels</label>
            <label className="check"><input type="checkbox" checked={ao} onChange={(e) => setAo(e.target.checked)} />Ambient occlusion</label>
          </div>
          {vectors && <div className="row"><span>Vector density</span><div className="seg">{(["coarse", "medium", "fine"] as Density[]).map((d) => <button key={d} aria-pressed={density === d} onClick={() => setDensity(d)}>{d}</button>)}</div></div>}
          {stream && <div className="row"><span>Seed streamlines at</span><div className="seg">{(["vents", "fire", "plane"] as Seeds[]).map((d) => <button key={d} aria-pressed={seeds === d} onClick={() => setSeeds(d)}>{d === "vents" ? "supply vents" : d === "fire" ? "fire" : "cut plane"}</button>)}</div></div>}
        </div>

        <div className="col">
          <h2 className="col-h">Readouts</h2>
          <dl className="kv">
            <div><dt>Time since ignition</dt><dd className="mono">{fired ? `${since.toFixed(0)} s` : "—"}</dd></div>
            <div><dt>Burning / charred area</dt><dd className="mono">{(hud.cells * (sim?.dx ?? 0.16) ** 2).toFixed(2)} / {(hud.charred * (sim?.dx ?? 0.16) ** 2).toFixed(2)} m²</dd></div>
            <div><dt>Lowest O₂ at the flame</dt><dd className="mono">{fired ? `${(hud.minO2 * 100).toFixed(1)} %` : "—"}</dd></div>
            <div><dt>Burning limit of the fuel</dt><dd className="mono">{(params.material.limitO2 * 100).toFixed(1)} % O₂</dd></div>
          </dl>
          <div className="mini-h">Burning rate</div>
          <canvas ref={hrrRef} width={420} height={64} className="spark" />
          <ul className="alarms">
            {hud.det.map((d) => (
              <li key={d.id} className={d.alarmAt !== null ? "on" : ""}><span>{d.label}</span>
                <span className="mono">{d.alarmAt !== null ? `alarm +${(d.alarmAt - (sim?.ignitedAt ?? 0)).toFixed(0)} s` : fired ? `${((d.reading / ALARM) * 100).toFixed(0)} % of threshold` : "—"}</span></li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lab-analysis">
        <div className="an-block">
          <h2 className="col-h">Zones</h2>
          <p className="faint small">Volume averages per compartment, live. Which space is hottest, which is losing oxygen, where the smoke went.</p>
          <table className="zones">
            <thead><tr><th>Zone</th><th>Peak temp.</th><th>Mean temp.</th><th>Mean O₂</th><th>Mean CO₂</th><th>Smoke</th></tr></thead>
            <tbody>
              {hud.zones.map((z) => (
                <tr key={z.id}>
                  <td>{z.name}</td>
                  <td className="mono">{(20 + z.maxT).toFixed(0)} °C{fired && hottest?.id === z.id && z.maxT > 1 ? <em> hottest</em> : null}</td>
                  <td className="mono">{(20 + z.meanT).toFixed(1)} °C</td>
                  <td className="mono">{pct(z.meanO2)}{fired && leanest?.id === z.id && params.o2 - z.meanO2 > 0.0005 ? <em> lowest</em> : null}</td>
                  <td className="mono">{pct(z.meanCO2)}</td>
                  <td><span className="bar"><i style={{ width: `${Math.min(100, (z.smoke / Math.max(0.02, smokiest?.smoke ?? 0.02)) * 100)}%` }} /></span><span className="mono"> {z.smoke.toFixed(3)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row tight" style={{ marginTop: 14 }}>
            <button className="tlink" onClick={() => sim && download(`fire_lab_${hab.id}_history.csv`, sim.historyCsv())}>Export history (CSV)</button>
            <button className="tlink" onClick={() => api.current?.snapshot()}>Save image (PNG)</button>
          </div>
        </div>
        <div className="an-block">
          <h2 className="col-h">{hab.id === "mars" ? "Up the habitat" : "Along the habitat"}</h2>
          <p className="faint small">{hab.id === "mars" ? "Horizontal averages from floor (left) to roof (right). The rule marks the intermediate deck." : "Cross-section averages from end to end. Drift with the airflow = convection; symmetric spreading = diffusion. Rules mark bulkheads and doors."}</p>
          <canvas ref={profileRef} width={900} height={190} className="profile" />
          <div className="keyline small"><span className="k k1" />Temperature rise <span className="k k2" />O₂ deficit <span className="k k3" />Smoke</div>
        </div>
        <div className="an-block">
          <h2 className="col-h">Probe</h2>
          {hud.probe ? (
            <>
              <p className="faint small">{hud.probe.zone} · x {hud.probe.x.toFixed(2)} m, y {hud.probe.y.toFixed(2)} m, z {hud.probe.z.toFixed(2)} m · <button className="tlink inline" onClick={() => api.current?.probeCsv()}>export CSV</button> · <button className="tlink inline" onClick={() => api.current?.clearProbe()}>clear</button></p>
              <dl className="kv cols">
                <div><dt>Temperature</dt><dd className="mono">{hud.probe.T.toFixed(1)} °C</dd></div>
                <div><dt>O₂</dt><dd className="mono">{hud.probe.o2.toFixed(2)} %</dd></div>
                <div><dt>CO₂</dt><dd className="mono">{hud.probe.co2.toFixed(3)} %</dd></div>
                <div><dt>Smoke</dt><dd className="mono">{hud.probe.smoke.toFixed(3)}</dd></div>
                <div><dt>Velocity (u, v, w)</dt><dd className="mono">{hud.probe.vel.map((q) => (q * 100).toFixed(1)).join(", ")} cm/s</dd></div>
                <div><dt>Air speed</dt><dd className="mono">{(hud.probe.speed * 100).toFixed(1)} cm/s</dd></div>
                <div><dt>Vorticity</dt><dd className="mono">{hud.probe.vort.toFixed(2)} 1/s</dd></div>
                <div><dt>Cell Péclet</dt><dd className="mono">{hud.probe.pe.toFixed(1)} · {hud.probe.pe > 1 ? "convection" : "diffusion"}</dd></div>
              </dl>
              <canvas ref={probeRef} width={900} height={120} className="profile" />
            </>
          ) : (
            <p className="small">Choose <button className="tlink inline" onClick={() => setTool("probe")}>Probe</button> on the stage and click the colour plane or a wall: local temperature, O₂, CO₂, smoke, velocity vector, vorticity and Péclet number, with their time history.<canvas ref={probeRef} width={10} height={10} style={{ display: "none" }} /></p>
          )}
        </div>
        <div className="an-block">
          <h2 className="col-h">Solver diagnostics</h2>
          <p className="faint small">Checks that the computed flow is trustworthy: mass conservation after projection, time-step stability, energy.</p>
          <dl className="kv cols">
            <div><dt>Grid</dt><dd className="mono">{sim ? `${sim.nx}×${sim.ny}×${sim.nz} · ${(sim.dx * 100).toFixed(0)} cm` : "—"}</dd></div>
            <div><dt>Step time</dt><dd className="mono">{hud.diag.ms.toFixed(1)} ms</dd></div>
            <div><dt>CFL number</dt><dd className="mono">{hud.diag.cfl.toFixed(2)}</dd></div>
            <div><dt>RMS ∇·u − S</dt><dd className="mono">{hud.diag.res.toExponential(1)} 1/s</dd></div>
            <div><dt>Max air speed</dt><dd className="mono">{(hud.diag.vmax * 100).toFixed(1)} cm/s</dd></div>
            <div><dt>Mean kinetic energy</dt><dd className="mono">{hud.diag.ke.toExponential(2)} m²/s²</dd></div>
            <div><dt>Cabin pressure rise</dt><dd className="mono">{vent === 0 ? `${(hud.diag.dp * 100).toFixed(2)} %` : "vented"}</dd></div>
            <div><dt>Model diffusivity</dt><dd className="mono">{(D_MODEL * Math.sqrt(101.325 / pressure) * 1e4).toFixed(1)} cm²/s</dd></div>
          </dl>
        </div>
      </section>

      <section className="lab-evidence">
        <div className="ev-photo">
          <img src="/assets/photos/nasa_jsc2023e046631.jpg" alt="Plexiglass burning in the Saffire-IV spacecraft fire experiment" loading="lazy" />
          <p className="credit mono">A real spacecraft fire: acrylic burning in Saffire-IV, inside a Cygnus cargo vehicle. NASA, jsc2023e046631.</p>
        </div>
        <div className="ev-list">
          <h2 className="col-h">What NASA data say about these conditions</h2>
          {evidence.map((e) => (
            <article key={e.title} className={`ev ${e.tone}`}>
              <h3>{e.title}</h3><p>{e.text}</p>
              {e.accession && <button className="tlink" onClick={() => openDrawer(e.accession!)}>Open {e.accession}</button>}
            </article>
          ))}
          <p className="small faint">Teaching model: 3-D low-Mach Navier–Stokes with buoyancy and thermal expansion, transport of heat, O₂, CO₂ and smoke, oxygen-limited burning, spread, burnout and radiative-loss extinction — tuned to reproduce trends in the PSI data, not a validated fire code. <button className="tlink inline" onClick={() => go("method")}>How the model works</button></p>
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ 2-D charts (monochrome, drawn on canvas)
const INK = "#F0F0ED", MID = "#A7A9AA", LOW = "#62676A", GRID = "rgba(240,240,237,0.08)";

function drawHRR(cv: HTMLCanvasElement | null, sim: StationFire) {
  if (!cv) return;
  const g = cv.getContext("2d")!; const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const hist = sim.history.slice(-300); if (hist.length < 2) return;
  const max = Math.max(0.05, ...hist.map((h) => h.hrr));
  g.strokeStyle = GRID; g.beginPath(); g.moveTo(0, H - 1); g.lineTo(W, H - 1); g.stroke();
  g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath();
  hist.forEach((h, i) => { const X = (i / (hist.length - 1)) * W, Y = H - 2 - (h.hrr / max) * (H - 8); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
  g.stroke();
}

function drawProfile(cv: HTMLCanvasElement | null, sim: StationFire) {
  if (!cv) return;
  const g = cv.getContext("2d")!; const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const vertical = sim.hab.id === "mars";
  const n = vertical ? sim.ny : sim.nx;
  const T = new Float32Array(n), O = new Float32Array(n), S = new Float32Array(n);
  for (let a = 1; a <= n; a++) {
    let t = 0, o = 0, s = 0, c = 0;
    if (vertical) { for (let k = 1; k <= sim.nz; k++) for (let i = 1; i <= sim.nx; i++) { const q = sim.IX(i, a, k); if (sim.solid[q]) continue; t += sim.T[q]; o += sim.Y[q]; s += sim.S[q]; c++; } }
    else { for (let k = 1; k <= sim.nz; k++) for (let j = 1; j <= sim.ny; j++) { const q = sim.IX(a, j, k); if (sim.solid[q]) continue; t += sim.T[q]; o += sim.Y[q]; s += sim.S[q]; c++; } }
    T[a - 1] = c ? t / c : 0; O[a - 1] = c ? sim.params.o2 - o / c : 0; S[a - 1] = c ? s / c : 0;
  }
  const mT = Math.max(5, ...T), mO = Math.max(0.002, ...O), mS = Math.max(0.02, ...S);
  g.strokeStyle = GRID; for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(0, 10 + (k / 4) * (H - 30)); g.lineTo(W, 10 + (k / 4) * (H - 30)); g.stroke(); }
  g.strokeStyle = "rgba(240,240,237,0.25)";
  const marks = vertical ? sim.hab.solids.filter((s) => s.kind === "deck").map((s) => s.box[2]) : sim.hab.solids.filter((s) => s.kind === "bulkhead" || s.kind === "partition").map((s) => s.box[0]);
  for (const m of marks) { const X = ((m - 0.5) / n) * W; g.beginPath(); g.moveTo(X, 4); g.lineTo(X, H - 18); g.stroke(); }
  g.fillStyle = INK;
  for (const s of sim.sources) { const X = (((vertical ? s.j : s.i) - 0.5) / n) * W; g.beginPath(); g.moveTo(X, H - 16); g.lineTo(X - 5, H - 6); g.lineTo(X + 5, H - 6); g.fill(); }
  const line = (a: Float32Array, m: number, color: string, dash: number[]) => {
    g.strokeStyle = color; g.setLineDash(dash); g.lineWidth = 1.6; g.beginPath();
    a.forEach((v, i) => { const X = ((i + 0.5) / n) * W, Y = H - 20 - (v / m) * (H - 34); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
    g.stroke(); g.setLineDash([]);
  };
  line(T, mT, INK, []); line(O, mO, MID, [6, 4]); line(S, mS, LOW, [2, 3]);
  g.fillStyle = MID; g.font = "11px 'IBM Plex Mono', monospace";
  g.fillText(vertical ? "floor" : "fwd", 4, H - 4); g.fillText(vertical ? "roof" : "aft", W - 30, H - 4);
  g.fillText(`max ΔT ${mT.toFixed(0)} K · O₂ deficit ${(mO * 100).toFixed(2)} pts · smoke ${mS.toFixed(3)}`, 60, H - 4);
}

function drawProbe(cv: HTMLCanvasElement | null, hist: { t: number; T: number; o2: number; co2: number }[]) {
  if (!cv || cv.width < 50) return;
  const g = cv.getContext("2d")!; const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H); if (hist.length < 2) return;
  const series: ["T" | "o2" | "co2", string, number[], string][] = [["T", INK, [], "°C"], ["o2", MID, [6, 4], "% O₂"], ["co2", LOW, [2, 3], "% CO₂"]];
  series.forEach(([k, color, dash, unit], s) => {
    const vals = hist.map((h) => h[k]); const lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(1e-6, hi - lo);
    g.strokeStyle = color; g.setLineDash(dash); g.lineWidth = 1.5; g.beginPath();
    vals.forEach((v, i) => { const X = (i / (vals.length - 1)) * (W - 150), Y = H - 8 - ((v - lo) / span) * (H - 16); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); });
    g.stroke(); g.setLineDash([]);
    g.fillStyle = color; g.font = "11px 'IBM Plex Mono', monospace"; g.fillText(`${vals[vals.length - 1].toFixed(k === "T" ? 1 : 2)} ${unit}`, W - 140, 16 + s * 18);
  });
}
