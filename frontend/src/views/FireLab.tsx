import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ALARM, CabinFire, MATERIALS, type FlameState, type Params } from "../sim/firesim";
import { habitatById, roomsOf, type Habitat } from "../sim/habitats";
import { useApp } from "../state";
import { buildHabitatScene, buildIgnitionSource } from "./firelab/station";
import { buildEnvironment } from "./firelab/environment";
import { sliceMaterial, volumeMaterial } from "./firelab/shaders";
import { cmap, cmapCss, CMAP_ID, type CMap } from "./firelab/colormaps";
import { WORLD_TEXT } from "../scenes/worlds";
import { Puffs } from "../scenes/particles";

// ------------------------------------------------------------------ scenarios
type WorldId = Habitat["world"];
export interface RoomEntry { hab: string; room: string; zone: string; label: string }
const roomEntries = (world: WorldId): RoomEntry[] => roomsOf(world).flatMap((h) => h.zones.length > 1 ? h.zones.map((z) => ({ hab: h.id, room: h.room, zone: z.id, label: z.name })) : [{ hab: h.id, room: h.room, zone: h.zones[0].id, label: h.short }]);
export interface FirePreset { id: string; habitat: WorldId; label: string; g: number; vent: number; o2: number; p: number; material: string }
export const PRESETS: FirePreset[] = [
  { id: "iss", habitat: "iss", label: "Ventilation on", g: 0, vent: 15, o2: 21, p: 101.3, material: "pmma" },
  { id: "ventoff", habitat: "iss", label: "Fans shut down", g: 0, vent: 0, o2: 21, p: 101.3, material: "pmma" },
  { id: "explo", habitat: "iss", label: "34 % O₂ at 56.5 kPa", g: 0, vent: 0, o2: 34, p: 56.5, material: "pmma" },
  { id: "moon", habitat: "moon", label: "Crew quarters, fans on", g: 1.62, vent: 10, o2: 34, p: 56.5, material: "cotton" },
  { id: "moon-off", habitat: "moon", label: "Fans off", g: 1.62, vent: 0, o2: 34, p: 56.5, material: "cotton" },
  { id: "mars", habitat: "mars", label: "Lab bench, fans on", g: 3.71, vent: 10, o2: 30, p: 70, material: "cotton" },
  { id: "mars-off", habitat: "mars", label: "Fans off", g: 3.71, vent: 0, o2: 30, p: 70, material: "cotton" },
  { id: "earth", habitat: "earth", label: "On the pad, cabin air", g: 9.81, vent: 10, o2: 21, p: 101.3, material: "velcro" },
  { id: "apollo1", habitat: "earth", label: "100 % O₂ at 115 kPa (Apollo 1)", g: 9.81, vent: 0, o2: 100, p: 115, material: "velcro" },
  { id: "liftoff", habitat: "earth", label: "Liftoff, 3 g", g: 29.4, vent: 10, o2: 21, p: 101.3, material: "velcro" },
];
const WORLDS: { id: WorldId; label: string }[] = [{ id: "iss", label: "ISS" }, { id: "moon", label: "Moon" }, { id: "mars", label: "Mars" }, { id: "earth", label: "Earth" }];
const G_MARKS = [{ g: 0, label: "0 g" }, { g: 1.62, label: "Moon" }, { g: 3.71, label: "Mars" }, { g: 9.81, label: "Earth" }];

type SliceField = "off" | "temperature" | "o2" | "smoke" | "speed" | "vorticity";
type Axis = "x" | "y" | "z";
type Volume = "off" | "heat" | "smoke";
interface FieldDef { label: string; unit: string; cmap: CMap; range: (o2: number) => [number, number]; fmt: (v: number) => string }
const FIELDS: Record<Exclude<SliceField, "off">, FieldDef> = {
  temperature: { label: "Temperature", unit: "°C", cmap: "inferno", range: () => [20, 420], fmt: (v) => v.toFixed(0) },
  o2: { label: "Oxygen", unit: "% vol", cmap: "viridis", range: (o2) => [Math.max(0, o2 - 6), o2], fmt: (v) => v.toFixed(1) },
  smoke: { label: "Smoke", unit: "rel.", cmap: "gray", range: () => [0, 1], fmt: (v) => v.toFixed(2) },
  speed: { label: "Air speed", unit: "m/s", cmap: "viridis", range: () => [0, 0.6], fmt: (v) => v.toFixed(2) },
  vorticity: { label: "Vorticity", unit: "1/s", cmap: "plasma", range: () => [0, 3], fmt: (v) => v.toFixed(1) },
};

interface Hud {
  t: number; state: FlameState; hrr: number; minO2: number; maxT: number; area: number; charred: number; dp: number;
  det: { id: string; label: string; alarmAt: number | null; reading: number }[];
  layer: number | null; smokeVol: number; headT: number; headO2: number; headS: number; far: boolean;
  div: number; it: number; cfl: number; ms: number; vmax: number; uref: number; range: [number, number] | null; sealed: boolean; rate: number;
}
const EMPTY: Hud = { layer: null, smokeVol: 0, headT: 0, headO2: 0.21, headS: 0, far: true, t: 0, state: "idle", hrr: 0, minO2: 0.21, maxT: 0, area: 0, charred: 0, dp: 0, det: [], div: 0, it: 0, cfl: 0, ms: 0, vmax: 0, uref: 0.3, range: null, sealed: true, rate: 0 };
type Live = { vecNorm: boolean; smoke: boolean; flames: boolean; vectors: boolean; density: number; slice: SliceField; axis: Axis; slicePos: number; volume: Volume; stream: boolean; speed: number; paused: boolean; marks: boolean; probe: boolean };
type Api = { ignite: () => void; reset: () => void; door: (id: string, open: boolean) => void; fly: (zone: string | null) => void };

function download(name: string, text: string) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click(); }

// ================================================================== page
export default function FireLab() {
  const { firePreset, setFirePreset, fireSetup, setFireSetup, setEvidenceQuery, go } = useApp();
  const initial = PRESETS.find((p) => p.id === (firePreset ?? "").split(":")[0]) ?? PRESETS.find((p) => p.habitat === fireSetup?.world) ?? PRESETS[0];
  const [habId, setHabId] = useState<string>(initial.habitat);
  const [focus, setFocus] = useState<string | null>(null);         // "hab/zone" the camera is in, null = overview of the base
  const pendingFocus = useRef<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const [preset, setPreset] = useState(initial.id);
  const [g, setG] = useState(initial.g);
  const [vent, setVent] = useState(initial.vent);
  const [reverse, setReverse] = useState(false);
  const [o2, setO2] = useState(initial.o2);
  const [pressure, setPressure] = useState(initial.p);
  const [ambient, setAmbient] = useState(22);
  const [materialId, setMaterialId] = useState(initial.material);
  const [fuelSize, setFuelSize] = useState(5);
  const [igniter, setIgniter] = useState(1);
  const [turb, setTurb] = useState(0.3);
  const [doors, setDoors] = useState<Record<string, boolean>>({});

  const [smoke, setSmoke] = useState(true);
  const [flames, setFlames] = useState(true);
  const [vectors, setVectors] = useState(true);
  const [density, setDensity] = useState(2.2);
  const [slice, setSlice] = useState<SliceField>("off");
  const [axis, setAxis] = useState<Axis>("z");
  const [slicePos, setSlicePos] = useState(0.5);
  const [volume, setVolume] = useState<Volume>("off");
  const [stream, setStream] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState<Hud>(EMPTY);
  const [more, setMore] = useState(false);

  const hab = habitatById(habId); const world = hab.world;
  const entries = useMemo(() => roomEntries(world), [world]);
  const [vecNorm, setVecNorm] = useState(false);
  const params: Params = useMemo(() => ({
    gravity: g, ventSpeed: vent / 100, ventReverse: reverse, o2: o2 / 100, pressureKpa: pressure, ambientC: ambient,
    material: MATERIALS.find((m) => m.id === materialId)!, fuelSize, igniter, confinement: turb,
  }), [g, vent, reverse, o2, pressure, ambient, materialId, fuelSize, igniter, turb]);

  const simRef = useRef<CabinFire | null>(null);
  const paramsRef = useRef(params); paramsRef.current = params;
  const [marks, setMarks] = useState(false);
  const [probe, setProbe] = useState(false);
  const live = useRef<Live>({ vecNorm, smoke, flames, vectors, density, slice, axis, slicePos, volume, stream, speed, paused, marks, probe });
  const volEff: Volume = volume !== "off" ? volume : smoke ? "smoke" : "off";
  live.current = { vecNorm, smoke, flames, vectors, density, slice, axis, slicePos, volume: volEff, stream, speed, paused, marks, probe };
  const api = useRef<Api | null>(null);

  useEffect(() => {
    const s = simRef.current; if (!s) return;
    const o2Changed = Math.abs(s.params.o2 - params.o2) > 1e-6, fuelChanged = s.params.fuelSize !== params.fuelSize;
    s.setParams(params);
    if (o2Changed && s.state === "idle") s.Y.fill(params.o2);
    if (fuelChanged && s.source && s.state === "idle") s.placeSource(s.source.i, s.source.j, s.source.k, s.source.n);
  }, [params]);

  const applyPreset = (pr: FirePreset) => {
    setPreset(pr.id); setG(pr.g); setVent(pr.vent); setO2(pr.o2); setPressure(pr.p); setMaterialId(pr.material); setReverse(false);
    if (pr.habitat !== world) { pendingFocus.current = null; setFocus(null); setHabId(pr.habitat); }
    else { const s = simRef.current; if (s) { s.setParams({ gravity: pr.g, ventSpeed: pr.vent / 100, ventReverse: false, o2: pr.o2 / 100, pressureKpa: pr.p, material: MATERIALS.find((m) => m.id === pr.material)! }); s.reset(); } }
  };
  useEffect(() => {
    if (!firePreset) return;
    const [id, v] = firePreset.split(":");
    const pr = PRESETS.find((p) => p.id === id); if (pr) applyPreset(pr);
    if (pr && v !== "base") { const z = habitatById(pr.habitat).zones[0].id; if (pr.habitat === world) { api.current?.fly(z); } else pendingFocus.current = z; setFocus(`${pr.habitat}/${z}`); }
    setFirePreset(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firePreset]);

  // conditions handed over from an Evidence question
  useEffect(() => {
    if (!fireSetup) return;
    const f = fireSetup; const pr = PRESETS.find((p) => p.habitat === (f.world ?? world))!;
    applyPreset({ ...pr, id: "evidence", g: f.g ?? pr.g, o2: f.o2 ?? pr.o2, p: f.p ?? pr.p, vent: f.vent ?? pr.vent, material: f.material ?? pr.material });
    setLinked(f.from); setFireSetup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fireSetup]);
  const pick = (e: RoomEntry | null) => {
    if (!e) { setFocus(null); api.current?.fly(null); return; }
    setFocus(`${e.hab}/${e.zone}`);
    if (e.hab !== habId) { pendingFocus.current = e.zone; setHabId(e.hab); } else api.current?.fly(e.zone);
  };
  const pickRef = useRef(pick); pickRef.current = pick;
  const askEvidence = () => {
    const where = world === "iss" ? "in microgravity on the ISS" : world === "moon" ? "in lunar gravity in a Moon habitat" : world === "mars" ? "in martian gravity in a Mars habitat" : "at 1 g";
    setEvidenceQuery(`${params.material.label.split(" (")[0]} fire ${where}, ${o2} % O2 at ${pressure.toFixed(0)} kPa, ${vent === 0 ? "ventilation off" : `airflow ${vent} cm/s`}`); go("evidence");
  };

  const fd = slice !== "off" ? FIELDS[slice] : null;
  const range = hud.range ?? (fd ? fd.range(o2) : [0, 1]);
  const gLabel = g === 0 ? "0 g (orbit)" : `${(g / 9.81).toFixed(g < 9.81 ? 2 : 1)} g`;
  const status: Record<FlameState, string> = {
    idle: hud.far ? "Pick a zone, or scroll in to enter the habitat" : "Press Ignite, or click a wall or a bench to move the fire there",
    igniting: `Igniter on · ${hud.t.toFixed(0)} s`,
    burning: `Burning · ${hud.t.toFixed(0)} s · ${hud.area.toFixed(2)} m² alight`,
    extinguished: `The flame went out after ${hud.t.toFixed(0)} s — oxygen starvation`,
    "burnt-out": `Fuel consumed after ${hud.t.toFixed(0)} s`,
  };

  return (
    <div className="lab2">
      <header className="lab2-head">
        <nav className="seg big" aria-label="World">
          {WORLDS.map((w) => <button key={w.id} aria-pressed={world === w.id} onClick={() => applyPreset(PRESETS.find((p) => p.habitat === w.id)!)}>{w.label}</button>)}
        </nav>
        <span className="grow" />
        <p className="mono meta">{WORLD_TEXT[world].name}</p>
      </header>
      <nav className="lab2-zones" aria-label="Zones of the base">
        <button aria-pressed={focus === null} onClick={() => pick(null)}>Whole base</button>
        {entries.map((e) => <button key={`${e.hab}/${e.zone}`} aria-pressed={focus === `${e.hab}/${e.zone}`} className={e.hab === habId ? "live" : ""} onClick={() => pick(e)}>{e.label}</button>)}
        <span className="grow" />
        <span className="mono small faint">simulated now: {hab.short}{hab.zones.length > 1 ? ` (${hab.zones.length} linked zones)` : ""} · {hab.nx}×{hab.ny}×{hab.nz} cells of {(hab.dx * 100).toFixed(0)} cm</span>
      </nav>
      {linked && <p className="lab2-linked">Conditions set from your Evidence question: “{linked}”. <button className="tlink inline" onClick={() => setLinked(null)}>Dismiss</button></p>}

        <div className="lab2-main">
          <section className="lab2-stage">
            <Interior key={hab.id} hab={hab} entries={entries} pickRef={pickRef} pendingFocus={pendingFocus} paramsRef={paramsRef} live={live} simRef={simRef} api={api} setHud={setHud} setDoors={setDoors} />
            <div className="lab-status mono">{status[hud.state]}</div>
            {(fd || vectors) && (
              <div className="cmap-legend">
                {fd && <>
                  <div className="cl-title">{fd.label} ({fd.unit})</div>
                  <div className="cl-bar" style={{ background: cmapCss(fd.cmap) }} />
                  <div className="cl-ticks mono"><span>{fd.fmt(range[0])}</span><span>{fd.fmt((range[0] + range[1]) / 2)}</span><span>{fd.fmt(range[1])}</span></div>
                </>}
                {vectors && <div className="cl-vec mono"><i />{vecNorm ? "direction only (all arrows the same length)" : <>arrow of one spacing = {(hud.uref * 100).toFixed(1)} cm/s · below 0.3 cm/s not drawn</>}</div>}
              </div>
            )}
            <div className="stage-bar">
              <button className="btn-fire" onClick={() => api.current?.ignite()}>{hud.state === "idle" ? "Ignite" : "Re-ignite"}</button>
              <button className="tlink" onClick={() => setPaused(!paused)}>{paused ? "Run" : "Pause"}</button>
              <button className="tlink" onClick={() => api.current?.reset()}>Reset</button>
              <div className="seg" role="group" aria-label="Speed">{[1, 2, 4].map((s) => <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>)}</div>
              <span className="grow" />
              <span className="mono small faint">drag to orbit · scroll to zoom from the whole base into a room · click a surface to move the fire there</span>
            </div>
          </section>

          <aside className="lab2-side">
            <div className="presets">
              {PRESETS.filter((p) => p.habitat === world).map((p) => <button key={p.id} className="chip-btn" aria-pressed={preset === p.id} onClick={() => applyPreset(p)}>{p.label}</button>)}
            </div>

            <p className="small faint">{hab.note}</p>

            <h2 className="col-h">Environment</h2>
            <label className="range"><span>Gravity <b className="mono">{gLabel}</b></span><input type="range" min={0} max={30} step={0.01} value={g} onChange={(e) => setG(Number(e.target.value))} /></label>
            <div className="seg marks">{G_MARKS.map((m) => <button key={m.label} aria-pressed={Math.abs(g - m.g) < 0.01} onClick={() => setG(m.g)}>{m.label}</button>)}</div>
            <label className="range"><span>Airflow (fans) <b className="mono">{vent === 0 ? "off" : `${vent} cm/s`}</b></span><input type="range" min={0} max={50} step={1} value={vent} onChange={(e) => setVent(Number(e.target.value))} /></label>
            <label className="check"><input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />Reverse the airflow (swap supply and return)</label>
            <label className="range"><span>Oxygen <b className="mono">{o2} %</b></span><input type="range" min={12} max={100} step={0.5} value={o2} onChange={(e) => setO2(Number(e.target.value))} /></label>
            <label className="range"><span>Cabin pressure <b className="mono">{pressure.toFixed(1)} kPa</b></span><input type="range" min={20} max={120} step={0.5} value={pressure} onChange={(e) => setPressure(Number(e.target.value))} /></label>
            <label className="range"><span>Cabin temperature <b className="mono">{ambient} °C</b></span><input type="range" min={5} max={45} step={1} value={ambient} onChange={(e) => setAmbient(Number(e.target.value))} /></label>

            <h2 className="col-h">Fire</h2>
            <div className="row"><span>Burning material</span><select value={materialId} onChange={(e) => setMaterialId(e.target.value)}>{MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
            <label className="range"><span>Fuel panel <b className="mono">{((2 * fuelSize + 1) * hab.dx).toFixed(1)} × {((2 * Math.max(1, Math.round(fuelSize / 2)) + 1) * hab.dx).toFixed(1)} m</b></span><input type="range" min={2} max={8} step={1} value={fuelSize} onChange={(e) => setFuelSize(Number(e.target.value))} /></label>
            <label className="range"><span>Igniter power <b className="mono">{igniter.toFixed(1)}×</b></span><input type="range" min={0.5} max={2} step={0.1} value={igniter} onChange={(e) => setIgniter(Number(e.target.value))} /></label>
            {hab.doors.map((d) => (
              <label key={d.id} className="check"><input type="checkbox" checked={doors[d.id] ?? d.openDefault} onChange={(e) => api.current?.door(d.id, e.target.checked)} />{d.label} {doors[d.id] ?? d.openDefault ? "open" : "closed"}</label>
            ))}

            <h2 className="col-h">Show</h2>
            <div className="checks">
              <label className="check"><input type="checkbox" checked={smoke} onChange={(e) => setSmoke(e.target.checked)} />Smoke</label>
              <label className="check"><input type="checkbox" checked={flames} onChange={(e) => setFlames(e.target.checked)} />Flame</label>
              <label className="check"><input type="checkbox" checked={vectors} onChange={(e) => setVectors(e.target.checked)} />Velocity vectors</label>
              <label className="check"><input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} />Streamlines</label>
            </div>
            <div className="row"><span>Colour plane</span><select value={slice} onChange={(e) => setSlice(e.target.value as SliceField)}><option value="off">None</option>{Object.entries(FIELDS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}</select></div>
            {(vectors || slice !== "off") && <>
              <div className="row"><span>Plane</span><div className="seg"><button aria-pressed={axis === "z"} onClick={() => setAxis("z")}>Lengthwise</button><button aria-pressed={axis === "x"} onClick={() => setAxis("x")}>Across</button><button aria-pressed={axis === "y"} onClick={() => setAxis("y")}>Horizontal</button></div></div>
              <label className="range"><span>Plane position <b className="mono">{Math.round(slicePos * 100)} %</b></span><input type="range" min={0} max={1} step={0.01} value={slicePos} onChange={(e) => setSlicePos(Number(e.target.value))} /></label>
            </>}
            {vectors && <label className="check"><input type="checkbox" checked={vecNorm} onChange={(e) => setVecNorm(e.target.checked)} />Same length for all arrows (direction only)</label>}
            {vectors && <label className="range"><span>Vector spacing <b className="mono">{density.toFixed(1)} cells</b></span><input type="range" min={1} max={4} step={0.1} value={density} onChange={(e) => setDensity(Number(e.target.value))} /></label>}
            <button className="tlink small" onClick={() => setMore(!more)}>{more ? "Fewer options" : "More options"}</button>
            {more && <>
              <div className="row"><span>3-D volume</span><div className="seg">{(["off", "heat"] as Volume[]).map((v) => <button key={v} aria-pressed={volume === v} onClick={() => setVolume(v)}>{v === "off" ? "smoke" : "heat"}</button>)}</div></div>
              <label className="range"><span>Small eddies (vorticity confinement) <b className="mono">{turb.toFixed(2)}</b></span><input type="range" min={0} max={0.8} step={0.05} value={turb} onChange={(e) => setTurb(Number(e.target.value))} /></label>
            </>}

            <h2 className="col-h">Analysis</h2>
            <div className="checks">
              <label className="check"><input type="checkbox" checked={marks} onChange={(e) => setMarks(e.target.checked)} />Mark the extremes (hottest, least O₂, fastest air, pressure max / min)</label>
              <label className="check"><input type="checkbox" checked={probe} onChange={(e) => setProbe(e.target.checked)} />Probe: click to measure the air velocity vector</label>
            </div>
            {probe && <p className="small faint">While the probe is on, a click measures instead of moving the fire. The arrow is drawn at 2 m per m/s, so 10 cm of arrow is 5 cm/s of air. Click on the colour plane to measure inside the air.</p>}
            {marks && <p className="small faint">Pressure here is the dynamic part only (ρ·φ/Δt from the projection step), relative to the cabin mean. The uniform rise of a sealed cabin is in the readouts below.</p>}

            <p className="small faint">Reading the flow: under a smoke layer the arrows often point down. That is the slow return flow that replaces the air the plume carries up; the smoke itself stays up because it is lighter. Arrow length is proportional to speed, so compare lengths before directions.</p>

            <h2 className="col-h">Readouts</h2>
            <dl className="kv">
              <div><dt>Peak temperature</dt><dd className="mono">{(ambient + hud.maxT).toFixed(0)} °C</dd></div>
              <div><dt>O₂ at the flame</dt><dd className="mono">{hud.state === "idle" ? "—" : `${(hud.minO2 * 100).toFixed(1)} %`} <span className="faint">limit {(params.material.limitO2 * 100).toFixed(1)} %</span></dd></div>
              <div><dt>Burning / charred</dt><dd className="mono">{hud.area.toFixed(2)} / {hud.charred.toFixed(2)} m²</dd></div>
              <div><dt>Cabin pressure rise</dt><dd className="mono">{hud.sealed ? `${hud.dp.toFixed(0)} Pa` : "vented"}</dd></div>
              <div><dt>Smoke layer base</dt><dd className="mono">{hud.state === "idle" ? "—" : g < 0.05 ? "no layer without gravity" : hud.layer === null ? "no layer yet" : `${hud.layer.toFixed(1)} m above the floor`}</dd></div>
              <div><dt>Volume in smoke</dt><dd className="mono">{(hud.smokeVol * 100).toFixed(0)} % <span className="faint">above alarm level</span></dd></div>
              <div><dt>At head height (1.6 m)</dt><dd className="mono">{(ambient + hud.headT).toFixed(0)} °C · O₂ {(hud.headO2 * 100).toFixed(1)} %</dd></div>
            </dl>
            <canvas id="hrr" width={460} height={60} className="spark" />
            <ul className="alarms">
              {hud.det.map((d) => <li key={d.id} className={d.alarmAt !== null ? "on" : ""}><span>{d.label}</span><span className="mono">{d.alarmAt !== null ? `alarm at ${d.alarmAt.toFixed(0)} s` : hud.state === "idle" ? "—" : `${Math.min(99, (d.reading / ALARM) * 100).toFixed(0)} %`}</span></li>)}
            </ul>
            <p className="solver mono" title="Measured after every pressure solve">max |∇·u − S| {hud.div.toExponential(1)} s⁻¹ · PCG {hud.it} it · CFL {hud.cfl.toFixed(2)} · {hud.ms.toFixed(0)} ms/step · {hud.rate.toFixed(1)}× real time</p>
            <button className="tlink small" onClick={() => simRef.current && download(`fire_lab_${hab.id}.csv`, simRef.current.historyCsv())}>Export time series (CSV)</button>
            <button className="tlink small" onClick={askEvidence}>NASA evidence for these conditions</button>
          </aside>
        </div>
    </div>
  );
}

// ================================================================== inside: the simulation
interface InteriorProps {
  hab: Habitat;
  entries: RoomEntry[];
  pickRef: React.MutableRefObject<(e: RoomEntry | null) => void>;
  pendingFocus: React.MutableRefObject<string | null>;
  paramsRef: React.MutableRefObject<Params>;
  live: React.MutableRefObject<Live>;
  simRef: React.MutableRefObject<CabinFire | null>;
  api: React.MutableRefObject<Api | null>;
  setHud: (h: Hud) => void;
  setDoors: (d: Record<string, boolean>) => void;
}

function Interior({ hab, entries, pickRef, pendingFocus, paramsRef, live, simRef, api, setHud, setDoors }: InteriorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mount = mountRef.current!;
    const sim = new CabinFire(hab, paramsRef.current); simRef.current = sim;
    setDoors({ ...sim.doorOpen });
    const { lx, ly, lz, dx, nx, ny, nz } = sim;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.25;
    const env = buildEnvironment(hab, scene, sim, renderer);
    const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 9000);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.minDistance = 0.5; controls.maxDistance = 16 * env.k; controls.zoomSpeed = 1.5;
    if (hab.world !== "iss" && !(hab.world === "earth" && hab.fit === "main")) controls.maxPolarAngle = Math.PI * 0.497;
    // one continuous view: the whole base from outside, and the same camera flown into a room
    type Pose = { pos: THREE.Vector3; target: THREE.Vector3 };
    const poseOf = (zone: string | null): Pose => {
      if (zone === null) { const d = 7 * env.k; return { pos: new THREE.Vector3(lx / 2 + d * 0.55, ly / 2 + d * 0.4, lz / 2 + d * 0.72), target: new THREE.Vector3(lx / 2, ly / 2, lz / 2) }; }
      const b = (hab.zones.find((z) => z.id === zone) ?? hab.zones[0]).box;
      const cx = ((b[0] - 1 + b[1]) / 2) * dx, cy = ((b[2] - 1 + b[3]) / 2) * dx, cz = ((b[4] - 1 + b[5]) / 2) * dx, Lz = Math.max(3.5, (b[1] - b[0] + 1) * dx, (b[5] - b[4] + 1) * dx);
      return { pos: new THREE.Vector3(cx - Lz * 0.14, cy + 0.4 + Lz * 0.72, cz + Lz * 0.74), target: new THREE.Vector3(cx, cy - 0.15, cz) };
    };
    const start = poseOf(pendingFocus.current); pendingFocus.current = null;
    camera.position.copy(start.pos); controls.target.copy(start.target);
    let flight: { from: Pose; to: Pose; t: number } | null = null;
    const fly = (zone: string | null) => { flight = { from: { pos: camera.position.clone(), target: controls.target.clone() }, to: poseOf(zone), t: 0 }; };

    scene.add(new THREE.HemisphereLight(0xf0f0ed, 0x4a4842, 0.55));
    for (const z of hab.zones) { const b = z.box; const pl = new THREE.PointLight(0xfff4e6, hab.walls === "racks" ? 1.0 : 1.8, 9, 1.5); pl.position.set(((b[0] + b[1]) / 2 - 0.5) * dx, Math.min(ly - 0.2, (b[3] - 1) * dx - 0.15), lz / 2); scene.add(pl); }
    const flameLight = new THREE.PointLight(0xff9a40, 0, 6, 1.5); scene.add(flameLight);

    const habScene = buildHabitatScene(hab, sim); scene.add(habScene.group); habScene.setCutaway(true);

    // fields as 3-D textures (R value, G gas mask)
    const volData = new Uint8Array(sim.n * 2), sliceData = new Uint8Array(sim.n * 2);
    const mk3d = (d: Uint8Array) => { const t = new THREE.Data3DTexture(d, nx, ny, nz); t.format = THREE.RGFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true; return t; };
    const volTex = mk3d(volData), sliceTex = mk3d(sliceData); const dims = new THREE.Vector3(lx, ly, lz);
    const volMat = volumeMaterial(volTex, dims); const volBox = new THREE.Mesh(new THREE.BoxGeometry(lx - 0.02, ly - 0.02, lz - 0.02), volMat); volBox.position.set(lx / 2, ly / 2, lz / 2); volBox.renderOrder = 3; scene.add(volBox);
    const slMat = sliceMaterial(sliceTex, dims); const slicePlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), slMat); slicePlane.renderOrder = 2; scene.add(slicePlane);
    const sliceEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color: 0xf0f0ed, transparent: true, opacity: 0.14 })); scene.add(sliceEdge);

    // velocity arrows (unit +y glyph scaled by |u|)
    const shaft = new THREE.CylinderGeometry(0.0055, 0.0055, 0.7, 5); shaft.translate(0, 0.35, 0);
    const head = new THREE.ConeGeometry(0.022, 0.3, 8); head.translate(0, 0.85, 0);
    const MAXA = 5000;
    const arrows = new THREE.InstancedMesh(mergeGeometries([shaft, head])!, new THREE.MeshBasicMaterial({ toneMapped: false }), MAXA);
    arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage); arrows.setColorAt(0, new THREE.Color()); arrows.renderOrder = 4; arrows.frustumCulled = false; scene.add(arrows);

    // streamlines
    const MAXS = 30000, stPos = new Float32Array(MAXS * 6), stCol = new Float32Array(MAXS * 6), stGeo = new THREE.BufferGeometry();
    stGeo.setAttribute("position", new THREE.BufferAttribute(stPos, 3)); stGeo.setAttribute("color", new THREE.BufferAttribute(stCol, 3));
    const streamLines = new THREE.LineSegments(stGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, toneMapped: false })); streamLines.frustumCulled = false; scene.add(streamLines);
    let streamAt = -1;

    // smoke and flame particles, carried by the computed velocity field
    const smokeP = new Puffs({ max: 9000, size: [0.12, 0.9], color: [0x2f2d2b, 0x77736e], opacity: [0.5, 0.0], fadeIn: 0.03, billow: 0.7 });
    const flameP = new Puffs({ max: 2600, additive: true, size: [0.13, 0.05], color: [0xfff1c8, 0xff6a14], opacity: [0.5, 0], fadeIn: 0.05, billow: 0.35 });
    scene.add(smokeP.points, flameP.points);

    // igniter + fuel panel (unburnt / glowing / charred)
    const igniter = buildIgnitionSource(); igniter.visible = false; scene.add(igniter);
    const panelData = new Uint8Array(17 * 9 * 4); const panelTex = new THREE.DataTexture(panelData, 17, 9, THREE.RGBAFormat); panelTex.magFilter = THREE.NearestFilter; panelTex.colorSpace = THREE.SRGBColorSpace;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(17 * dx, 9 * dx), new THREE.MeshStandardMaterial({ map: panelTex, transparent: true, roughness: 0.7, emissive: 0xffffff, emissiveMap: panelTex, emissiveIntensity: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }));
    panel.visible = false; scene.add(panel);
    const axisVec = (a: number) => new THREE.Vector3(a === 0 ? 1 : 0, a === 1 ? 1 : 0, a === 2 ? 1 : 0);
    let panelKey = "";
    const placePanel = () => {
      const s = sim.source; if (!s) { panel.visible = igniter.visible = false; panelKey = ""; return; }
      const key = `${s.i},${s.j},${s.k},${s.n}`; if (key === panelKey) return; panelKey = key;
      const n = new THREE.Vector3(...s.n), eu = axisVec(s.tu), ev = axisVec(s.tv);
      panel.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(eu, ev, new THREE.Vector3().crossVectors(eu, ev)));
      const surf = new THREE.Vector3(sim.centre(s.i), sim.centre(s.j), sim.centre(s.k)).addScaledVector(n, -dx / 2);
      panel.position.copy(surf).addScaledVector(n, 0.006); panel.visible = true;
      igniter.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(eu, n, new THREE.Vector3().crossVectors(eu, n)));
      igniter.position.copy(surf).addScaledVector(eu, -0.45); igniter.visible = true;
    };

    // smoke detectors
    const detMeshes = sim.detectors.map((d) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 20), new THREE.MeshStandardMaterial({ color: 0x62676a }));
      const c = d.c, i = c % nx, j = Math.floor(c / nx) % ny, k = Math.floor(c / (nx * ny));
      m.position.set(sim.centre(i), d.kind === "duct" ? sim.centre(j) : (j + 1) * dx - 0.02, sim.centre(k)); scene.add(m); return m;
    });

    const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.22, 0.3, 0.97)); composer.addPass(new OutputPass());
    const resize = () => {
      const W = mount.clientWidth, H = mount.clientHeight; renderer.setSize(W, H, false); composer.setSize(W, H);
      renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%"; camera.aspect = W / H; camera.updateProjectionMatrix();
      smokeP.setViewportHeight(H * renderer.getPixelRatio()); flameP.setViewportHeight(H * renderer.getPixelRatio()); env.setViewportHeight(H * renderer.getPixelRatio());
    };
    const ro = new ResizeObserver(resize); ro.observe(mount); resize();

    // click: move the (single) fire to a surface and ignite it there
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; flight = null; };
    const onWheel = () => { flight = null; };
    renderer.domElement.addEventListener("wheel", onWheel, { passive: true });
    const onUp = (e: PointerEvent) => {
      const d0 = down; down = null; if (!d0 || Math.hypot(e.clientX - d0.x, e.clientY - d0.y) > 5) return;
      const r = renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (farNow) return; // from outside, a click only orbits: enter a room first
      if (live.current.probe) { measureAt(); return; }
      const hit = ray.intersectObjects(habScene.surfaces, false)[0]; if (!hit) return;
      const nW = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
      if (nW.dot(ray.ray.direction) > 0) nW.negate();
      const a = [Math.abs(nW.x), Math.abs(nW.y), Math.abs(nW.z)], ax = a.indexOf(Math.max(...a));
      const n: [number, number, number] = [0, 0, 0]; n[ax] = Math.sign([nW.x, nW.y, nW.z][ax]) || 1;
      const p = hit.point.clone().addScaledVector(new THREE.Vector3(...n), dx * 0.5);
      const [i, j, k] = sim.cellOf(p.x, p.y, p.z);
      sim.reset(); smokeP.clear(); flameP.clear();
      if (sim.placeSource(i, j, k, n)) sim.ignite();
    };
    renderer.domElement.addEventListener("pointerdown", onDown); renderer.domElement.addEventListener("pointerup", onUp);

    api.current = {
      ignite: () => { if (sim.state !== "idle") { const s = sim.source; sim.reset(); if (s) sim.placeSource(s.i, s.j, s.k, s.n); smokeP.clear(); flameP.clear(); } sim.ignite(); },
      reset: () => { sim.reset(); smokeP.clear(); flameP.clear(); },
      door: (id, open) => { sim.setDoor(id, open); habScene.rebuildSolids(); setDoors({ ...sim.doorOpen }); },
      fly,
    };

    // ---------------- field helpers
    const field = (f: Exclude<SliceField, "off">, c: number) => {
      switch (f) {
        case "temperature": return sim.params.ambientC + sim.T[c];
        case "o2": return sim.Y[c] * 100;
        case "smoke": return sim.S[c];
        case "speed": return Math.hypot(sim.uc[c], sim.vc[c], sim.wc[c]);
        case "vorticity": return sim.vort[c];
      }
    };
    let curRange: [number, number] | null = null;
    const upload = () => {
      const Lv = live.current;
      if (Lv.volume !== "off") {
        for (let c = 0, q = 0; c < sim.n; c++, q += 2) { const v = Lv.volume === "smoke" ? Math.sqrt(sim.S[c] / 1.6) : sim.T[c] / 300; volData[q] = Math.max(0, Math.min(255, v * 255)); volData[q + 1] = sim.solid[c] ? 0 : 255; }
        volTex.needsUpdate = true;
      }
      if (Lv.slice !== "off") {
        const f = FIELDS[Lv.slice]; if (Lv.slice === "vorticity") sim.computeVorticity();
        const [lo, hi] = f.range(sim.params.o2 * 100); curRange = [lo, hi];
        for (let c = 0, q = 0; c < sim.n; c++, q += 2) { sliceData[q] = Math.max(0, Math.min(255, ((field(Lv.slice, c) - lo) / (hi - lo)) * 255)); sliceData[q + 1] = sim.solid[c] ? 0 : 255; }
        sliceTex.needsUpdate = true; slMat.uniforms.uCmap.value = CMAP_ID[f.cmap]; slMat.uniforms.uAlphaMode.value = Lv.slice === "o2" ? 2 : 1;
      } else curRange = null;
    };
    const sliceCoord = (a: Axis, s: number) => 0.03 + s * ((a === "x" ? lx : a === "y" ? ly : lz) - 0.06);
    const planePoints = (a: Axis, s: number, spacing: number): [number, number, number][] => {
      const c = sliceCoord(a, s); const pts: [number, number, number][] = [];
      const rng = (Ln: number) => { const n = Math.max(2, Math.floor(Ln / spacing)); return Array.from({ length: n }, (_, q) => ((q + 0.5) / n) * Ln); };
      if (a === "x") for (const y of rng(ly)) for (const z of rng(lz)) pts.push([c, y, z]);
      else if (a === "y") for (const x of rng(lx)) for (const z of rng(lz)) pts.push([x, c, z]);
      else for (const x of rng(lx)) for (const y of rng(ly)) pts.push([x, y, c]);
      return pts.filter(([x, y, z]) => !sim.isSolidAt(x, y, z));
    };
    const placeSlice = () => {
      const Lv = live.current; const show = Lv.slice !== "off"; slicePlane.visible = show; sliceEdge.visible = show || Lv.vectors;
      const c = sliceCoord(Lv.axis, Lv.slicePos);
      if (Lv.axis === "x") { slicePlane.scale.set(lz, ly, 1); slicePlane.rotation.set(0, Math.PI / 2, 0); slicePlane.position.set(c, ly / 2, lz / 2); }
      else if (Lv.axis === "y") { slicePlane.scale.set(lx, lz, 1); slicePlane.rotation.set(-Math.PI / 2, 0, 0); slicePlane.position.set(lx / 2, c, lz / 2); }
      else { slicePlane.scale.set(lx, ly, 1); slicePlane.rotation.set(0, 0, 0); slicePlane.position.set(lx / 2, ly / 2, c); }
      sliceEdge.position.copy(slicePlane.position); sliceEdge.rotation.copy(slicePlane.rotation); sliceEdge.scale.copy(slicePlane.scale);
      slMat.uniforms.uContours.value = 1; slMat.uniforms.uOpacity.value = 0.8;
    };
    const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), upV = new THREE.Vector3(0, 1, 0), dirV = new THREE.Vector3(), scV = new THREE.Vector3(), pV = new THREE.Vector3(), colC = new THREE.Color();
    let uref = 0.3;
    const placeArrows = () => {
      const Lv = live.current; arrows.visible = Lv.vectors; if (!Lv.vectors) return;
      const spacing = dx * Lv.density; const pts = planePoints(Lv.axis, Lv.slicePos, spacing);
      const vel = pts.map(([x, y, z]) => sim.velocity(x, y, z)); const sp = vel.map((v) => Math.hypot(v[0], v[1], v[2]));
      // true scale: the reference speed never drops below 2 cm/s, so still air is drawn as (almost) nothing instead of being blown up
      const sorted = [...sp].sort((a, b) => a - b); uref = Math.max(0.02, sorted[Math.floor(sorted.length * 0.92)] ?? 0.02);
      const thick = spacing * 3; let n = 0;
      for (let q = 0; q < pts.length && n < MAXA; q++) {
        const s = sp[q]; if (s < 0.003) continue;
        dirV.set(vel[q][0] / s, vel[q][1] / s, vel[q][2] / s); qt.setFromUnitVectors(upV, dirV);
        pV.set(...pts[q]); scV.set(thick, (Lv.vecNorm ? 0.8 : Math.min(1.3, s / uref)) * spacing * 0.95, thick); m4.compose(pV, qt, scV); arrows.setMatrixAt(n, m4);
        const [r, g, b] = cmap("viridis", 0.15 + 0.85 * Math.min(1, s / uref)); arrows.setColorAt(n, colC.setRGB(r, g, b)); n++;
      }
      arrows.count = n; arrows.instanceMatrix.needsUpdate = true; if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;
    };
    const traceStream = () => {
      const seeds: THREE.Vector3[] = [];
      for (const s of sim.fuel) if (s.state === 1) seeds.push(new THREE.Vector3(sim.centre(s.i), sim.centre(s.j), sim.centre(s.k)));
      for (const v of hab.vents) for (let a = v.a[0]; a <= v.a[1]; a += 2) for (let b = v.b[0]; b <= v.b[1]; b += 2) {
        const o = dx * 0.6, A = (a - 0.5) * dx, B = (b - 0.5) * dx;
        seeds.push(new THREE.Vector3(...(v.face === "x0" ? [o, A, B] : v.face === "x1" ? [lx - o, A, B] : v.face === "y1" ? [A, ly - o, B] : v.face === "y0" ? [A, o, B] : v.face === "z0" ? [A, B, o] : [A, B, lz - o]) as [number, number, number]));
      }
      if (seeds.length < 30) planePoints(live.current.axis, live.current.slicePos, dx * 4).forEach((p) => seeds.push(new THREE.Vector3(...p)));
      let n = 0; const h = dx * 0.4;
      for (const s0 of seeds) for (const sign of [1, -1]) {
        const p = s0.clone();
        for (let st = 0; st < 500 && n < MAXS; st++) {
          const [u1, v1, w1] = sim.velocity(p.x, p.y, p.z); const s1 = Math.hypot(u1, v1, w1); if (s1 < 1e-4) break;
          const [u2, v2, w2] = sim.velocity(p.x + sign * u1 / s1 * h / 2, p.y + sign * v1 / s1 * h / 2, p.z + sign * w1 / s1 * h / 2); const s2 = Math.hypot(u2, v2, w2); if (s2 < 1e-4) break;
          const qx = p.x + sign * u2 / s2 * h, qy = p.y + sign * v2 / s2 * h, qz = p.z + sign * w2 / s2 * h; if (sim.isSolidAt(qx, qy, qz)) break;
          const [r, g, b] = cmap("viridis", 0.15 + 0.85 * Math.min(1, s2 / uref));
          stPos.set([p.x, p.y, p.z, qx, qy, qz], n * 6); stCol.set([r, g, b, r, g, b], n * 6); p.set(qx, qy, qz); n++;
        }
      }
      stGeo.setDrawRange(0, n * 2); stGeo.attributes.position.needsUpdate = true; stGeo.attributes.color.needsUpdate = true;
    };

    // ---------------- analysis: extremes of the fields and a click probe that measures the velocity vector
    const overlay = document.createElement("div"); overlay.className = "lab-overlay"; mount.appendChild(overlay);
    type Mark = { key: string; label: string; pos: THREE.Vector3; el: HTMLDivElement };
    const marksL: Mark[] = [];
    const markEl = (cls: string) => { const e = document.createElement("div"); e.className = `lab-mark ${cls}`; overlay.appendChild(e); return e; };
    const rhoAir = () => 1.2 * (sim.params.pressureKpa / 101.3) * (293 / (273 + sim.params.ambientC));
    const cellPos = (c: number) => new THREE.Vector3(sim.centre(c % nx), sim.centre(Math.floor(c / nx) % ny), sim.centre(Math.floor(c / (nx * ny))));
    const findExtremes = () => {
      let cT = -1, cO = -1, cU = -1, cPh = -1, cPl = -1, vT = -1e9, vO = 1e9, vU = -1, vPh = -1e18, vPl = 1e18, sumP = 0, nP = 0;
      for (let c = 0; c < sim.n; c++) {
        if (sim.solid[c]) continue;
        if (sim.T[c] > vT) { vT = sim.T[c]; cT = c; }
        if (sim.Y[c] < vO) { vO = sim.Y[c]; cO = c; }
        const u = sim.uc[c] * sim.uc[c] + sim.vc[c] * sim.vc[c] + sim.wc[c] * sim.wc[c]; if (u > vU) { vU = u; cU = c; }
        const P = sim.P[c]; sumP += P; nP++; if (P > vPh) { vPh = P; cPh = c; } if (P < vPl) { vPl = P; cPl = c; }
      }
      const k = rhoAir() / DT, mean = nP ? sumP / nP : 0;
      const list: [string, string, number, string][] = [
        ["T", "hottest", cT, `${(sim.params.ambientC + vT).toFixed(0)} °C`],
        ["O", "least O₂", cO, `${(vO * 100).toFixed(1)} %`],
        ["U", "fastest air", cU, `${(Math.sqrt(vU) * 100).toFixed(1)} cm/s`],
        ["Ph", "pressure max", cPh, `${((vPh - mean) * k * 1000).toFixed(1)} mPa`],
        ["Pl", "pressure min", cPl, `${((vPl - mean) * k * 1000).toFixed(1)} mPa`],
      ];
      for (const [key, label, c, val] of list) {
        let m = marksL.find((q) => q.key === key);
        if (!m) { m = { key, label, pos: new THREE.Vector3(), el: markEl(key === "Pl" ? "low" : "") }; marksL.push(m); }
        if (c >= 0) m.pos.copy(cellPos(c));
        m.el.innerHTML = `<i></i><span>${label}<b>${val}</b></span>`;
      }
    };
    // probe: arrow drawn at the clicked point, its length = local speed (scale bar in the readout)
    const probeArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.5, 0xf0f0ed, 0.08, 0.05); probeArrow.visible = false; probeArrow.renderOrder = 6; scene.add(probeArrow);
    (probeArrow.line.material as THREE.LineBasicMaterial).depthTest = false; (probeArrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
    const probeEl = markEl("probe"); probeEl.style.display = "none";
    const probePos = new THREE.Vector3(); let probeOn = false;
    const measureAt = () => {
      // first a solid surface or the colour plane, else the point on the ray nearest the cabin centre
      const hits = ray.intersectObjects([...habScene.surfaces, slicePlane].filter((o) => o.visible), false);
      if (hits[0]) probePos.copy(hits[0].point).addScaledVector(ray.ray.direction, hits[0].object === slicePlane ? 0 : -dx * 0.6);
      else ray.ray.closestPointToPoint(new THREE.Vector3(lx / 2, ly / 2, lz / 2), probePos);
      probePos.set(Math.min(lx - 1e-3, Math.max(1e-3, probePos.x)), Math.min(ly - 1e-3, Math.max(1e-3, probePos.y)), Math.min(lz - 1e-3, Math.max(1e-3, probePos.z)));
      probeOn = true; updateProbe();
    };
    const updateProbe = () => {
      if (!probeOn || !live.current.probe) { probeArrow.visible = false; probeEl.style.display = "none"; return; }
      const [u, v, w2] = sim.velocity(probePos.x, probePos.y, probePos.z); const s = Math.hypot(u, v, w2);
      const [i, j, k] = sim.cellOf(probePos.x, probePos.y, probePos.z); const c = i + nx * (j + ny * k);
      const scale = 2.0; // metres of arrow per m/s
      if (s > 1e-5) { probeArrow.setDirection(new THREE.Vector3(u / s, v / s, w2 / s)); probeArrow.setLength(Math.max(0.06, s * scale), 0.07, 0.045); probeArrow.visible = true; } else probeArrow.visible = false;
      probeArrow.position.copy(probePos);
      const deg = s > 1e-5 ? (Math.acos(Math.max(-1, Math.min(1, v / s))) * 180) / Math.PI : 0;
      probeEl.style.display = "block";
      probeEl.innerHTML = `<i></i><span>|u| <b>${(s * 100).toFixed(2)} cm/s</b><br>u, v, w ${(u * 100).toFixed(1)}, ${(v * 100).toFixed(1)}, ${(w2 * 100).toFixed(1)} cm/s<br>angle from vertical ${deg.toFixed(0)}° · arrow ${(s * scale * 100).toFixed(0)} cm<br>T ${(sim.params.ambientC + sim.T[c]).toFixed(0)} °C · O₂ ${(sim.Y[c] * 100).toFixed(1)} %<br>at x ${probePos.x.toFixed(2)} y ${probePos.y.toFixed(2)} z ${probePos.z.toFixed(2)} m</span>`;
    };
    // room tags: every enterable zone of the base, clickable from any distance
    const tagP = new THREE.Vector3();
    const tags = entries.map((e) => {
      const el = document.createElement("button"); el.className = `room-tag${e.hab === hab.id ? " live" : ""}`; el.textContent = e.label; el.onclick = () => pickRef.current(e); overlay.appendChild(el);
      return { e, el };
    });
    const tagPos = (e: RoomEntry, out: THREE.Vector3) => {
      if (e.hab !== hab.id) { env.roomPos(e.room, out); out.y += 0.6 * env.k; return out; }
      const b = (hab.zones.find((z) => z.id === e.zone) ?? hab.zones[0]).box;
      return out.set(((b[0] - 1 + b[1]) / 2) * dx, b[3] * dx + 0.5, ((b[4] - 1 + b[5]) / 2) * dx);
    };
    // the fire seen from outside: a glow that shines through the hull, and a label
    const glowCv = document.createElement("canvas"); glowCv.width = glowCv.height = 64; { const gg = glowCv.getContext("2d")!; const gr = gg.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)"); gg.fillStyle = gr; gg.fillRect(0, 0, 64, 64); }
    const glowTex = new THREE.CanvasTexture(glowCv);
    const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, toneMapped: false })); beacon.visible = false; beacon.renderOrder = 8; scene.add(beacon);
    const fireEl = markEl("fire"); fireEl.style.display = "none";
    const pj = new THREE.Vector3();
    const place = (el: HTMLElement, p: THREE.Vector3) => { pj.copy(p).project(camera); el.style.transform = `translate(${((pj.x + 1) / 2) * mount.clientWidth}px, ${((1 - pj.y) / 2) * mount.clientHeight}px)`; if (pj.z > 1) el.style.display = "none"; };
    const drawOverlay = () => {
      const on = live.current.marks && sim.state !== "idle";
      for (const m of marksL) { m.el.style.display = on ? "block" : "none"; if (on) place(m.el, m.pos); }
      updateProbe(); if (probeEl.style.display !== "none") place(probeEl, probePos);
      const dist = camera.position.distanceTo(controls.target), far = dist > Math.max(lx, lz) * 1.6;
      for (const tg of tags) {
        const own = tg.e.hab === hab.id;
        tg.el.style.display = own && !far && hab.zones.length < 2 ? "none" : "block";
        tagPos(tg.e, tagP).project(camera); if (tagP.z > 1) { tg.el.style.display = "none"; continue; }
        tg.el.style.transform = `translate(${((tagP.x + 1) / 2) * mount.clientWidth}px, ${((1 - tagP.y) / 2) * mount.clientHeight}px) translate(-50%, -100%)`;
      }
      const burning = flameLight.intensity > 0;
      beacon.visible = burning && far; fireEl.style.display = burning && far ? "block" : "none";
      if (burning && far) {
        beacon.position.copy(flameLight.position); const dC = camera.position.distanceTo(flameLight.position);
        beacon.scale.setScalar(dC * (0.035 + 0.008 * Math.sin(performance.now() / 90))); (beacon.material as THREE.SpriteMaterial).color.copy(flameLight.color);
        fireEl.innerHTML = `<i></i><span>fire<b>${(sim.params.ambientC + sim.maxT).toFixed(0)} °C</b></span>`; place(fireEl, flameLight.position);
      }
      farNow = far;
    };
    let farNow = true;
    // fire-engineering readouts: smoke layer base (lowest level whose mean smoke exceeds the alarm level), smoke-filled volume, conditions at head height
    const layerStats = () => {
      const sumS = new Float64Array(ny), cnt = new Float64Array(ny); let vol = 0, gas = 0; const jh = Math.min(ny - 1, Math.floor(1.6 / dx)); let hT = 0, hO = 0, hS = 0, hn = 0;
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const c = i + nx * (j + ny * k); if (sim.solid[c]) continue;
        sumS[j] += sim.S[c]; cnt[j]++; gas++; if (sim.S[c] > ALARM) vol++;
        if (j === jh) { hT += sim.T[c]; hO += sim.Y[c]; hS += sim.S[c]; hn++; }
      }
      let layer: number | null = null;
      if (cnt[ny - 1] > 0 && sumS[ny - 1] / cnt[ny - 1] > ALARM) { let j = ny - 1; while (j > 0 && cnt[j - 1] > 0 && sumS[j - 1] / cnt[j - 1] > ALARM) j--; layer = j * dx; }
      return { layer, smokeVol: gas ? vol / gas : 0, headT: hn ? hT / hn : 0, headO2: hn ? hO / hn : sim.params.o2, headS: hn ? hS / hn : 0 };
    };

    // ---------------- loop
    let raf = 0, last = performance.now(), hudT = 0, simClock = 0, wallClock = 0, envT = 0;
    const DT = 0.06;
    const vfield = (x: number, y: number, z: number): [number, number, number] | null => sim.velocity(x, y, z);
    const blocked = (x: number, y: number, z: number) => sim.isSolidAt(x, y, z);
    const blue = new THREE.Color(0.25, 0.45, 1.0), yellow = new THREE.Color(1.0, 0.82, 0.45), orange = new THREE.Color(1.0, 0.42, 0.1), cA = new THREE.Color(), cB = new THREE.Color();
    const smokeLight = new THREE.Color(), smokeDark = new THREE.Color(), sootC = new THREE.Color(0x111111), cen = new THREE.Vector3();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dtw = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
      const Lv = live.current; let simDt = 0;
      if (!Lv.paused) {
        const t0 = performance.now();
        for (let k = 0; k < Lv.speed; k++) { sim.step(DT); simDt += DT; if (performance.now() - t0 > 28) break; }
        simClock += simDt; wallClock += dtw;
      }
      const P = sim.params;
      placePanel();
      upload(); volBox.visible = Lv.volume !== "off"; volMat.uniforms.uMode.value = Lv.volume === "smoke" ? 0 : 1; volMat.uniforms.uGain.value = 1;
      placeSlice(); placeArrows();
      streamLines.visible = Lv.stream; if (Lv.stream && (streamAt < 0 || sim.time - streamAt > 1)) { traceStream(); streamAt = sim.time; }

      // flame colour: sooty yellow under buoyancy, dim blue diffusion flame in microgravity
      const gmix = Math.min(1, Math.sqrt(P.gravity / 9.81) + Math.max(0, P.o2 - 0.21) * 1.2);
      cA.copy(blue).lerp(yellow, gmix); cB.copy(blue).lerp(orange, gmix * 0.9 + 0.1);
      flameP.setColors(cA, cB); flameP.setSize(0.07 + 0.05 * gmix, 0.03 + 0.04 * gmix);
      const s = sim.source; let total = 0; cen.set(0, 0, 0);
      if (s) {
        const n = s.n, mat = P.material;
        for (const f of sim.fuel) {
          if (f.state !== 1) continue;
          const x0 = sim.centre(f.i) - n[0] * dx * 0.45, y0 = sim.centre(f.j) - n[1] * dx * 0.45, z0 = sim.centre(f.k) - n[2] * dx * 0.45;
          total += f.rate; cen.x += x0 * f.rate; cen.y += y0 * f.rate; cen.z += z0 * f.rate;
          if (simDt <= 0) continue;
          const inten = Math.min(1.5, f.rate / 0.03) * f.ramp;
          if (Lv.flames) {
            const nF = Math.min(14, Math.round((1.5 + 5 * inten) * simDt / DT));
            const lift = P.gravity > 0 ? (0.1 + 0.6 * Math.sqrt(P.gravity / 9.81)) : 0;
            for (let q = 0; q < nF; q++) {
              const o = [(Math.random() - 0.5) * dx, (Math.random() - 0.5) * dx, (Math.random() - 0.5) * dx]; const off = 0.01 + Math.random() * 0.05;
              flameP.emit(x0 + n[0] * off + (n[0] ? 0 : o[0]), y0 + n[1] * off + (n[1] ? 0 : o[1]), z0 + n[2] * off + (n[2] ? 0 : o[2]),
                n[0] * 0.08, n[1] * 0.08 + lift, n[2] * 0.08, 0.22 + 0.28 * Math.random() * (0.4 + gmix));
            }
          }
          if (Lv.smoke) {
            const rate = f.rate * mat.smoke * 900 * simDt; const nS = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
            for (let q = 0; q < nS; q++) smokeP.emit(x0 + n[0] * dx * 0.7 + (Math.random() - 0.5) * dx, y0 + n[1] * dx * 0.7 + (Math.random() - 0.5) * dx, z0 + n[2] * dx * 0.7 + (Math.random() - 0.5) * dx, 0, 0, 0, 80 + Math.random() * 60);
          }
        }
      }
      if (simDt > 0) { smokeP.step(simDt, vfield, blocked, 0.012); flameP.step(simDt, vfield, blocked); }
      smokeP.points.visible = Lv.smoke; flameP.points.visible = Lv.flames;
      if (total > 0) { flameLight.position.copy(cen.multiplyScalar(1 / total)); flameLight.position.y += 0.15; flameLight.intensity = Math.min(4, total * 6); flameLight.color.copy(cB); }
      else flameLight.intensity = 0;
      smokeLight.setRGB(0.35, 0.16, 0.04).multiplyScalar(Math.min(1, total * 3)); smokeP.setLight(smokeLight, flameLight.position, 0.8);
      smokeDark.set(0x2f2d2b).lerp(sootC, Math.max(0, Math.min(1, P.material.soot - 0.4))); smokeP.setColors(smokeDark, 0x77736e);

      if (s) {
        panelData.fill(0);
        for (const f of sim.fuel) {
          const a = f.a + 8, b = f.b + 4; if (a < 0 || a > 16 || b < 0 || b > 8) continue; const o = (b * 17 + a) * 4;
          let r = 205, gg = 196, bb = 176;
          if (f.state === 2) { r = 26; gg = 24; bb = 22; } else if (f.state === 1) { const k = Math.min(1, f.rate / 0.03); r = 90 + 165 * k; gg = 40 + 80 * k; bb = 20; } else if (f.heat > 0) { const k = Math.min(1, f.heat / 0.2); r = 205 - 80 * k; gg = 196 - 110 * k; bb = 176 - 130 * k; }
          panelData[o] = r; panelData[o + 1] = gg; panelData[o + 2] = bb; panelData[o + 3] = 190;
        }
        panelTex.needsUpdate = true; (panel.material as THREE.MeshStandardMaterial).emissiveIntensity = total > 0 ? 0.35 : 0;
        (igniter.userData.hot as THREE.MeshStandardMaterial).emissiveIntensity = sim.state === "igniting" ? 4 : 0.05;
      }
      sim.detectors.forEach((d, q) => { const m = detMeshes[q].material as THREE.MeshStandardMaterial; m.emissive.set(d.alarmAt !== null ? (Math.floor(now / 400) % 2 ? 0xff3322 : 0x330000) : 0x000000); });

      envT += dtw; env.update(dtw, envT, camera);
      if (flight) {
        flight.t = Math.min(1, flight.t + dtw / 1.6); const e = flight.t < 0.5 ? 4 * flight.t ** 3 : 1 - (-2 * flight.t + 2) ** 3 / 2;
        camera.position.lerpVectors(flight.from.pos, flight.to.pos, e); controls.target.lerpVectors(flight.from.target, flight.to.target, e);
        if (flight.t >= 1) flight = null;
      }
      controls.update(); composer.render();
      drawOverlay();

      if (now - hudT > 250) {
        if (live.current.marks) findExtremes();
        hudT = now;
        setHud({
          ...layerStats(), far: farNow,
          t: s && sim.state !== "idle" ? sim.time - s.ignitedAt : 0, state: sim.state, hrr: sim.hrr, minO2: sim.minO2, maxT: sim.maxT, area: sim.burningArea, charred: sim.charredArea, dp: sim.dpPa,
          det: sim.detectors.map((d) => ({ id: d.id, label: d.label, alarmAt: d.alarmAt === null ? null : d.alarmAt - (s?.ignitedAt ?? 0), reading: d.reading })),
          div: sim.divMax, it: sim.pcgIters, cfl: (sim.maxSpeed * DT) / dx, ms: sim.stepMs, vmax: sim.maxSpeed, uref, range: curRange, sealed: sim.sealed, rate: wallClock > 0 ? simClock / wallClock : 0,
        });
        if (wallClock > 4) { simClock *= 0.5; wallClock *= 0.5; }
        drawSpark(document.getElementById("hrr") as HTMLCanvasElement | null, sim);
      }
    };
    raf = requestAnimationFrame(tick);
    (window as unknown as { __fa?: unknown }).__fa = { sim, api: api.current };
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      renderer.domElement.removeEventListener("wheel", onWheel); glowTex.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp);
      env.dispose(); overlay.remove(); habScene.dispose(); smokeP.dispose(); flameP.dispose(); pm.dispose(); controls.dispose(); composer.dispose(); renderer.dispose();
      mount.removeChild(renderer.domElement); simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hab]);
  return <div className="lab2-canvas" ref={mountRef} />;
}

function drawSpark(cv: HTMLCanvasElement | null, sim: CabinFire) {
  if (!cv) return;
  const g = cv.getContext("2d")!; const W = cv.width, H = cv.height; g.clearRect(0, 0, W, H);
  const h = sim.history.slice(-240); if (h.length < 2) return;
  const max = Math.max(0.05, ...h.map((q) => q.hrr));
  g.strokeStyle = "rgba(240,240,237,0.1)"; g.beginPath(); g.moveTo(0, H - 1); g.lineTo(W, H - 1); g.stroke();
  g.strokeStyle = "#ff8a3d"; g.lineWidth = 1.6; g.beginPath();
  h.forEach((q, i) => { const X = (i / (h.length - 1)) * W, Y = H - 3 - (q.hrr / max) * (H - 10); if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }); g.stroke();
  g.fillStyle = "#A7A9AA"; g.font = "11px ui-monospace, monospace"; g.fillText("burning rate", 4, 12);
}
