/**
 * The base from outside. The hulls are opaque: to see inside, cut the whole scene with a section plane (x, y or z).
 * Each simulated room is drawn inside its module as a plain model of the solver's room (floor + furniture blocks);
 * hover a module to highlight it, click it (or its label) to open that room in the simulation.
 */
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { buildWorld, stageLights, WORLD_TEXT } from "../../scenes/worlds";
import { roomsOf, type Habitat } from "../../sim/habitats";

type Axis = "off" | "x" | "y" | "z";

function roomProxy(hab: Habitat, obj: THREE.Object3D) {
  // local bounding box of the module, without its own rotation
  const parent = obj.parent!; const rot = obj.rotation.clone(); obj.rotation.set(0, 0, 0); obj.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(obj); obj.rotation.copy(rot); obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const lo = bb.min.clone().applyMatrix4(inv), hi = bb.max.clone().applyMatrix4(inv);
  const size = hi.clone().sub(lo), centre = lo.clone().add(hi).multiplyScalar(0.5);
  const lx = hab.nx * hab.dx, ly = hab.ny * hab.dx, lz = hab.nz * hab.dx;
  const s = Math.min((0.84 * size.x) / lx, (0.8 * size.y) / ly, (0.84 * size.z) / lz);
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xdedcd6, roughness: 0.85 });
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m = mat) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), m); b.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); g.add(b);
  };
  box(0, lx, -0.04, 0, 0, lz, new THREE.MeshStandardMaterial({ color: 0x8d8b85, roughness: 0.9 }));
  for (const f of hab.solids) { const b = f.box; box((b[0] - 1) * hab.dx, b[1] * hab.dx, (b[2] - 1) * hab.dx, b[3] * hab.dx, (b[4] - 1) * hab.dx, b[5] * hab.dx); }
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(lx, ly, lz)), new THREE.LineBasicMaterial({ color: 0xf0f0ed, transparent: true, opacity: 0.5 }));
  outline.position.set(lx / 2, ly / 2, lz / 2); g.add(outline);
  g.scale.setScalar(s);
  const holder = new THREE.Group(); holder.add(g); g.position.set(-lx / 2 * s, -ly / 2 * s, -lz / 2 * s);
  holder.position.copy(centre); holder.rotation.copy(rot); parent.add(holder);
  return holder;
}

export default function BaseView({ world, onEnter }: { world: Habitat["world"]; onEnter: (habId: string) => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const tagRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [axis, setAxis] = useState<Axis>("off");
  const [pos, setPos] = useState(0.5);
  const [flip, setFlip] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const live = useRef({ axis, pos, flip }); live.current = { axis, pos, flip };
  const viewRef = useRef<(v: "reset" | "top") => void>(() => {});
  const rooms = roomsOf(world);

  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
    const w = buildWorld(world, "high"); scene.add(w.group); const unstage = stageLights(scene, w);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 500);
    const home = () => { camera.position.copy(w.camera.pos).sub(w.camera.target).multiplyScalar(1.3).add(w.camera.target); controls.target.copy(w.camera.target); };
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxDistance = 30; controls.minDistance = 0.8;
    home();
    const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera)); composer.addPass(new OutputPass());
    const resize = () => { const W = mount.clientWidth, H = mount.clientHeight; renderer.setSize(W, H, false); composer.setSize(W, H); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%"; camera.aspect = W / H; camera.updateProjectionMatrix(); w.setViewportHeight(H * renderer.getPixelRatio()); };
    const ro = new ResizeObserver(resize); ro.observe(mount); resize();

    // rooms: the module that holds each one, and a plain model of the room inside it
    const targets = rooms.map((h) => ({ hab: h, obj: h.room === "main" ? w.habitat : w.rooms[h.room] ?? w.habitat }));
    targets.forEach((t) => roomProxy(t.hab, t.obj));
    const sel = new THREE.BoxHelper(undefined, 0xf0f0ed); sel.visible = false; (sel.material as THREE.LineBasicMaterial).depthTest = false; sel.renderOrder = 10; scene.add(sel);

    // section plane through the whole scene
    // the cut spans the ground tile (the "cube" the base sits on) and every module; sky and stars are ignored
    const bounds = new THREE.Box3();
    w.group.children.forEach((c) => { if (c.userData.tile) bounds.union(new THREE.Box3().setFromObject(c)); });
    targets.forEach((t) => bounds.union(new THREE.Box3().setFromObject(t.obj)));
    if (bounds.isEmpty()) bounds.setFromObject(w.habitat);
    const mods = new THREE.Box3(); targets.forEach((t) => mods.union(new THREE.Box3().setFromObject(t.obj)));
    { const top = new THREE.Box3(); targets.forEach((t) => top.union(new THREE.Box3().setFromObject(t.obj))); bounds.max.y = Math.max(top.max.y, bounds.min.y + 0.5); }
    const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    const frame = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0), new THREE.Vector3(-0.5, 0.5, 0)]), new THREE.LineBasicMaterial({ color: 0xf0f0ed, transparent: true, opacity: 0.55 }));
    scene.add(frame);
    const sides = new Map<THREE.Material, THREE.Side>(); let cutOn = false;
    const setCut = (on: boolean) => {
      if (on === cutOn) return; cutOn = on;
      w.group.traverse((o) => { const m = (o as THREE.Mesh).material; if (!m) return; for (const mm of Array.isArray(m) ? m : [m]) { if (on) { if (!sides.has(mm)) sides.set(mm, mm.side); mm.side = THREE.DoubleSide; } else if (sides.has(mm)) mm.side = sides.get(mm)!; mm.needsUpdate = true; } });
      renderer.clippingPlanes = on ? [plane] : [];
    };

    viewRef.current = (v) => {
      if (v === "reset") home();
      else { const c = bounds.getCenter(new THREE.Vector3()); controls.target.copy(c); camera.position.set(c.x, c.y + bounds.getSize(new THREE.Vector3()).length() * 0.75, c.z + 0.01); }
    };

    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const pick = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(targets.map((t) => t.obj), true).filter((h) => !cutOn || plane.distanceToPoint(h.point) >= 0);
      if (!hits[0]) return null;
      return targets.find((t) => { let o: THREE.Object3D | null = hits[0].object; while (o) { if (o === t.obj) return true; o = o.parent; } return false; }) ?? null;
    };
    let down: { x: number; y: number } | null = null, hoverId: string | null = null;
    const onMove = (e: PointerEvent) => {
      if (down) return; const t = pick(e); const id = t?.hab.id ?? null;
      if (id !== hoverId) { hoverId = id; setHover(id); renderer.domElement.style.cursor = id ? "pointer" : "grab"; if (t) { sel.setFromObject(t.obj); sel.visible = true; } else sel.visible = false; }
    };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => { const d = down; down = null; if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return; const t = pick(e); if (t) onEnter(t.hab.id); };
    renderer.domElement.addEventListener("pointermove", onMove); renderer.domElement.addEventListener("pointerdown", onDown); renderer.domElement.addEventListener("pointerup", onUp);

    let raf = 0, last = performance.now(), t = 0; const v = new THREE.Vector3(), sz = new THREE.Vector3(), ctr = new THREE.Vector3();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick); const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now; t += dt;
      const L = live.current; setCut(L.axis !== "off");
      if (L.axis !== "off") {
        bounds.getSize(sz); bounds.getCenter(ctr);
        const k = L.axis === "x" ? 0 : L.axis === "y" ? 1 : 2, n = new THREE.Vector3(k === 0 ? -1 : 0, k === 1 ? -1 : 0, k === 2 ? -1 : 0);
        // a horizontal cut runs from the floor of the lowest module to the roof of the highest
        const lo = k === 1 ? mods.min.y : bounds.min.getComponent(k), span = k === 1 ? mods.max.y - mods.min.y : sz.getComponent(k);
        const at = lo + L.pos * span;
        // three.js removes what lies on the negative side: by default keep what is below / before the cut
        if (L.flip) n.negate();
        plane.normal.copy(n); plane.constant = -n.getComponent(k) * at;
        frame.visible = true; frame.position.copy(ctr).setComponent(k, at);
        if (k === 0) { frame.rotation.set(0, Math.PI / 2, 0); frame.scale.set(sz.z, sz.y, 1); } else if (k === 1) { frame.rotation.set(-Math.PI / 2, 0, 0); frame.scale.set(sz.x, sz.z, 1); } else { frame.rotation.set(0, 0, 0); frame.scale.set(sz.x, sz.y, 1); }
      } else frame.visible = false;
      w.update(dt, t); controls.update(); composer.render();
      targets.forEach((tg, q) => {
        const el = tagRefs.current[q]; if (!el) return;
        const b = new THREE.Box3().setFromObject(tg.obj); v.set((b.min.x + b.max.x) / 2, b.max.y + 0.08, (b.min.z + b.max.z) / 2).project(camera);
        el.style.display = v.z > 1 ? "none" : "block";
        el.style.transform = `translate(${((v.x + 1) / 2) * mount.clientWidth}px, ${((1 - v.y) / 2) * mount.clientHeight}px) translate(-50%, -100%)`;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove); renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp);
      unstage(); w.dispose(); controls.dispose(); composer.dispose(); pm.dispose(); renderer.dispose(); mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  return (
    <section className="lab2-base">
      <div className="lab2-canvas" ref={mountRef} />
      {rooms.map((h, q) => (
        <button key={h.id} ref={(el) => { tagRefs.current[q] = el; }} className={`room-tag${hover === h.id ? " live" : ""}`} onClick={() => onEnter(h.id)}>{h.short}</button>
      ))}
      <div className="base-tools">
        <span className="k mono">Section</span>
        <div className="seg">{(["off", "x", "y", "z"] as Axis[]).map((a) => <button key={a} aria-pressed={axis === a} onClick={() => { setAxis(a); setPos(a === "y" ? 0.45 : 0.5); }}>{a === "off" ? "None" : `${a.toUpperCase()} cut`}</button>)}</div>
        {axis !== "off" && <>
          <input type="range" min={0} max={1} step={0.005} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Section position" />
          <span className="mono small">{Math.round(pos * 100)} %</span>
          <button className="tlink small" onClick={() => setFlip(!flip)}>Keep other side</button>
        </>}
        <span className="grow" />
        <button className="tlink small" onClick={() => viewRef.current("top")}>Top view</button>
        <button className="tlink small" onClick={() => viewRef.current("reset")}>Reset view</button>
      </div>
      <p className="base-hint mono">{WORLD_TEXT[world].name} · drag to orbit · scroll to zoom · cut the scene to see inside · click a module to open its room</p>
    </section>
  );
}
