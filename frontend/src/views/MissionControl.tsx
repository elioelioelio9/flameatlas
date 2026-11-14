import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { api } from "../api";
import { useApp, useAsync } from "../state";
import { buildWorld, type WorldScene } from "../scenes/worlds";
import type { CoverageResponse, EarthApp, Investigation } from "../types";

type BodyId = "iss" | "earth" | "moon" | "mars";

interface BodyInfo { id: BodyId; name: string; sub: string; gravity: string; atmosphere: string; preset: string; presetLabel: string }
const SIM: Record<BodyId, { photo: string; credit: string; habitat: string; scenarios: { id: string; label: string; text: string }[] }> = {
  iss: { photo: "/assets/photos/nasa_iss042e021318.jpg", credit: "Destiny at night · NASA ISS042-E-021318", habitat: "Node 1, the US Lab and Node 2: three modules joined by hatches, swept by cabin air.",
    scenarios: [{ id: "iss", label: "Ventilation on", text: "Today's station: the airflow feeds the flame and carries smoke downstream." }, { id: "ventoff", label: "Fans shut down", text: "The standard response: does the flame starve in still air?" }, { id: "explo", label: "34 % O₂ exploration cabin", text: "Oxygen-rich, low-pressure air planned for future vehicles." }] },
  moon: { photo: "/assets/photos/nasa_jsc2004e20304.jpg", credit: "Taurus-Littrow, Apollo 17 · NASA JSC2004E20304", habitat: "A 10 m surface module — laboratory, crew quarters, airlock — at 1/6 g in oxygen-rich air.",
    scenarios: [{ id: "moon", label: "Fire in the crew quarters", text: "Cotton in a sleep station; does the smoke reach the lab detector in time?" }, { id: "moon-off", label: "Fans off", text: "Weak buoyancy alone: does the flame survive?" }] },
  mars: { photo: "/assets/photos/nasa_PIA25176.jpg", credit: "Gale crater, Curiosity Mastcam · NASA/JPL-Caltech/MSSS PIA25176", habitat: "A two-deck, 6 m habitat. At 0.38 g, does smoke climb through the deck hatch?",
    scenarios: [{ id: "mars", label: "Fire on the lab bench", text: "Lower-deck fire, crew sleeping upstairs." }, { id: "mars-off", label: "Fans off", text: "Does smoke still climb through the deck hatch at 0.38 g?" }] },
  earth: { photo: "/assets/photos/nasa_jsc2013e028042.jpg", credit: "Space Vehicle Mockup Facility · NASA JSC2013E028042", habitat: "A crew capsule on the launch pad, at 1 g: the reference every Earth standard is written for.",
    scenarios: [{ id: "earth", label: "Fire in the capsule, cabin air", text: "Buoyant plume: the ceiling detector goes first." }, { id: "apollo1", label: "100 % oxygen at 115 kPa", text: "The Apollo 1 atmosphere, on the pad in 1967." }, { id: "liftoff", label: "During liftoff, 3 g", text: "Stronger buoyancy, faster plume." }] },
};
const BODIES: BodyInfo[] = [
  { id: "iss", name: "International Space Station", sub: "Low Earth orbit · where NASA's fire experiments flew", gravity: "≈ 0 g", atmosphere: "21 % O₂ · 101 kPa", preset: "iss", presetLabel: "Start a fire on the ISS" },
  { id: "moon", name: "Moon base", sub: "Artemis surface habitat and rovers", gravity: "0.17 g", atmosphere: "≥ 30 % O₂ · ≤ 70 kPa (planned)", preset: "moon", presetLabel: "Start a fire in a Moon base" },
  { id: "mars", name: "Mars habitat", sub: "Long-duration surface outpost", gravity: "0.38 g", atmosphere: "Not yet defined", preset: "mars", presetLabel: "Start a fire in a Mars habitat" },
  { id: "earth", name: "Earth launch complex", sub: "Crew vehicle lifting off · reference fires at 1 g", gravity: "1 g (3 g at liftoff)", atmosphere: "21 % O₂ · 101 kPa", preset: "earth", presetLabel: "Start the same fire on Earth" },
];

const PHOTOS = {
  candle: { src: "/assets/photos/nasa_GRC-1998-C-00485_crop.jpg", id: "GRC-1998-C-00485", cap: "The same candle in normal gravity (left) and in microgravity (right).", who: "NASA Glenn Research Center" },
  bass: { src: "/assets/photos/nasa_iss035e016429.jpg", id: "ISS035-E-16429", cap: "Chris Cassidy runs a BASS flame test in the Microgravity Science Glovebox, 9 April 2013.", who: "NASA / Expedition 35", acr: "BASS" },
  bass2: { src: "/assets/photos/nasa_iss040e072900.jpg", id: "ISS040-E-072900", cap: "BASS-II: a 4 mm acrylic slab burning in a controlled airflow, July 2014.", who: "NASA / Expedition 40", acr: "BASS-II" },
  saffire: { src: "/assets/photos/nasa_jsc2023e046631.jpg", id: "JSC2023E046631", cap: "Saffire-IV: plexiglass burning inside a Cygnus cargo vehicle after it left the station.", who: "NASA", acr: "SAFFIRE" },
  acme: { src: "/assets/photos/nasa_GRC-2016-C-05051.jpg", id: "GRC-2016-C-05051", cap: "Inspecting the ACME gas-jet burner insert before flight, Glenn Research Center.", who: "NASA", acr: "ACME" },
  destiny: { src: "/assets/photos/nasa_iss042e021318.jpg", id: "ISS042-E-021318", cap: "Destiny, the US Laboratory, at night with the main lights off. 3 December 2014.", who: "NASA / Expedition 42" },
};

function hardwareGroup(inv: Investigation): string {
  const h = `${inv.hardware ?? ""} ${inv.flight_platform ?? ""}`.toLowerCase();
  if (h.includes("cygnus") || h.includes("saffire")) return "Cygnus cargo vehicle";
  if (h.includes("combustion integrated rack") || h.includes("cir")) return "Combustion Integrated Rack";
  if (h.includes("glovebox") || h.includes("msg")) return "Microgravity Science Glovebox";
  return "Other ISS hardware";
}

/** thin fresnel shell for the atmosphere (natural colour, no UI accent) */
function atmosphere(radius: number, color: THREE.ColorRepresentation, power: number, strength: number) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 32),
    new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(color) }, uPow: { value: power }, uK: { value: strength } },
      vertexShader: "varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }",
      fragmentShader: "uniform vec3 uColor; uniform float uPow; uniform float uK; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1. - abs(dot(vN, vV)), uPow); gl_FragColor = vec4(uColor * f * uK, f); }",
    }),
  );
}

export default function MissionControl() {
  const { investigations, openDrawer, go, setFirePreset } = useApp();
  const cov = useAsync<CoverageResponse>(() => api.coverage(), []);
  const earthApps = useAsync<EarthApp[]>(() => api.earth(), []);
  const mountRef = useRef<HTMLDivElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<BodyId | null>(null);
  const [ready, setReady] = useState(false);
  const selRef = useRef<BodyId | null>(null);
  const enterRef = useRef<(id: BodyId) => void>(() => {});
  selRef.current = selected;

  useEffect(() => {
    const mount = mountRef.current!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 600);
    const HOME = new THREE.Vector3(-1.2, 1.1, 9.5), HOME_T = new THREE.Vector3(1.6, -0.2, 0);
    camera.position.copy(HOME);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(HOME_T);
    controls.enableDamping = true; controls.minDistance = 0.03; controls.maxDistance = 40; controls.enablePan = false; controls.zoomSpeed = 0.8;

    // sunlight from the left, faint fill
    scene.add(new THREE.AmbientLight(0xffffff, 0.035));
    const sun = new THREE.DirectionalLight(0xffffff, 3.0);
    sun.position.set(-12, 3.5, -1.5); scene.add(sun);
    // the bases are small and often near the terminator: a soft lamp travels with the camera once a world is selected,
    // and a faint studio environment keeps their metal from going black (planets ignore it)
    const lamp = new THREE.DirectionalLight(0xfff6ea, 0); lamp.position.set(0.4, 0.6, 1); lamp.target.position.set(0, 0, -1); camera.add(lamp, lamp.target); scene.add(camera);
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.3;

    // stars: faint, white, varied
    const NS = 3000, sp = new Float32Array(NS * 3), sc = new Float32Array(NS * 3);
    for (let i = 0; i < NS; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 250, s = Math.sqrt(1 - u * u);
      sp.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
      const b = 0.25 + Math.random() ** 3 * 0.75; sc.set([b, b, b], i * 3);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(sp, 3)); sg.setAttribute("color", new THREE.BufferAttribute(sc, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.6, vertexColors: true, sizeAttenuation: true, toneMapped: false })));

    const loader = new THREE.TextureLoader();
    const tex = (url: string) => { const t = loader.load(url, () => setReady(true)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
    const planet = (url: string, r: number, rough = 1) => new THREE.Mesh(new THREE.SphereGeometry(r, 128, 64), new THREE.MeshStandardMaterial({ map: tex(url), roughness: rough, metalness: 0, envMapIntensity: 0 }));

    // Earth: NASA Blue Marble; ocean slightly glossy via low roughness is not available per-pixel, keep matte
    const earth = planet("/assets/textures/earth.jpg", 2.2, 0.85);
    earth.rotation.y = -1.9; earth.rotation.z = 0.41;
    const earthG = new THREE.Group(); earthG.position.set(2.4, -1.0, 0); earthG.add(earth);
    earthG.add(atmosphere(2.29, 0xb4ccff, 4.5, 0.9));
    scene.add(earthG);

    const moon = planet("/assets/textures/moon.jpg", 0.6, 1);
    const moonG = new THREE.Group(); moonG.position.set(9.5, 0.2, -10); moonG.add(moon); scene.add(moonG);
    const mars = planet("/assets/textures/mars.jpg", 0.95, 1);
    const marsG = new THREE.Group(); marsG.position.set(-11, 7, -32); marsG.add(mars); marsG.add(atmosphere(0.99, 0xd9a07a, 4, 0.5)); scene.add(marsG);

    // miniature bases sitting on each globe (low detail, animated astronauts / rovers / liftoff)
    const Y = new THREE.Vector3(0, 1, 0);
    const minis: { id: BodyId; w: WorldScene; holder: THREE.Group; R: number; normal: THREE.Vector3; scale: number }[] = [];
    const addMini = (id: "earth" | "moon" | "mars", parent: THREE.Object3D, R: number, dir: [number, number, number], scale: number) => {
      const w = buildWorld(id, "low", { bare: true });
      const normal = new THREE.Vector3(...dir).normalize();
      const holder = new THREE.Group(); holder.quaternion.setFromUnitVectors(Y, normal); holder.position.copy(normal).multiplyScalar(R * 0.997);
      w.group.scale.setScalar(scale); w.group.position.set(-w.anchor.x * scale, -w.anchor.y * scale, -w.anchor.z * scale); w.setScale(scale);
      holder.add(w.group); parent.add(holder);
      minis.push({ id, w, holder, R, normal, scale });
    };
    addMini("earth", earthG, 2.2, [-0.3, 0.78, 0.55], 0.16);
    addMini("moon", moonG, 0.6, [-0.3, 0.8, 0.52], 0.045);
    addMini("mars", marsG, 0.95, [-0.28, 0.8, 0.53], 0.07);

    // ISS: NASA 3-D model, on a low orbit around Earth
    const issPivot = new THREE.Group(); issPivot.position.copy(earthG.position); issPivot.rotation.set(0.35, -0.7, -0.5);
    scene.add(issPivot);
    const iss = new THREE.Group(); iss.position.set(0, 0, 2.75); issPivot.add(iss);
    const issHit = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ visible: false })); iss.add(issHit);
    const draco = new DRACOLoader().setDecoderPath("/assets/draco/");
    new GLTFLoader().setDRACOLoader(draco).load("/assets/models/iss.glb", (gltf) => {
      const m = gltf.scene;
      const box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const s = 0.42 / Math.max(size.x, size.y, size.z);
      m.position.sub(c).multiplyScalar(s); m.scale.setScalar(s);
      const metal = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.45, metalness: 0.55 });
      const array = new THREE.MeshStandardMaterial({ color: 0x5a4329, roughness: 0.35, metalness: 0.7, side: THREE.DoubleSide });
      m.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.computeBoundingBox();
        const b = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
        const dims = [b.x, b.y, b.z].sort((a, z) => a - z);
        if (/^(bendedtru|pCylinder)/.test(mesh.name)) { mesh.visible = false; return; }
        mesh.material = dims[0] < dims[2] * 0.05 && dims[1] > dims[2] * 0.12 ? array : metal;
      });
      const holder = new THREE.Group(); holder.add(m); holder.rotation.set(0, 0, Math.PI / 2);
      iss.add(holder);
    });
    const orbitLine = new THREE.Mesh(new THREE.TorusGeometry(2.75, 0.0035, 6, 256), new THREE.MeshBasicMaterial({ color: 0xf0f0ed, transparent: true, opacity: 0.18 }));
    issPivot.add(orbitLine);

    const targets: Record<BodyId, THREE.Object3D> = { iss, earth: earthG, moon: moonG, mars: marsG };
    const hitList: [THREE.Object3D, BodyId][] = [[issHit, "iss"], [earth, "earth"], [moon, "moon"], [mars, "mars"], ...minis.map((m) => [m.holder, m.id] as [THREE.Object3D, BodyId])];
    const radius: Record<BodyId, number> = { iss: 0.25, earth: 2.2, moon: 0.6, mars: 0.95 };

    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    let down = { x: 0, y: 0 }, lastClick = 0;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(hitList.map((h) => h[0]), true);
      if (hits.length) { let o: THREE.Object3D | null = hits[0].object; let hitE = hitList.find((h) => h[0] === o); while (!hitE && o) { o = o.parent; hitE = hitList.find((h) => h[0] === o); } if (!hitE) return; const id = hitE[1]; if (selRef.current === id && performance.now() - lastClick < 450) enterRef.current(id); setSelected(id); lastClick = performance.now(); }
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      renderer.setSize(mount.clientWidth, mount.clientHeight, false);
      renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
      camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix();
      minis.forEach((m) => m.w.setViewportHeight(mount.clientHeight * renderer.getPixelRatio()));
    };
    const ro = new ResizeObserver(resize); ro.observe(mount); resize();

    let raf = 0, lastSel: BodyId | null = null, last = performance.now(), t = 0, entering = false;
    const tmp = new THREE.Vector3(), want = new THREE.Vector3(), camWant = new THREE.Vector3(), nW = new THREE.Vector3();
    let flying = 0;
    const siteOf = (id: BodyId, out: THREE.Vector3) => {
      const m = minis.find((q) => q.id === id);
      if (!m) { targets[id].getWorldPosition(out); return null; }
      m.holder.getWorldPosition(out); nW.copy(m.normal).applyQuaternion(m.holder.parent!.getWorldQuaternion(new THREE.Quaternion()));
      return m;
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now; t += dt;
      const k = reduce ? 0.15 : 1;
      const sel = selRef.current;
      if (sel !== "earth") earth.rotation.y += 0.012 * dt * k;
      if (sel !== "moon") moon.rotation.y += 0.006 * dt * k;
      if (sel !== "mars") mars.rotation.y += 0.01 * dt * k;
      if (!sel) issPivot.rotation.y += 0.02 * dt * k;
      issPivot.visible = sel !== "earth";
      minis.forEach((m) => m.w.update(dt, t));
      lamp.intensity += ((sel && sel !== "iss" ? 2.2 : 0) - lamp.intensity) * Math.min(1, dt * 2.5);
      if (sel) {
        const m = siteOf(sel, want);
        controls.target.lerp(want, sel === lastSel ? 0.12 : 0.08);
        if (sel !== lastSel) {
          flying = 5;
          if (m) {
            // look down on the base from above its horizon, offset towards the camera side
            const side = camera.position.clone().sub(want); side.addScaledVector(nW, -side.dot(nW)).normalize();
            const dist = m.scale * (sel === "earth" ? 4 : 5) * 3.2;
            camWant.copy(want).addScaledVector(nW, dist * 0.5).addScaledVector(side, dist * 0.87);
          } else camWant.copy(want).add(new THREE.Vector3(-1, 0.35, 0.45).normalize().multiplyScalar(1.1));
        }
        if (flying > 0) {
          camera.position.lerp(camWant, 1 - Math.exp(-3.2 * dt)); flying -= dt;
          if (camera.position.distanceTo(camWant) < (m ? m.scale : 0.1) * 0.15) flying = 0;
        }
        else if (sel === "iss") { camWant.copy(camera.position).sub(controls.target); camera.position.copy(want).add(camWant); }
        // zooming in on the base takes you inside
        const R = m ? m.scale * (sel === "earth" ? 4 : 5) * 3.2 * 0.85 : 0.3, d = camera.position.distanceTo(want);
        if (!entering && flying <= 0 && d < R * 0.32) { entering = true; enterRef.current(sel); }
        const hintEl = tagsRef.current?.parentElement?.querySelector<HTMLElement>(".mc-enter");
        if (hintEl) hintEl.textContent = `Scroll in to enter the habitat · ${Math.max(0, Math.round((1 - (d - R * 0.32) / (R * 1.2)) * 100))} %`;
      } else if (lastSel !== null) { controls.target.copy(HOME_T); camera.position.copy(HOME); }
      lastSel = sel;
      const W = mount.clientWidth, H = mount.clientHeight;
      if (sel && W > 900) camera.setViewOffset(W, H, Math.min(220, W * 0.16), 0, W, H); else camera.clearViewOffset();
      controls.update();
      renderer.render(scene, camera);

      const tags = tagsRef.current;
      if (tags) {
        const w = mount.clientWidth, h = mount.clientHeight;
        (Object.keys(targets) as BodyId[]).forEach((id) => {
          const el = tags.querySelector<HTMLElement>(`[data-b="${id}"]`);
          if (!el) return;
          targets[id].getWorldPosition(tmp);
          tmp.y += radius[id] * 1.15 + 0.05;
          tmp.project(camera);
          el.style.display = tmp.z < 1 && (!sel || sel === id) ? "block" : "none";
          el.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, -100%)`;
        });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp);
      minis.forEach((m) => m.w.dispose());
      pm.dispose(); controls.dispose(); renderer.dispose(); mount.removeChild(renderer.domElement);
    };
  }, []);

  const flight = useMemo(() => investigations.filter((i) => i.in_scope && (i.project_type ?? "").startsWith("Microgravity")), [investigations]);
  const ground = useMemo(() => investigations.filter((i) => i.in_scope && (i.project_type ?? "").startsWith("Ground")), [investigations]);
  const groups = useMemo(() => {
    const m: Record<string, Investigation[]> = {};
    flight.forEach((i) => { (m[hardwareGroup(i)] ||= []).push(i); });
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length);
  }, [flight]);
  const flightTests = flight.reduce((s, i) => s + i.profile.n_tests, 0);
  const gap = (id: string) => cov.data?.gaps.find((g) => g.habitat.id === id);
  const info = BODIES.find((b) => b.id === selected);
  const byAcr = (acr?: string) => investigations.find((i) => (i.acronym ?? "").toUpperCase() === (acr ?? "").toUpperCase());
  const [fading, setFading] = useState(false);
  const simulate = (preset: string, view: "inside" | "base" = "inside") => { setFirePreset(`${preset}:${view}`); go("firelab"); };
  enterRef.current = (id) => { setFading(true); window.setTimeout(() => simulate(SIM[id].scenarios[0].id), 450); };

  const Photo = ({ p, className }: { p: (typeof PHOTOS)[keyof typeof PHOTOS]; className?: string }) => {
    const inv = "acr" in p ? byAcr(p.acr) : undefined;
    return (
      <figure className={`ph ${className ?? ""}`}>
        <img src={p.src} alt={p.cap} loading="lazy" />
        <figcaption>
          <span>{p.cap}</span>
          <span className="mono meta">{p.who} · {p.id}{inv && <> · <button className="tlink inline" onClick={() => openDrawer(inv.accession)}>{inv.acronym} data</button></>}</span>
        </figcaption>
      </figure>
    );
  };

  return (
    <div className="mission">
      <section className={`mc ${ready ? "ready" : ""}`}>
        <div className="mc-canvas" ref={mountRef} />
        <div className="mc-shade" aria-hidden="true" />
        <div className="mc-title" style={{ opacity: selected ? 0 : 1 }}>
          <p className="mono meta">NASA Space Apps 2026 · Flame in Freefall</p>
          <h1>Fire behaves differently up there.</h1>
          <p className="lede">Without gravity, hot gas doesn't rise. Pick a world, zoom in on its base and start a fire inside — the physics runs live, and every claim is traced to NASA's microgravity combustion data.</p>
          <div className="links">
            <button className="tlink strong" onClick={() => setSelected("iss")}>Start in the station</button>
            <button className="tlink" onClick={() => setSelected("earth")}>Launch pad</button>
            <button className="tlink" onClick={() => setSelected("moon")}>Moon base</button>
            <button className="tlink" onClick={() => setSelected("mars")}>Mars habitat</button>
            <button className="tlink" onClick={() => go("evidence")}>The evidence</button>
          </div>
        </div>
        <div className="mc-labels" ref={tagsRef}>
          {BODIES.map((b) => (
            <button key={b.id} data-b={b.id} className={`mc-tag ${selected === b.id ? "on" : ""}`} onClick={() => setSelected(b.id)}>
              {b.id === "iss" ? "ISS" : b.id === "earth" ? "Earth" : b.id === "moon" ? "Moon" : "Mars"}
            </button>
          ))}
        </div>
        <p className="mc-hint mono">Click a planet to fly to its base · scroll in on the base to enter its fire simulation · drag to orbit</p>
        {selected && <button className="mc-enter mono" onClick={() => enterRef.current(selected)}>Scroll in to enter the habitat</button>}
        <div className={`mc-fade ${fading ? "on" : ""}`} aria-hidden="true" />

        {info && (
          <aside className="mc-panel" aria-live="polite">
            <button className="tlink close" onClick={() => setSelected(null)}>Back to overview</button>
            <p className="mono meta">{info.sub}</p>
            <h2>{info.name}</h2>
            <p className="big">{SIM[info.id].habitat}</p>
            <dl className="facts">
              <div><dt>Gravity</dt><dd>{info.gravity}</dd></div>
              <div><dt>Cabin air</dt><dd>{info.atmosphere}</dd></div>
              <div><dt>NASA fire tests</dt><dd>{info.id === "iss" ? flightTests.toLocaleString() : info.id === "earth" ? `${ground.length} ground studies` : "None yet"}</dd></div>
            </dl>
            <ul className="mc-scen">
              {SIM[info.id].scenarios.map((sc) => (
                <li key={sc.id}><button onClick={() => simulate(sc.id)}><span className="t">{sc.label}</span><span className="d">{sc.text}</span></button></li>
              ))}
            </ul>
            <button className="tlink" onClick={() => simulate(SIM[info.id].scenarios[0].id, "base")}>See the base in full detail</button>
            {info.id === "iss" && (
              <p className="small faint">{flight.length} combustion investigations flew on or near the ISS. <button className="tlink inline" onClick={() => go("evidence")}>Browse the evidence</button></p>
            )}
            {(info.id === "moon" || info.id === "mars") && (
              <p className="small faint">No combustion experiment has run at this gravity yet: {info.id === "moon" ? <>only <b>{gap("lunar_base")?.n_inside ?? "…"}</b></> : <><b>{gap("mars_habitat")?.n_inside ?? "…"}</b></>} microgravity tests in PSI fall inside the planned atmosphere. The simulation shows the physics in between, labelled as a model.</p>
            )}
            {info.id === "earth" && (
              <p className="small faint">On Earth, buoyancy shapes every fire. The capsule on the pad is where the 1967 Apollo 1 fire happened, in 100 % oxygen.</p>
            )}
          </aside>
        )}
      </section>

      <section className="editorial">
        <div className="ed-split">
          <Photo p={PHOTOS.candle} className="tall" />
          <div className="ed-text">
            <p className="mono meta">The physics</p>
            <h2>Take away buoyancy and a flame changes shape, colour and speed.</h2>
            <p>On Earth, hot gas rises and pulls fresh air in below: the teardrop. In orbit nothing rises — oxygen only reaches the flame by slow diffusion or by the cabin fans. The flame becomes a dim blue sphere that can starve on its own exhaust.</p>
            <div className="links">
              <button className="tlink strong" onClick={() => go("firelab")}>See it in the simulation</button>
              <button className="tlink" onClick={() => go("evidence")}>Read the evidence</button>
            </div>
          </div>
        </div>
        <div className="ed-grid two">
          <Photo p={PHOTOS.bass2} />
          <Photo p={PHOTOS.saffire} />
        </div>
      </section>

      <section className="onearth">
        <header>
          <p className="mono meta">On Earth</p>
          <h2>What orbit teaches about fires down here.</h2>
          <p>Microgravity strips buoyancy out of a fire, which makes flames simpler to measure and to model. Each card says what could transfer to confined places on Earth, and what still has to be validated first.</p>
        </header>
        <div className="oe-grid">
          {(earthApps.data ?? []).map((e) => (
            <article key={e.id}>
              <span className="mono meta">{e.domain}</span>
              <h3>{e.title}</h3>
              <p>{e.contribution}</p>
              <p className="need"><b>Still to validate.</b> {e.validation_needed}</p>
              <div className="src">
                {e.sources.filter((q) => q.accession).map((q, i) => <button key={i} className="tlink inline" onClick={() => openDrawer(q.accession!)}>{investigations.find((v) => v.accession === q.accession)?.acronym ?? q.accession}</button>)}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
