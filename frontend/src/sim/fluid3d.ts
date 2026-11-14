/**
 * Fire Lab habitat fire model — 3-D, low-Mach, on a uniform Cartesian grid with immersed solids.
 *
 *   ∂u/∂t + (u·∇)u = −∇p/ρ + g (ΔT/T) ŷ + f_vc                      (Boussinesq buoyancy, optional vorticity confinement)
 *   ∇·u = S,   S = (1/T) DT/Dt|_combustion                              (low-Mach thermal expansion of the burnt gas)
 *   ∂φ/∂t + (u·∇)φ = D(p) ∇²φ + S_φ ,  φ ∈ {ΔT, X_O2, X_CO2, smoke}
 *
 * Numerics (Stam "stable fluids" family): semi-Lagrangian advection of momentum, MacCormack (2nd order, clamped) advection
 * of scalars, red-black SOR pressure projection warm-started each step, cell-centred collocated grid.
 * Boundaries: free-slip walls; supply vents impose an inward velocity and the inflow composition; return vents are open
 * (p = 0, zero-gradient outflow). With the fans off the cabin is sealed: net expansion becomes a uniform pressure rise.
 *
 * Combustion: fuel panels on solid surfaces burn the O2 in excess of the material's limit in the surface cell and the gas
 * cell just off it (mixing-limited), releasing heat, CO2 and smoke; burning cells spread to neighbours (faster downstream
 * and uphill), are consumed when their fuel load is exhausted, and go out when the local burning rate stays below a
 * critical value (radiative-loss extinction). Constants reproduce the qualitative trends of NASA PSI data — this is an
 * educational model, not a validated fire code.
 */
import type { Box, Face, Habitat } from "./habitats";

export interface Material { id: string; label: string; limitO2: number; smoke: number; spread: number; load: number }
export const MATERIALS: Material[] = [
  { id: "pmma", label: "PMMA (acrylic)", limitO2: 0.175, smoke: 1.0, spread: 1.0, load: 2.0 },
  { id: "cotton", label: "Cotton fabric", limitO2: 0.18, smoke: 1.3, spread: 1.6, load: 2.0 },
  { id: "cable", label: "Cable insulation", limitO2: 0.2, smoke: 1.8, spread: 0.7, load: 2.4 },
  { id: "nomex", label: "Nomex", limitO2: 0.28, smoke: 0.7, spread: 0.5, load: 1.5 },
];

export interface Params {
  gravity: number; ventSpeed: number; o2: number; pressureKpa: number; material: Material; confinement: number;
}
export type FlameState = "idle" | "burning" | "extinguished" | "burnt-out";

// model constants
const T0 = 293;
const D_NUM = 0.8e-3;      // model diffusivity at 1 atm (m²/s) — includes unresolved turbulent mixing
const K_REACT = 6.0;
const HEAT = 6000;         // ΔT (K) per unit of O2 mole fraction consumed in a cell
const SMOKE = 60;
export const R_CRIT_DEFAULT = 0.008;
const COOL = 0.05;         // wall/radiative heat loss (1/s)
export const ALARM = 0.05;
const MAX_SOURCES = 4;

export interface FuelCell { c: number; i: number; j: number; k: number; src: number; a: number; b: number }
export interface Source { id: number; i: number; j: number; k: number; n: [number, number, number]; tu: 0 | 1 | 2; tv: 0 | 1 | 2; material: Material; ignitedAt: number; alive: boolean }
export interface Detector { id: string; label: string; zone: string; i: number; j: number; k: number; kind: "point" | "duct"; vent?: string; alarmAt: number | null; reading: number }
export interface Discharge { i: number; j: number; k: number; r: number; until: number; dir: [number, number, number] }
export interface ZoneStat { id: string; name: string; meanT: number; maxT: number; meanO2: number; meanCO2: number; smoke: number; volume: number }
export interface HistoryRow { t: number; hrr: number; minO2: number; dp: number; zones: ZoneStat[]; det: number[] }

export class StationFire {
  readonly hab: Habitat;
  readonly nx: number; readonly ny: number; readonly nz: number; readonly dx: number;
  readonly sx: number; readonly sy: number; readonly sz: number; readonly size: number;
  readonly lx: number; readonly ly: number; readonly lz: number;
  u: Float32Array; v: Float32Array; w: Float32Array; u0: Float32Array; v0: Float32Array; w0: Float32Array;
  p: Float32Array; div: Float32Array; tmp: Float32Array; tmp2: Float32Array; src: Float32Array;
  T: Float32Array; Y: Float32Array; C: Float32Array; S: Float32Array; burn: Float32Array; vort: Float32Array;
  /** 0 fluid, 1 solid or wall ghost (Neumann), 2 open ghost (Dirichlet p = 0) */
  kind: Uint8Array;
  solid: Uint8Array;
  doorOpen: Record<string, boolean> = {};
  params: Params;
  rCrit = R_CRIT_DEFAULT;
  time = 0; state: FlameState = "idle"; ignitedAt = 0;
  sources: Source[] = []; fuel: FuelCell[] = []; fire = new Set<number>(); char = new Set<number>();
  lowT = new Map<number, number>(); fuelUsed = new Map<number, number>();
  hrr = 0; peakT = 0; minO2 = 0.21; dp = 0; divResidual = 0; cfl = 0; maxSpeed = 0; kinetic = 0; stepMs = 0;
  detectors: Detector[];
  discharges: Discharge[] = [];
  history: HistoryRow[] = [];
  private faceCells: { face: Face; ghost: number; inner: number; vent: string | null }[] = [];

  constructor(hab: Habitat, params: Params) {
    this.hab = hab;
    this.nx = hab.nx; this.ny = hab.ny; this.nz = hab.nz; this.dx = hab.dx;
    this.sx = this.nx + 2; this.sy = this.ny + 2; this.sz = this.nz + 2; this.size = this.sx * this.sy * this.sz;
    this.lx = this.nx * this.dx; this.ly = this.ny * this.dx; this.lz = this.nz * this.dx;
    const F = () => new Float32Array(this.size);
    this.u = F(); this.v = F(); this.w = F(); this.u0 = F(); this.v0 = F(); this.w0 = F();
    this.p = F(); this.div = F(); this.tmp = F(); this.tmp2 = F(); this.src = F();
    this.T = F(); this.Y = F(); this.C = F(); this.S = F(); this.burn = F(); this.vort = F();
    this.kind = new Uint8Array(this.size); this.solid = new Uint8Array(this.size);
    this.params = { ...params };
    hab.doors.forEach((d) => (this.doorOpen[d.id] = d.openDefault));
    this.detectors = hab.detectors.map((d) => ({ ...d, alarmAt: null, reading: 0 }));
    this.buildFaces();
    this.rebuildSolids();
    this.reset();
  }

  IX(i: number, j: number, k: number) { return i + this.sx * (j + this.sy * k); }
  cellOf(x: number, y: number, z: number): [number, number, number] {
    const c = (v: number, n: number) => Math.max(1, Math.min(n, Math.floor(v / this.dx) + 1));
    return [c(x, this.nx), c(y, this.ny), c(z, this.nz)];
  }
  centre(i: number) { return (i - 0.5) * this.dx; }

  // ---------------------------------------------------------------- geometry
  private buildFaces() {
    const { nx, ny, nz } = this;
    const add = (face: Face, ghost: number, inner: number, a: number, b: number) => {
      const vent = this.hab.vents.find((v) => v.face === face && a >= v.a[0] && a <= v.a[1] && b >= v.b[0] && b <= v.b[1]);
      this.faceCells.push({ face, ghost, inner, vent: vent ? vent.id : null });
    };
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) { add("x0", this.IX(0, j, k), this.IX(1, j, k), j, k); add("x1", this.IX(nx + 1, j, k), this.IX(nx, j, k), j, k); }
    for (let k = 1; k <= nz; k++) for (let i = 1; i <= nx; i++) { add("y0", this.IX(i, 0, k), this.IX(i, 1, k), i, k); add("y1", this.IX(i, ny + 1, k), this.IX(i, ny, k), i, k); }
    for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { add("z0", this.IX(i, j, 0), this.IX(i, j, 1), i, j); add("z1", this.IX(i, j, nz + 1), this.IX(i, j, nz), i, j); }
  }

  ventById(id: string) { return this.hab.vents.find((v) => v.id === id); }
  private fansOn() { return this.params.ventSpeed > 0; }

  rebuildSolids() {
    const { nx, ny, nz } = this;
    this.solid.fill(0);
    const mark = (b: Box, val: number) => {
      for (let k = b[4]; k <= b[5]; k++) for (let j = b[2]; j <= b[3]; j++) for (let i = b[0]; i <= b[1]; i++) this.solid[this.IX(i, j, k)] = val;
    };
    for (const s of this.hab.solids) mark(s.box, 1);
    for (const d of this.hab.doors) if (this.doorOpen[d.id]) mark(d.box, 0);
    const cyl = this.hab.cylinder;
    if (cyl) for (let k = 1; k <= nz; k++) for (let i = 1; i <= nx; i++) {
      if ((i - cyl.cx) ** 2 + (k - cyl.cz) ** 2 > cyl.r * cyl.r) for (let j = 1; j <= ny; j++) this.solid[this.IX(i, j, k)] = 1;
    }
    // pressure-kind array
    this.kind.fill(1);
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
      const c = this.IX(i, j, k); this.kind[c] = this.solid[c] ? 1 : 0;
    }
    if (this.fansOn()) for (const f of this.faceCells) if (f.vent && this.ventById(f.vent)!.kind === "return") this.kind[f.ghost] = 2;
    for (let c = 0; c < this.size; c++) if (this.solid[c]) { this.u[c] = this.v[c] = this.w[c] = 0; }
    this.buildExtrapolation();
    this.solidList = Int32Array.from([...this.solid.keys()].filter((c) => this.solid[c]));
    this.sealed = !this.kind.includes(2);
  }
  solidList = new Int32Array(0); sealed = true;

  setDoor(id: string, open: boolean) { this.doorOpen[id] = open; this.rebuildSolids(); }

  setParams(p: Partial<Params>) {
    const wasOn = this.fansOn();
    this.params = { ...this.params, ...p };
    if (this.fansOn() !== wasOn) this.rebuildSolids();
  }

  reset() {
    for (const a of [this.u, this.v, this.w, this.p, this.T, this.C, this.S, this.burn, this.vort, this.src]) a.fill(0);
    this.Y.fill(this.params.o2);
    this.fire.clear(); this.fuel = []; this.sources = []; this.char.clear(); this.lowT.clear(); this.fuelUsed.clear(); this.discharges = [];
    this.time = 0; this.state = "idle"; this.hrr = 0; this.peakT = 0; this.minO2 = this.params.o2; this.dp = 0; this.history = [];
    this.detectors.forEach((d) => { d.alarmAt = null; d.reading = 0; });
  }

  // ---------------------------------------------------------------- fire sources
  /** Ignite a fuel panel on the solid surface behind fluid cell (i,j,k); n points from the surface into the gas. */
  ignite(i: number, j: number, k: number, n: [number, number, number], material?: Material): boolean {
    i = Math.max(1, Math.min(this.nx, Math.round(i))); j = Math.max(1, Math.min(this.ny, Math.round(j))); k = Math.max(1, Math.min(this.nz, Math.round(k)));
    if (this.solid[this.IX(i, j, k)]) { i += n[0]; j += n[1]; k += n[2]; }
    if (i < 1 || j < 1 || k < 1 || i > this.nx || j > this.ny || k > this.nz || this.solid[this.IX(i, j, k)]) return false;
    if (this.sources.length >= MAX_SOURCES) this.sources.shift();
    const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
    const tu = (axis === 0 ? 2 : 0) as 0 | 1 | 2, tv = (axis === 1 ? 2 : 1) as 0 | 1 | 2;
    const id = (this.sources.at(-1)?.id ?? -1) + 1;
    const mat = material ?? this.params.material;
    const s: Source = { id, i, j, k, n, tu, tv, material: mat, ignitedAt: this.time, alive: true };
    this.sources.push(s);
    // panel: 15 × 7 cells in the surface plane, keeping only gas cells that touch a solid/wall behind them
    const base = [i, j, k];
    for (let a = -7; a <= 7; a++) for (let b = -3; b <= 3; b++) {
      const q = [...base]; q[tu] += a; q[tv] += b;
      const [qi, qj, qk] = q;
      if (qi < 1 || qj < 1 || qk < 1 || qi > this.nx || qj > this.ny || qk > this.nz) continue;
      const c = this.IX(qi, qj, qk);
      if (this.solid[c]) continue;
      const behind = this.IX(qi - n[0], qj - n[1], qk - n[2]);
      const isBoundary = qi - n[0] < 1 || qj - n[1] < 1 || qk - n[2] < 1 || qi - n[0] > this.nx || qj - n[1] > this.ny || qk - n[2] > this.nz;
      if (!isBoundary && !this.solid[behind]) continue;
      if (this.fuel.some((f) => f.c === c)) continue;
      this.fuel.push({ c, i: qi, j: qj, k: qk, src: id, a, b });
      if (Math.abs(a) <= 1 && Math.abs(b) <= 0) { this.fire.add(c); this.char.delete(c); this.fuelUsed.set(c, 0); this.lowT.set(c, 0); }
    }
    if (this.state !== "burning") { this.state = "burning"; this.ignitedAt = this.time; }
    return true;
  }

  /** CO2 portable extinguisher: 2 kg-class discharge for `seconds` at a point, aimed along dir */
  discharge(x: number, y: number, z: number, dir: [number, number, number], seconds = 8) {
    const [i, j, k] = this.cellOf(x, y, z);
    this.discharges.push({ i, j, k, r: 0.55 / this.dx, until: this.time + seconds, dir });
  }

  // ---------------------------------------------------------------- boundaries
  private bndVel() {
    const { u, v, w } = this;
    const vs = this.params.ventSpeed;
    for (const f of this.faceCells) {
      const { ghost: g, inner: c, face } = f;
      u[g] = u[c]; v[g] = v[c]; w[g] = w[c];
      const arr = face[0] === "x" ? u : face[0] === "y" ? v : w;
      const sign = face[1] === "0" ? 1 : -1; // inward direction
      const vent = f.vent ? this.ventById(f.vent)! : null;
      if (vent && vs > 0 && vent.kind === "supply") { arr[g] = sign * vs; arr[c] = sign * vs; }
      else if (vent && vs > 0 && vent.kind === "return") { arr[g] = sign * Math.min(sign * arr[c], 0); }
      else arr[g] = -arr[c];
    }
    const sl = this.solidList; for (let n = 0; n < sl.length; n++) { const c = sl[n]; u[c] = 0; v[c] = 0; w[c] = 0; }
  }

  private bndScalar(x: Float32Array, inflow: number | null) {
    for (const f of this.faceCells) {
      const vent = f.vent ? this.ventById(f.vent)! : null;
      x[f.ghost] = vent && vent.kind === "supply" && inflow !== null && this.params.ventSpeed > 0 ? inflow : x[f.inner];
    }
  }

  /** keep solid-cell values equal to the mean of their gas neighbours so interpolation does not leak wall values */
  private exCells = new Int32Array(0); private exNb = new Int32Array(0); private exOff = new Int32Array(0);
  private buildExtrapolation() {
    const { sx, sy } = this; const dk = sx * sy; const cells: number[] = [], nbs: number[] = [], off: number[] = [0];
    for (let c = 0; c < this.size; c++) {
      if (!this.solid[c]) continue;
      const list = [1, -1, sx, -sx, dk, -dk].map((d) => c + d).filter((q) => q >= 0 && q < this.size && this.kind[q] === 0);
      if (!list.length) continue;
      cells.push(c); nbs.push(...list); off.push(nbs.length);
    }
    this.exCells = Int32Array.from(cells); this.exNb = Int32Array.from(nbs); this.exOff = Int32Array.from(off);
  }
  /** keep solid-cell values equal to the mean of their gas neighbours so interpolation does not leak wall values */
  private extrapolateSolids(x: Float32Array) {
    const { exCells, exNb, exOff } = this;
    for (let n = 0; n < exCells.length; n++) {
      let s = 0; const a = exOff[n], b = exOff[n + 1];
      for (let q = a; q < b; q++) s += x[exNb[q]];
      x[exCells[n]] = s / (b - a);
    }
  }

  // ---------------------------------------------------------------- operators
  private sample(f: Float32Array, x: number, y: number, z: number) {
    const { nx, ny, nz, sx, sy } = this;
    if (x < 0.5) x = 0.5; if (x > nx + 0.5) x = nx + 0.5;
    if (y < 0.5) y = 0.5; if (y > ny + 0.5) y = ny + 0.5;
    if (z < 0.5) z = 0.5; if (z > nz + 0.5) z = nz + 0.5;
    const i0 = x | 0, j0 = y | 0, k0 = z | 0, a = x - i0, b = y - j0, c = z - k0;
    const p = i0 + sx * (j0 + sy * k0), dj = sx, dk = sx * sy;
    const c00 = f[p] * (1 - a) + f[p + 1] * a, c10 = f[p + dj] * (1 - a) + f[p + dj + 1] * a;
    const c01 = f[p + dk] * (1 - a) + f[p + dk + 1] * a, c11 = f[p + dj + dk] * (1 - a) + f[p + dj + dk + 1] * a;
    return (c00 * (1 - b) + c10 * b) * (1 - c) + (c01 * (1 - b) + c11 * b) * c;
  }
  private mmLo = 0; private mmHi = 0;
  private sampleMinMax(f: Float32Array, x: number, y: number, z: number) {
    const { nx, ny, nz, sx, sy } = this;
    x = x < 0.5 ? 0.5 : x > nx + 0.5 ? nx + 0.5 : x; y = y < 0.5 ? 0.5 : y > ny + 0.5 ? ny + 0.5 : y; z = z < 0.5 ? 0.5 : z > nz + 0.5 ? nz + 0.5 : z;
    const p = (x | 0) + sx * ((y | 0) + sy * (z | 0)), dj = sx, dk = sx * sy;
    const a = f[p], b = f[p + 1], c = f[p + dj], d = f[p + dj + 1], e = f[p + dk], g = f[p + dk + 1], h = f[p + dj + dk], q = f[p + dj + dk + 1];
    this.mmLo = Math.min(a, b, c, d, e, g, h, q); this.mmHi = Math.max(a, b, c, d, e, g, h, q);
  }

  private advect(d: Float32Array, d0: Float32Array, dt: number, sign = 1) {
    const s = (sign * dt) / this.dx; const { u0, v0, w0, nx, ny, nz } = this;
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) {
      let c = this.IX(1, j, k);
      for (let i = 1; i <= nx; i++, c++) {
        if (this.solid[c]) { d[c] = d0[c]; continue; }
        d[c] = this.sample(d0, i - s * u0[c], j - s * v0[c], k - s * w0[c]);
      }
    }
  }

  /** MacCormack: forward + backward semi-Lagrangian with error correction and min/max clamping (Selle et al. 2008) */
  private advectMacCormack(f: Float32Array, dt: number) {
    const fwd = this.tmp, back = this.tmp2;
    this.advect(fwd, f, dt, 1);
    this.advect(back, fwd, dt, -1);
    const s = dt / this.dx; const { u0, v0, w0, nx, ny, nz } = this;
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) {
      let c = this.IX(1, j, k);
      for (let i = 1; i <= nx; i++, c++) {
        if (this.solid[c]) continue;
        let val = fwd[c] + 0.5 * (f[c] - back[c]);
        this.sampleMinMax(f, i - s * u0[c], j - s * v0[c], k - s * w0[c]);
        if (val < this.mmLo || val > this.mmHi) val = fwd[c];
        back[c] = val;
      }
    }
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) {
      let c = this.IX(1, j, k);
      for (let i = 1; i <= nx; i++, c++) if (!this.solid[c]) f[c] = back[c];
    }
  }

  private nb(p: Float32Array, c: number, q: number, pc: number) { const t = this.kind[q]; return t === 0 ? p[q] : t === 2 ? 0 : pc; }

  private project(iters: number) {
    const { u, v, w, p, div, src, kind, nx, ny, nz, sx, sy, dx } = this;
    const dj = sx, dk = sx * sy, h2 = dx * dx;
    // net expansion must be absorbed by open boundaries; sealed cabin → remove the mean (uniform pressure rise)
    const open = !this.sealed;
    let meanS = 0, nfluid = 0;
    for (let c = 0; c < this.size; c++) if (kind[c] === 0) { meanS += src[c]; nfluid++; }
    meanS = nfluid ? meanS / nfluid : 0;
    const sub = open ? 0 : meanS;
    this.lastMeanS = meanS;
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) {
      let c = this.IX(1, j, k);
      for (let i = 1; i <= nx; i++, c++) {
        div[c] = kind[c] ? 0 : -0.5 * dx * (u[c + 1] - u[c - 1] + v[c + dj] - v[c - dj] + w[c + dk] - w[c - dk]) + h2 * (src[c] - sub);
      }
    }
    const omega = 1.72;
    for (let it = 0; it < iters; it++) for (let colour = 0; colour < 2; colour++) {
      for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) {
        const start = 1 + ((j + k + colour) & 1);
        let c = this.IX(start, j, k);
        for (let i = start; i <= nx; i += 2, c += 2) {
          if (kind[c]) continue;
          const pc = p[c];
          const s = this.nb(p, c, c - 1, pc) + this.nb(p, c, c + 1, pc) + this.nb(p, c, c - dj, pc) + this.nb(p, c, c + dj, pc) + this.nb(p, c, c - dk, pc) + this.nb(p, c, c + dk, pc);
          p[c] = pc + omega * ((div[c] + s) / 6 - pc);
        }
      }
    }
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) {
      let c = this.IX(1, j, k);
      for (let i = 1; i <= nx; i++, c++) {
        if (kind[c]) continue;
        const pc = p[c];
        u[c] -= (0.5 * (this.nb(p, c, c + 1, pc) - this.nb(p, c, c - 1, pc))) / dx;
        v[c] -= (0.5 * (this.nb(p, c, c + dj, pc) - this.nb(p, c, c - dj, pc))) / dx;
        w[c] -= (0.5 * (this.nb(p, c, c + dk, pc) - this.nb(p, c, c - dk, pc))) / dx;
      }
    }
  }
  lastMeanS = 0;

  private diffuse(x: Float32Array, D: number, dt: number) {
    const a = (D * dt) / (this.dx * this.dx);
    const t = this.tmp; t.set(x);
    const { sx, sy, kind, nx, ny, nz } = this; const dj = sx, dk = sx * sy;
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) {
      let c = this.IX(1, j, k);
      for (let i = 1; i <= nx; i++, c++) {
        if (kind[c]) continue;
        const tc = t[c], sd = this.solid;
        x[c] = tc + a * ((sd[c - 1] ? tc : t[c - 1]) + (sd[c + 1] ? tc : t[c + 1]) + (sd[c - dj] ? tc : t[c - dj]) + (sd[c + dj] ? tc : t[c + dj]) + (sd[c - dk] ? tc : t[c - dk]) + (sd[c + dk] ? tc : t[c + dk]) - 6 * tc);
      }
    }
  }

  /** |∇×u| (1/s) */
  computeVorticity() {
    const { u, v, w, vort, sx, sy, nx, ny, nz, dx } = this;
    const dj = sx, dk = sx * sy, h = 2 * dx;
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) {
      let c = this.IX(1, j, k);
      for (let i = 1; i <= nx; i++, c++) {
        if (this.solid[c]) { vort[c] = 0; continue; }
        const wx = (w[c + dj] - w[c - dj] - v[c + dk] + v[c - dk]) / h;
        const wy = (u[c + dk] - u[c - dk] - w[c + 1] + w[c - 1]) / h;
        const wz = (v[c + 1] - v[c - 1] - u[c + dj] + u[c - dj]) / h;
        vort[c] = Math.sqrt(wx * wx + wy * wy + wz * wz);
      }
    }
  }

  private confine(dt: number) {
    const eps = this.params.confinement; if (eps <= 0) return;
    this.computeVorticity();
    const { u, v, w, vort, sx, sy, nx, ny, nz, dx } = this;
    const dj = sx, dk = sx * sy, h = 2 * dx;
    for (let k = 2; k < nz; k++) for (let j = 2; j < ny; j++) {
      let c = this.IX(2, j, k);
      for (let i = 2; i < nx; i++, c++) {
        if (this.kind[c]) continue;
        let gx = (vort[c + 1] - vort[c - 1]) / h, gy = (vort[c + dj] - vort[c - dj]) / h, gz = (vort[c + dk] - vort[c - dk]) / h;
        const l = Math.hypot(gx, gy, gz) + 1e-6; gx /= l; gy /= l; gz /= l;
        const wx = (w[c + dj] - w[c - dj] - v[c + dk] + v[c - dk]) / h;
        const wy = (u[c + dk] - u[c - dk] - w[c + 1] + w[c - 1]) / h;
        const wz = (v[c + 1] - v[c - 1] - u[c + dj] + u[c - dj]) / h;
        u[c] += dt * eps * dx * (gy * wz - gz * wy);
        v[c] += dt * eps * dx * (gz * wx - gx * wz);
        w[c] += dt * eps * dx * (gx * wy - gy * wx);
      }
    }
  }

  // ---------------------------------------------------------------- step
  step(dt = 0.06) {
    const t0 = performance.now();
    const P = this.params;
    const { u, v, w, u0, v0, w0, T, Y, C, S, src } = this;
    const D = D_NUM * Math.sqrt(101.325 / Math.max(10, P.pressureKpa));

    // buoyancy: g ΔT / T
    if (P.gravity > 0) for (let c = 0; c < this.size; c++) if (T[c] !== 0 && !this.kind[c]) v[c] += (dt * P.gravity * T[c]) / (T0 + T[c]);
    this.extinguisherJets(dt);
    this.confine(dt);
    this.bndVel();
    u0.set(u); v0.set(v); w0.set(w);
    this.advect(u, u0, dt); this.advect(v, v0, dt); this.advect(w, w0, dt);
    this.bndVel();
    this.project(30);
    this.bndVel();

    // scalars
    u0.set(u); v0.set(v); w0.set(w);
    for (const [f, inflow, hi] of [[T, 0, 1], [Y, P.o2, 0], [C, 0, 0], [S, 0, 1]] as [Float32Array, number, number][]) {
      this.bndScalar(f, inflow); this.extrapolateSolids(f);
      if (hi) this.advectMacCormack(f, dt); else { this.tmp.set(f); this.advect(f, this.tmp, dt); }
      this.diffuse(f, D, dt);
      this.bndScalar(f, inflow);
    }
    const cool = Math.exp(-COOL * dt);
    for (let c = 0; c < this.size; c++) T[c] *= cool;
    this.applyDischarges(dt);

    // combustion
    src.fill(0); this.burn.fill(0);
    let total = 0;
    const standoff = new Map<number, number>();
    for (const s of this.sources) standoff.set(s.id, s.n[0] + this.sx * s.n[1] + this.sx * this.sy * s.n[2]);
    if (this.state === "burning") {
      const byCell = new Map<number, FuelCell>(); for (const f of this.fuel) byCell.set(f.c, f);
      for (const c of this.fire) {
        const fc = byCell.get(c); if (!fc) continue;
        const srcObj = this.sources.find((q) => q.id === fc.src)!;
        const lim = srcObj.material.limitO2;
        let r = 0;
        for (const cc of [c, c + standoff.get(fc.src)!]) {
          if (this.kind[cc]) continue;
          const ex = Y[cc] - lim; if (ex <= 0) continue;
          const consumed = ex * (1 - Math.exp(-K_REACT * dt));
          Y[cc] -= consumed; C[cc] += consumed;
          const dT = consumed * HEAT;
          T[cc] += dT; src[cc] += dT / dt / (T0 + T[cc]);     // low-Mach expansion source
          S[cc] += consumed * SMOKE * srcObj.material.smoke;
          r += consumed / dt;
        }
        this.burn[c] = r; total += r;
      }
      // spread on each panel (4-neighbourhood in the panel plane), faster downstream and uphill
      const add: number[] = [];
      for (const f of this.fuel) {
        if (this.fire.has(f.c) || this.char.has(f.c)) continue;
        const so = this.sources.find((q) => q.id === f.src)!;
        let drive = 0;
        for (const g of this.fuel) {
          if (g.src !== f.src || !this.fire.has(g.c)) continue;
          const da = f.a - g.a, db = f.b - g.b;
          if (Math.abs(da) + Math.abs(db) !== 1) continue;
          if (this.burn[g.c] < this.rCrit * 1.8) continue;
          const dir = [f.i - g.i, f.j - g.j, f.k - g.k];
          const along = Math.max(0, dir[0] * u[g.c] + dir[1] * v[g.c] + dir[2] * w[g.c]);
          const uphill = P.gravity > 0 ? Math.max(0, dir[1]) * 0.05 * Math.sqrt(P.gravity) : 0;
          drive += (0.06 + 9 * along + uphill) * Math.min(3, this.burn[g.c] / this.rCrit / 3);
        }
        if (drive > 0 && Math.random() < drive * so.material.spread * dt) add.push(f.c);
      }
      add.forEach((c) => { this.fire.add(c); this.fuelUsed.set(c, 0); });
      for (const c of [...this.fire]) {
        const fc = byCell.get(c)!; const mat = this.sources.find((q) => q.id === fc.src)!.material;
        const used = (this.fuelUsed.get(c) ?? 0) + this.burn[c] * dt; this.fuelUsed.set(c, used);
        if (used > mat.load) { this.fire.delete(c); this.char.add(c); continue; }
        const age = this.time - this.sources.find((q) => q.id === fc.src)!.ignitedAt;
        if (age > 3 && this.burn[c] < this.rCrit) {
          const lt = (this.lowT.get(c) ?? 0) + dt; this.lowT.set(c, lt);
          if (lt > 2) { this.fire.delete(c); this.char.add(c); }
        } else this.lowT.set(c, 0);
      }
      for (const s of this.sources) s.alive = this.fuel.some((f) => f.src === s.id && this.fire.has(f.c));
      if (this.fire.size === 0) {
        let usedTot = 0; for (const x of this.fuelUsed.values()) usedTot += x;
        this.state = usedTot > 0.5 * this.fuel.length * this.params.material.load ? "burnt-out" : "extinguished";
      }
    }
    this.hrr = total;
    this.time += dt;
    this.dp += this.sealed ? this.lastMeanS * dt : 0; // relative pressure rise when sealed

    this.diagnostics(dt);
    this.updateDetectors();
    if (!this.history.length || this.time - this.history[this.history.length - 1].t >= 0.5) {
      this.history.push({ t: this.time, hrr: total, minO2: this.minO2, dp: this.dp, zones: this.zoneStats(), det: this.detectors.map((d) => d.reading) });
      if (this.history.length > 2400) this.history.shift();
    }
    this.stepMs = performance.now() - t0;
  }

  private extinguisherJets(dt: number) {
    for (const d of this.discharges) {
      if (this.time > d.until) continue;
      const c = this.IX(d.i, d.j, d.k);
      if (this.kind[c]) continue;
      this.u[c] += d.dir[0] * 6 * dt; this.v[c] += d.dir[1] * 6 * dt; this.w[c] += d.dir[2] * 6 * dt;
    }
  }
  private applyDischarges(dt: number) {
    this.discharges = this.discharges.filter((d) => this.time <= d.until + 0.01);
    for (const d of this.discharges) {
      const R = Math.ceil(d.r);
      for (let k = d.k - R; k <= d.k + R; k++) for (let j = d.j - R; j <= d.j + R; j++) for (let i = d.i - R; i <= d.i + R; i++) {
        if (i < 1 || j < 1 || k < 1 || i > this.nx || j > this.ny || k > this.nz) continue;
        const r2 = (i - d.i) ** 2 + (j - d.j) ** 2 + (k - d.k) ** 2; if (r2 > d.r * d.r) continue;
        const c = this.IX(i, j, k); if (this.kind[c]) continue;
        const f = 1 - Math.exp(-1.6 * dt);     // CO2 displaces air (dilution towards pure CO2) and cools
        const dY = this.Y[c] * f; this.Y[c] -= dY; this.C[c] += f * (1 - this.C[c]);
        this.T[c] *= 1 - 0.8 * f;
      }
    }
  }

  private diagnostics(dt: number) {
    const { u, v, w, src, kind, sx, sy, nx, ny, nz, dx } = this;
    const dj = sx, dk = sx * sy;
    let res = 0, vmax = 0, ke = 0, n = 0, pk = 0, mo = this.params.o2;
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) {
      let c = this.IX(1, j, k);
      for (let i = 1; i <= nx; i++, c++) {
        if (kind[c]) continue;
        const d = (u[c + 1] - u[c - 1] + v[c + dj] - v[c - dj] + w[c + dk] - w[c - dk]) / (2 * dx) - src[c];
        res += d * d; n++;
        const s2 = u[c] * u[c] + v[c] * v[c] + w[c] * w[c]; ke += s2; if (s2 > vmax) vmax = s2;
        if (this.T[c] > pk) pk = this.T[c];
      }
    }
    for (const c of this.fire) if (this.Y[c] < mo) mo = this.Y[c];
    this.divResidual = Math.sqrt(res / Math.max(1, n));
    this.maxSpeed = Math.sqrt(vmax); this.cfl = (this.maxSpeed * dt) / dx;
    this.kinetic = (0.5 * ke) / Math.max(1, n); this.peakT = Math.max(this.peakT, pk); this.minO2 = this.state === "idle" ? this.params.o2 : mo;
  }

  private updateDetectors() {
    const fans = this.params.ventSpeed > 0;
    for (const d of this.detectors) {
      if (d.kind === "duct" && fans && d.vent) {
        // flow-weighted mean over the return grille
        let num = 0, den = 0;
        for (const f of this.faceCells) if (f.vent === d.vent) {
          const wt = Math.abs(f.face[0] === "x" ? this.u[f.inner] : f.face[0] === "y" ? this.v[f.inner] : this.w[f.inner]) + 0.002;
          num += wt * this.S[f.inner]; den += wt;
        }
        d.reading = den ? num / den : 0;
      } else d.reading = this.S[this.IX(d.i, d.j, d.k)];
      if (d.alarmAt === null && d.reading > ALARM && this.state !== "idle") d.alarmAt = this.time;
    }
  }

  // ---------------------------------------------------------------- queries (world coordinates in metres)
  at(f: Float32Array, x: number, y: number, z: number) { return this.sample(f, x / this.dx + 0.5, y / this.dx + 0.5, z / this.dx + 0.5); }
  velocity(x: number, y: number, z: number): [number, number, number] {
    const a = x / this.dx + 0.5, b = y / this.dx + 0.5, c = z / this.dx + 0.5;
    return [this.sample(this.u, a, b, c), this.sample(this.v, a, b, c), this.sample(this.w, a, b, c)];
  }
  isSolidAt(x: number, y: number, z: number) {
    if (x < 0 || y < 0 || z < 0 || x > this.lx || y > this.ly || z > this.lz) return true;
    const [i, j, k] = this.cellOf(x, y, z); return this.solid[this.IX(i, j, k)] === 1;
  }
  zoneStats(): ZoneStat[] {
    return this.hab.zones.map((z) => {
      let t = 0, y = 0, co2 = 0, s = 0, n = 0, tmax = 0;
      const [i0, i1, j0, j1, k0, k1] = z.box;
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const c = this.IX(i, j, k); if (this.solid[c]) continue;
        t += this.T[c]; y += this.Y[c]; co2 += this.C[c]; s += this.S[c]; n++; if (this.T[c] > tmax) tmax = this.T[c];
      }
      n = Math.max(1, n);
      return { id: z.id, name: z.name, meanT: t / n, maxT: tmax, meanO2: y / n, meanCO2: co2 / n, smoke: s / n, volume: n * this.dx ** 3 };
    });
  }
  /** CSV of the recorded history (one row per 0.5 s) */
  historyCsv(): string {
    const z = this.hab.zones, d = this.detectors;
    const head = ["t_s", "burning_rate", "min_O2_at_flame", "cabin_dp_rel", ...z.flatMap((q) => [`${q.id}_Tmean_C`, `${q.id}_Tmax_C`, `${q.id}_O2_pct`, `${q.id}_CO2_pct`, `${q.id}_smoke`]), ...d.map((q) => `det_${q.id}`)];
    const rows = this.history.map((h) => [h.t.toFixed(2), h.hrr.toFixed(5), (h.minO2 * 100).toFixed(3), h.dp.toExponential(3),
      ...h.zones.flatMap((s) => [(20 + s.meanT).toFixed(2), (20 + s.maxT).toFixed(1), (s.meanO2 * 100).toFixed(3), (s.meanCO2 * 100).toFixed(4), s.smoke.toFixed(5)]),
      ...h.det.map((r) => r.toFixed(5))].join(","));
    return [head.join(","), ...rows].join("\n");
  }
}

export const D_MODEL = D_NUM;
