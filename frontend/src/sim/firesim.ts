/**
 * FlameAtlas cabin-fire solver — 3-D low-Mach Navier–Stokes on a staggered (MAC) grid with immersed solids.
 *
 *   ∂u/∂t + (u·∇)u = −∇p/ρ + g (T − T∞)/T ŷ + f_vc             momentum, Boussinesq-type buoyancy (full ratio)
 *   ∇·u = S − S̄_sealed,   S = (1/T) (DT/Dt)_combustion          low-Mach expansion of the burnt gas
 *   ∂φ/∂t + (u·∇)φ = D(p) ∇²φ + ω_φ ,  φ ∈ {T, X_O2, X_CO2, smoke}
 *
 * Why the velocity vectors can be trusted:
 *  - velocities live on cell faces (MAC grid), so the discrete divergence is exact and solid walls are imposed face by face
 *    (zero normal velocity on every wall face, prescribed velocity on supply vents, p = 0 on open return vents);
 *  - the pressure Poisson equation is solved with conjugate gradients preconditioned by modified incomplete Cholesky
 *    (MIC(0)) until max |∇·u − S| < 5e-5 s⁻¹ — the residual is reported live, it is a measurement not a promise;
 *  - in a sealed cabin (fans off) the net expansion cannot leave: S̄ becomes a uniform thermodynamic pressure rise
 *    dP/dt = γ P S̄, reported in pascals.
 * Advection: semi-Lagrangian with RK2 back-tracing on the staggered grid; scalars use clamped MacCormack (2nd order).
 *
 * Combustion (one source): a fuel panel on a solid surface. Each fuel cell pyrolyses at a rate limited by its own fuel
 * supply (ramping up after ignition) and burns the oxygen above the material's limiting fraction in the adjacent gas
 * (mixing-limited). Heat, CO2 and smoke go into the gas; unburnt cells are pre-heated by burning neighbours — faster
 * with concurrent airflow and uphill under gravity — and ignite; cells go out when starved (radiative-loss extinction)
 * or when their fuel is used up. Constants reproduce the qualitative trends of NASA PSI data: educational, not a
 * validated fire code.
 */
import type { Box, Face, Habitat } from "./habitats";

export interface Material { id: string; label: string; limitO2: number; smoke: number; spread: number; load: number; rate: number; soot: number }
export const MATERIALS: Material[] = [
  { id: "pmma", label: "PMMA (acrylic)", limitO2: 0.175, smoke: 0.8, spread: 1.0, load: 3.0, rate: 1.0, soot: 0.5 },
  { id: "cotton", label: "Cotton fabric", limitO2: 0.18, smoke: 1.2, spread: 1.8, load: 1.6, rate: 1.4, soot: 0.6 },
  { id: "paper", label: "Paper / cardboard", limitO2: 0.17, smoke: 1.0, spread: 2.2, load: 1.0, rate: 1.6, soot: 0.5 },
  { id: "foam", label: "Polyurethane foam", limitO2: 0.165, smoke: 2.2, spread: 2.0, load: 2.0, rate: 1.7, soot: 1.0 },
  { id: "cable", label: "Cable insulation (PVC)", limitO2: 0.2, smoke: 1.9, spread: 0.7, load: 3.0, rate: 0.8, soot: 1.0 },
  { id: "velcro", label: "Velcro (nylon)", limitO2: 0.19, smoke: 1.1, spread: 1.2, load: 1.8, rate: 1.1, soot: 0.6 },
  { id: "nomex", label: "Nomex (fire-resistant)", limitO2: 0.28, smoke: 0.6, spread: 0.5, load: 2.0, rate: 0.6, soot: 0.4 },
];

export interface Params {
  gravity: number;        // m/s²
  ventSpeed: number;      // m/s at the supply vents (0 = fans off)
  ventReverse: boolean;   // swap supply and return
  o2: number;             // ambient O2 mole fraction
  pressureKpa: number;    // cabin pressure
  ambientC: number;       // cabin air temperature (°C)
  material: Material;
  fuelSize: number;       // half-width of the fuel panel in cells (panel = (2n+1) × (n+1))
  igniter: number;        // igniter power (relative, 0.5–2)
  confinement: number;    // vorticity confinement strength
}
export type FlameState = "idle" | "igniting" | "burning" | "extinguished" | "burnt-out";

const GAMMA = 1.4;
const D_REF = 1.2e-3;      // effective (sub-grid turbulent + molecular) diffusivity at 1 atm, m²/s
const K_MIX = 5.0;         // mixing rate in a flame cell (1/s)
const HEAT = 6000;         // K of temperature rise per unit O2 mole fraction consumed in a cell
const SMOKE = 55;
const COOL = 0.04;         // wall / radiative heat loss (1/s)
const R_CRIT = 0.006;      // burning rate below which a cell is quenched (O2 fraction / s)
const T_MAX = 1700;        // cap on cell temperature rise (K)
export const ALARM = 0.05;

export interface FuelCell { c: number; gas: number; gas2: number; i: number; j: number; k: number; a: number; b: number; state: 0 | 1 | 2; heat: number; used: number; ramp: number; low: number; rate: number }
export interface Detector { id: string; label: string; zone: string; c: number; kind: "point" | "duct"; vent?: string; alarmAt: number | null; reading: number }
export interface Source { i: number; j: number; k: number; n: [number, number, number]; tu: 0 | 1 | 2; tv: 0 | 1 | 2; ignitedAt: number }
export interface ZoneStat { id: string; name: string; meanT: number; maxT: number; meanO2: number; smoke: number }
export interface HistoryRow { t: number; hrr: number; minO2: number; maxT: number; dp: number; det: number[] }

/** face type: 0 free, 1 wall, 2 supply (fixed inflow), 3 open (p = 0 outside) */
type FaceKind = 0 | 1 | 2 | 3;

export class CabinFire {
  readonly hab: Habitat;
  readonly nx: number; readonly ny: number; readonly nz: number; readonly dx: number; readonly n: number;
  readonly lx: number; readonly ly: number; readonly lz: number;
  u: Float32Array; v: Float32Array; w: Float32Array; ut: Float32Array; vt: Float32Array; wt: Float32Array;
  fu: Uint8Array; fv: Uint8Array; fw: Uint8Array;
  T: Float32Array; Y: Float32Array; C: Float32Array; S: Float32Array; src: Float32Array; vort: Float32Array;
  P: Float64Array; private r: Float64Array; private z: Float64Array; private s: Float64Array; private q: Float64Array; private prec: Float64Array;
  private Ad: Float64Array; private Ax: Float64Array; private Ay: Float64Array; private Az: Float64Array;
  private tmp: Float32Array; private tmp2: Float32Array;
  /** cell-centred velocity (averaged from the faces), used for back-tracing */
  uc: Float32Array; vc: Float32Array; wc: Float32Array;
  /** fluid cells (lexicographic) and their 6 neighbours across free faces (index n = zero slot) */
  private fl = new Int32Array(0); private nbLo = new Int32Array(0); private nbHi = new Int32Array(0);
  solid: Uint8Array;
  doorOpen: Record<string, boolean> = {};
  params: Params;
  time = 0; state: FlameState = "idle";
  source: Source | null = null; fuel: FuelCell[] = [];
  hrr = 0; peakT = 0; maxT = 0; minO2 = 0.21; dpPa = 0; burningArea = 0; charredArea = 0;
  divMax = 0; pcgIters = 0; cfl = 0; maxSpeed = 0; stepMs = 0; sealed = true;
  detectors: Detector[]; history: HistoryRow[] = [];
  private supplyCells: { c: number; speed: number }[] = [];

  constructor(hab: Habitat, params: Params) {
    this.hab = hab; this.nx = hab.nx; this.ny = hab.ny; this.nz = hab.nz; this.dx = hab.dx; this.n = this.nx * this.ny * this.nz;
    this.lx = this.nx * this.dx; this.ly = this.ny * this.dx; this.lz = this.nz * this.dx;
    const { nx, ny, nz } = this;
    const nu = (nx + 1) * ny * nz, nv = nx * (ny + 1) * nz, nw = nx * ny * (nz + 1);
    this.u = new Float32Array(nu); this.v = new Float32Array(nv); this.w = new Float32Array(nw);
    this.ut = new Float32Array(nu); this.vt = new Float32Array(nv); this.wt = new Float32Array(nw);
    this.fu = new Uint8Array(nu); this.fv = new Uint8Array(nv); this.fw = new Uint8Array(nw);
    const F = () => new Float32Array(this.n), D = () => new Float64Array(this.n);
    this.T = F(); this.Y = F(); this.C = F(); this.S = F(); this.src = F(); this.vort = F(); this.tmp = F(); this.tmp2 = F();
    const D1 = () => new Float64Array(this.n + 1);
    this.P = D1(); this.r = D1(); this.z = D1(); this.s = D1(); this.q = D1(); this.prec = D1(); this.Ad = D(); this.Ax = D(); this.Ay = D(); this.Az = D();
    this.uc = F(); this.vc = F(); this.wc = F();
    this.solid = new Uint8Array(this.n);
    this.params = { ...params };
    hab.doors.forEach((d) => (this.doorOpen[d.id] = d.openDefault));
    this.detectors = hab.detectors.map((d) => ({ id: d.id, label: d.label, zone: d.zone, c: this.IX(Math.min(nx, d.i) - 1, Math.min(ny, d.j) - 1, Math.min(nz, d.k) - 1), kind: d.kind, vent: d.vent, alarmAt: null, reading: 0 }));
    this.rebuild();
    this.reset();
  }

  IX(i: number, j: number, k: number) { return i + this.nx * (j + this.ny * k); }
  IU(i: number, j: number, k: number) { return i + (this.nx + 1) * (j + this.ny * k); }
  IV(i: number, j: number, k: number) { return i + this.nx * (j + (this.ny + 1) * k); }
  IW(i: number, j: number, k: number) { return i + this.nx * (j + this.ny * k); }
  /** 0-based cell of a world point */
  cellOf(x: number, y: number, z: number): [number, number, number] {
    const c = (v: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(v / this.dx)));
    return [c(x, this.nx), c(y, this.ny), c(z, this.nz)];
  }
  centre(i: number) { return (i + 0.5) * this.dx; }
  isSolidCell(i: number, j: number, k: number) { return i < 0 || j < 0 || k < 0 || i >= this.nx || j >= this.ny || k >= this.nz || this.solid[this.IX(i, j, k)] === 1; }
  isSolidAt(x: number, y: number, z: number) {
    if (x < 0 || y < 0 || z < 0 || x > this.lx || y > this.ly || z > this.lz) return true;
    const [i, j, k] = this.cellOf(x, y, z); return this.solid[this.IX(i, j, k)] === 1;
  }

  // ------------------------------------------------------------------ geometry and boundary conditions
  private fansOn() { return this.params.ventSpeed > 0; }
  private ventRole(kind: "supply" | "return"): "supply" | "return" { return this.params.ventReverse ? (kind === "supply" ? "return" : "supply") : kind; }

  rebuild() {
    const { nx, ny, nz, hab } = this;
    this.solid.fill(0);
    const mark = (b: Box, val: 0 | 1) => {
      for (let k = b[4] - 1; k < b[5]; k++) for (let j = b[2] - 1; j < b[3]; j++) for (let i = b[0] - 1; i < b[1]; i++)
        if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) this.solid[this.IX(i, j, k)] = val;
    };
    for (const s of hab.solids) mark(s.box, 1);
    for (const d of hab.doors) if (this.doorOpen[d.id]) mark(d.box, 0);
    const cyl = hab.cylinder;
    if (cyl) for (let j = 0; j < ny; j++) {
      const r = cyl.rTop !== undefined ? cyl.r + (cyl.rTop - cyl.r) * ((j + 0.5) / ny) : cyl.r;
      for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if ((i + 1 - cyl.cx) ** 2 + (k + 1 - cyl.cz) ** 2 > r * r) this.solid[this.IX(i, j, k)] = 1;
    }
    // faces
    const S = this.solid, fans = this.fansOn(), vs = this.params.ventSpeed;
    this.fu.fill(1); this.fv.fill(1); this.fw.fill(1);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) if (!S[this.IX(i - 1, j, k)] && !S[this.IX(i, j, k)]) this.fu[this.IU(i, j, k)] = 0;
    for (let k = 0; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) if (!S[this.IX(i, j - 1, k)] && !S[this.IX(i, j, k)]) this.fv[this.IV(i, j, k)] = 0;
    for (let k = 1; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!S[this.IX(i, j, k - 1)] && !S[this.IX(i, j, k)]) this.fw[this.IW(i, j, k)] = 0;
    this.supplyCells = [];
    let open = false;
    if (fans) for (const vt of hab.vents) {
      const role = this.ventRole(vt.kind);
      for (let a = vt.a[0] - 1; a < vt.a[1]; a++) for (let b = vt.b[0] - 1; b < vt.b[1]; b++) {
        const f = this.boundaryFace(vt.face, a, b); if (!f) continue;
        const [arr, idx, cell, inward] = f;
        if (S[cell]) continue;
        if (role === "supply") { arr === "u" ? (this.fu[idx] = 2, this.u[idx] = inward * vs) : arr === "v" ? (this.fv[idx] = 2, this.v[idx] = inward * vs) : (this.fw[idx] = 2, this.w[idx] = inward * vs); this.supplyCells.push({ c: cell, speed: vs }); }
        else { arr === "u" ? (this.fu[idx] = 3) : arr === "v" ? (this.fv[idx] = 3) : (this.fw[idx] = 3); open = true; }
      }
    }
    this.sealed = !open;
    // zero velocity on walls
    for (let q = 0; q < this.u.length; q++) if (this.fu[q] === 1) this.u[q] = 0;
    for (let q = 0; q < this.v.length; q++) if (this.fv[q] === 1) this.v[q] = 0;
    for (let q = 0; q < this.w.length; q++) if (this.fw[q] === 1) this.w[q] = 0;
    this.buildMatrix();
  }

  /** boundary face for vent cell (a, b) on a domain face: [array, face index, adjacent cell, inward sign] */
  private boundaryFace(face: Face, a: number, b: number): ["u" | "v" | "w", number, number, number] | null {
    const { nx, ny, nz } = this;
    switch (face) {
      case "x0": return a < ny && b < nz ? ["u", this.IU(0, a, b), this.IX(0, a, b), 1] : null;
      case "x1": return a < ny && b < nz ? ["u", this.IU(nx, a, b), this.IX(nx - 1, a, b), -1] : null;
      case "y0": return a < nx && b < nz ? ["v", this.IV(a, 0, b), this.IX(a, 0, b), 1] : null;
      case "y1": return a < nx && b < nz ? ["v", this.IV(a, ny, b), this.IX(a, ny - 1, b), -1] : null;
      case "z0": return a < nx && b < ny ? ["w", this.IW(a, b, 0), this.IX(a, b, 0), 1] : null;
      case "z1": return a < nx && b < ny ? ["w", this.IW(a, b, nz), this.IX(a, b, nz - 1), -1] : null;
    }
  }

  /** Poisson matrix (scaled by dx²): A P_c = Σ_faces (P_c − P_nb), P_nb = 0 across open faces; MIC(0) preconditioner */
  private buildMatrix() {
    const { nx, ny, nz } = this; const S = this.solid;
    this.Ad.fill(0); this.Ax.fill(0); this.Ay.fill(0); this.Az.fill(0);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = this.IX(i, j, k); if (S[c]) continue;
      let d = 0;
      const fl = this.fu[this.IU(i, j, k)], fr = this.fu[this.IU(i + 1, j, k)], fd = this.fv[this.IV(i, j, k)], fu_ = this.fv[this.IV(i, j + 1, k)], fb = this.fw[this.IW(i, j, k)], ff = this.fw[this.IW(i, j, k + 1)];
      for (const f of [fl, fr, fd, fu_, fb, ff]) if (f === 0 || f === 3) d++;
      this.Ad[c] = d;
      if (fr === 0) this.Ax[c] = -1; if (fu_ === 0) this.Ay[c] = -1; if (ff === 0) this.Az[c] = -1;
    }
    const fl: number[] = [];
    for (let c = 0; c < this.n; c++) if (!S[c] && this.Ad[c] > 0) fl.push(c);
    this.fl = Int32Array.from(fl);
    const lo = new Int32Array(fl.length * 3).fill(this.n), hi = new Int32Array(fl.length * 3).fill(this.n);
    fl.forEach((c, q) => {
      const i = c % nx, j = Math.floor(c / nx) % ny, k = Math.floor(c / (nx * ny));
      if (this.Ax[c] !== 0) hi[q * 3] = c + 1; if (this.Ay[c] !== 0) hi[q * 3 + 1] = c + nx; if (this.Az[c] !== 0) hi[q * 3 + 2] = c + nx * ny;
      if (i > 0 && this.Ax[c - 1] !== 0) lo[q * 3] = c - 1; if (j > 0 && this.Ay[c - nx] !== 0) lo[q * 3 + 1] = c - nx; if (k > 0 && this.Az[c - nx * ny] !== 0) lo[q * 3 + 2] = c - nx * ny;
    });
    this.nbLo = lo; this.nbHi = hi;
    // connected gas regions: a closed hatch splits the cabin, and each region without an open vent must satisfy
    // the compatibility condition of its own Neumann problem (its own mean expansion, its own pressure rise)
    if (this.comp.length !== this.n) this.comp = new Int32Array(this.n);
    const comp = this.comp; comp.fill(-1); const closed: number[] = []; const stack: number[] = [];
    for (const c0 of fl) {
      if (comp[c0] >= 0) continue;
      const id = closed.length; let isOpen = false; comp[c0] = id; stack.push(c0);
      while (stack.length) {
        const c = stack.pop()!; const i = c % nx, j = Math.floor(c / nx) % ny, k = Math.floor(c / (nx * ny));
        const faces = [this.fu[this.IU(i, j, k)], this.fu[this.IU(i + 1, j, k)], this.fv[this.IV(i, j, k)], this.fv[this.IV(i, j + 1, k)], this.fw[this.IW(i, j, k)], this.fw[this.IW(i, j, k + 1)]];
        const nb = [c - 1, c + 1, c - nx, c + nx, c - nx * ny, c + nx * ny];
        for (let f = 0; f < 6; f++) { if (faces[f] === 3) isOpen = true; else if (faces[f] === 0 && comp[nb[f]] < 0) { comp[nb[f]] = id; stack.push(nb[f]); } }
      }
      closed.push(isOpen ? 0 : 1);
    }
    this.compClosed = Uint8Array.from(closed); this.compSum = new Float64Array(closed.length); this.compN = new Float64Array(closed.length); this.compSrc = new Float64Array(closed.length);
    // MIC(0), tau = 0.97 (Bridson)
    const tau = 0.97, sigma = 0.25; const pr = this.prec; pr.fill(0);
    const sx = 1, sy = nx, sz = nx * ny;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = this.IX(i, j, k); if (S[c] || this.Ad[c] === 0) continue;
      const pi = i > 0 ? pr[c - sx] : 0, pj = j > 0 ? pr[c - sy] : 0, pk = k > 0 ? pr[c - sz] : 0;
      const axi = i > 0 ? this.Ax[c - sx] : 0, ayj = j > 0 ? this.Ay[c - sy] : 0, azk = k > 0 ? this.Az[c - sz] : 0;
      let e = this.Ad[c] - (axi * pi) ** 2 - (ayj * pj) ** 2 - (azk * pk) ** 2
        - tau * (axi * (i > 0 ? this.Ay[c - sx] + this.Az[c - sx] : 0) * pi * pi + ayj * (j > 0 ? this.Ax[c - sy] + this.Az[c - sy] : 0) * pj * pj + azk * (k > 0 ? this.Ax[c - sz] + this.Ay[c - sz] : 0) * pk * pk);
      if (e < sigma * this.Ad[c]) e = this.Ad[c];
      pr[c] = 1 / Math.sqrt(e);
    }
  }

  setDoor(id: string, open: boolean) { this.doorOpen[id] = open; this.rebuild(); this.relocateFuel(); }
  setParams(p: Partial<Params>) {
    const rebuildBC = (p.ventSpeed !== undefined && (p.ventSpeed > 0) !== this.fansOn()) || (p.ventReverse !== undefined && p.ventReverse !== this.params.ventReverse) || (p.ventSpeed !== undefined && p.ventSpeed !== this.params.ventSpeed);
    this.params = { ...this.params, ...p };
    if (rebuildBC) this.rebuild();
  }

  reset() {
    for (const a of [this.u, this.v, this.w, this.T, this.C, this.S, this.src, this.vort]) a.fill(0);
    this.P.fill(0);
    this.Y.fill(this.params.o2);
    this.rebuild();
    this.time = 0; this.state = "idle"; this.hrr = 0; this.peakT = 0; this.maxT = 0; this.minO2 = this.params.o2; this.dpPa = 0; this.history = [];
    this.burningArea = 0; this.charredArea = 0;
    this.fuel = []; this.source = null;
    this.detectors.forEach((d) => { d.alarmAt = null; d.reading = 0; });
  }

  // ------------------------------------------------------------------ fire source (single)
  /**
   * Place the fuel panel on the solid surface behind gas cell (i, j, k) (0-based); n points from the surface into the gas.
   * Replaces any previous source. Returns false if no surface is there.
   */
  placeSource(i: number, j: number, k: number, n: [number, number, number]): boolean {
    const { nx, ny, nz } = this;
    i = Math.max(0, Math.min(nx - 1, Math.round(i))); j = Math.max(0, Math.min(ny - 1, Math.round(j))); k = Math.max(0, Math.min(nz - 1, Math.round(k)));
    if (this.solid[this.IX(i, j, k)]) { i += n[0]; j += n[1]; k += n[2]; }
    if (this.isSolidCell(i, j, k)) return false;
    const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
    const tu = (axis === 0 ? 2 : 0) as 0 | 1 | 2, tv = (axis === 1 ? 2 : 1) as 0 | 1 | 2;
    this.source = { i, j, k, n, tu, tv, ignitedAt: this.time };
    this.relocateFuel();
    return this.fuel.length > 0;
  }

  private relocateFuel() {
    const s = this.source; if (!s) return;
    const half = Math.max(2, Math.round(this.params.fuelSize)), halfV = Math.max(1, Math.round(half / 2));
    const out: FuelCell[] = [];
    for (let a = -half; a <= half; a++) for (let b = -halfV; b <= halfV; b++) {
      const q = [s.i, s.j, s.k]; q[s.tu] += a; q[s.tv] += b;
      const [qi, qj, qk] = q;
      if (this.isSolidCell(qi, qj, qk)) continue;
      if (!this.isSolidCell(qi - s.n[0], qj - s.n[1], qk - s.n[2])) continue; // must sit on a surface
      const c = this.IX(qi, qj, qk);
      const g2 = this.isSolidCell(qi + s.n[0], qj + s.n[1], qk + s.n[2]) ? c : this.IX(qi + s.n[0], qj + s.n[1], qk + s.n[2]);
      const prev = this.fuel.find((f) => f.c === c);
      out.push(prev ?? { c, gas: c, gas2: g2, i: qi, j: qj, k: qk, a, b, state: 0, heat: 0, used: 0, ramp: 0, low: 0, rate: 0 });
    }
    this.fuel = out;
  }

  /** start the igniter on the current source (or the habitat default) */
  ignite() {
    if (!this.source) { const g = this.hab.ignition; this.placeSource(g.i - 1, g.j - 1, g.k - 1, g.n); }
    const s = this.source!; s.ignitedAt = this.time;
    for (const f of this.fuel) { f.state = 0; f.heat = 0; f.used = 0; f.ramp = 0; f.low = 0; f.rate = 0; }
    const centre = this.fuel.reduce((best, f) => (Math.abs(f.a) + Math.abs(f.b) < Math.abs(best.a) + Math.abs(best.b) ? f : best), this.fuel[0]);
    if (centre) { centre.state = 1; centre.ramp = 0.05; }
    this.state = "igniting";
  }

  // ------------------------------------------------------------------ interpolation (world coordinates, metres)
  private trilerp(f: Float32Array, gx: number, gy: number, gz: number, mx: number, my: number, mz: number, sx: number, sy: number) {
    gx = gx < 0 ? 0 : gx > mx ? mx : gx; gy = gy < 0 ? 0 : gy > my ? my : gy; gz = gz < 0 ? 0 : gz > mz ? mz : gz;
    let i = gx | 0, j = gy | 0, k = gz | 0; if (i >= mx) i = mx - 1; if (j >= my) j = my - 1; if (k >= mz) k = mz - 1;
    if (i < 0) i = 0; if (j < 0) j = 0; if (k < 0) k = 0;
    const a = gx - i, b = gy - j, c = gz - k;
    const p = i + sx * (j + sy * k), dj = sx, dk = sx * sy;
    const one = mx > 0 ? 1 : 0, oj = my > 0 ? dj : 0, ok = mz > 0 ? dk : 0;
    const c00 = f[p] * (1 - a) + f[p + one] * a, c10 = f[p + oj] * (1 - a) + f[p + oj + one] * a;
    const c01 = f[p + ok] * (1 - a) + f[p + ok + one] * a, c11 = f[p + oj + ok] * (1 - a) + f[p + oj + ok + one] * a;
    return (c00 * (1 - b) + c10 * b) * (1 - c) + (c01 * (1 - b) + c11 * b) * c;
  }
  uAt(x: number, y: number, z: number, U = this.u) { const h = this.dx; return this.trilerp(U, x / h, y / h - 0.5, z / h - 0.5, this.nx, this.ny - 1, this.nz - 1, this.nx + 1, this.ny); }
  vAt(x: number, y: number, z: number, V = this.v) { const h = this.dx; return this.trilerp(V, x / h - 0.5, y / h, z / h - 0.5, this.nx - 1, this.ny, this.nz - 1, this.nx, this.ny + 1); }
  wAt(x: number, y: number, z: number, W = this.w) { const h = this.dx; return this.trilerp(W, x / h - 0.5, y / h - 0.5, z / h, this.nx - 1, this.ny - 1, this.nz, this.nx, this.ny); }
  velocity(x: number, y: number, z: number): [number, number, number] { return [this.uAt(x, y, z), this.vAt(x, y, z), this.wAt(x, y, z)]; }
  at(f: Float32Array, x: number, y: number, z: number) { const h = this.dx; return this.trilerp(f, x / h - 0.5, y / h - 0.5, z / h - 0.5, this.nx - 1, this.ny - 1, this.nz - 1, this.nx, this.ny); }

  // ------------------------------------------------------------------ step
  step(dt = 0.05) {
    const t0 = performance.now();
    const P = this.params, T0 = 273.15 + P.ambientC;
    this.addForces(dt, T0);
    this.advectVelocity(dt);
    this.combust(dt, T0);
    this.project();
    this.advectScalars(dt);
    // losses and bookkeeping
    const cool = Math.exp(-COOL * dt);
    let mx = 0;
    for (let c = 0; c < this.n; c++) { if (this.solid[c]) continue; this.T[c] *= cool; if (this.T[c] > mx) mx = this.T[c]; }
    this.maxT = mx; this.peakT = Math.max(this.peakT, mx);
    this.sealed = this.meanSrc !== 0 || !this.fansOn(); if (this.sealed) this.dpPa += GAMMA * P.pressureKpa * 1000 * this.meanSrc * dt;
    else this.dpPa *= Math.exp(-dt / 2);
    this.time += dt;
    this.updateDetectors();
    if (!this.history.length || this.time - this.history[this.history.length - 1].t >= 0.5) {
      this.history.push({ t: this.time, hrr: this.hrr, minO2: this.minO2, maxT: this.maxT, dp: this.dpPa, det: this.detectors.map((d) => d.reading) });
      if (this.history.length > 2400) this.history.shift();
    }
    this.stepMs = performance.now() - t0;
  }

  private addForces(dt: number, T0: number) {
    const { nx, ny, nz } = this; const g = this.params.gravity;
    if (g > 0) for (let k = 0; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) {
      const f = this.IV(i, j, k); if (this.fv[f]) continue;
      const th = 0.5 * (this.T[this.IX(i, j - 1, k)] + this.T[this.IX(i, j, k)]);
      if (th !== 0) this.v[f] += (dt * g * th) / (T0 + th);
    }
    if (this.params.confinement > 0) this.confine(dt);
  }

  /** cell-centred vorticity magnitude */
  computeVorticity() {
    const { nx, ny, nz, dx } = this; const h = 2 * dx;
    const uc = (i: number, j: number, k: number) => 0.5 * (this.u[this.IU(i, j, k)] + this.u[this.IU(i + 1, j, k)]);
    const vc = (i: number, j: number, k: number) => 0.5 * (this.v[this.IV(i, j, k)] + this.v[this.IV(i, j + 1, k)]);
    const wc = (i: number, j: number, k: number) => 0.5 * (this.w[this.IW(i, j, k)] + this.w[this.IW(i, j, k + 1)]);
    this.vort.fill(0);
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const c = this.IX(i, j, k); if (this.solid[c]) continue;
      const wx = (wc(i, j + 1, k) - wc(i, j - 1, k) - vc(i, j, k + 1) + vc(i, j, k - 1)) / h;
      const wy = (uc(i, j, k + 1) - uc(i, j, k - 1) - wc(i + 1, j, k) + wc(i - 1, j, k)) / h;
      const wz = (vc(i + 1, j, k) - vc(i - 1, j, k) - uc(i, j + 1, k) + uc(i, j - 1, k)) / h;
      this.vort[c] = Math.hypot(wx, wy, wz);
      this.tmp[c] = wx; this.tmp2[c] = wy; this.src[c] = wz; // scratch (src is rebuilt in combust)
    }
  }
  private confine(dt: number) {
    this.computeVorticity();
    const { nx, ny, nz, dx } = this; const eps = this.params.confinement; const h = 2 * dx;
    const fx = new Float32Array(this.n), fy = new Float32Array(this.n), fz = new Float32Array(this.n);
    for (let k = 2; k < nz - 2; k++) for (let j = 2; j < ny - 2; j++) for (let i = 2; i < nx - 2; i++) {
      const c = this.IX(i, j, k); if (this.solid[c]) continue;
      let gx = (this.vort[c + 1] - this.vort[c - 1]) / h, gy = (this.vort[c + nx] - this.vort[c - nx]) / h, gz = (this.vort[c + nx * ny] - this.vort[c - nx * ny]) / h;
      const l = Math.hypot(gx, gy, gz) + 1e-9; gx /= l; gy /= l; gz /= l;
      const wx = this.tmp[c], wy = this.tmp2[c], wz = this.src[c];
      fx[c] = eps * dx * (gy * wz - gz * wy); fy[c] = eps * dx * (gz * wx - gx * wz); fz[c] = eps * dx * (gx * wy - gy * wx);
    }
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 1; i < nx; i++) { const f = this.IU(i, j, k); if (!this.fu[f]) this.u[f] += dt * 0.5 * (fx[this.IX(i - 1, j, k)] + fx[this.IX(i, j, k)]); }
    for (let k = 0; k < nz; k++) for (let j = 1; j < ny; j++) for (let i = 0; i < nx; i++) { const f = this.IV(i, j, k); if (!this.fv[f]) this.v[f] += dt * 0.5 * (fy[this.IX(i, j - 1, k)] + fy[this.IX(i, j, k)]); }
    for (let k = 1; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const f = this.IW(i, j, k); if (!this.fw[f]) this.w[f] += dt * 0.5 * (fz[this.IX(i, j, k - 1)] + fz[this.IX(i, j, k)]); }
    this.src.fill(0);
  }

  /** face → cell-centre velocity */
  private centreVelocity() {
    const { nx, ny, nz } = this;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = this.IX(i, j, k);
      this.uc[c] = 0.5 * (this.u[this.IU(i, j, k)] + this.u[this.IU(i + 1, j, k)]);
      this.vc[c] = 0.5 * (this.v[this.IV(i, j, k)] + this.v[this.IV(i, j + 1, k)]);
      this.wc[c] = 0.5 * (this.w[this.IW(i, j, k)] + this.w[this.IW(i, j, k + 1)]);
    }
  }
  private cv: [number, number, number] = [0, 0, 0];
  /** trilinear cell-centred velocity (one weight computation for the three components) */
  private velC(x: number, y: number, z: number) {
    const { nx, ny, nz } = this; const h = this.dx;
    let gx = x / h - 0.5, gy = y / h - 0.5, gz = z / h - 0.5;
    gx = gx < 0 ? 0 : gx > nx - 1 ? nx - 1 : gx; gy = gy < 0 ? 0 : gy > ny - 1 ? ny - 1 : gy; gz = gz < 0 ? 0 : gz > nz - 1 ? nz - 1 : gz;
    let i = gx | 0, j = gy | 0, k = gz | 0; if (i > nx - 2) i = Math.max(0, nx - 2); if (j > ny - 2) j = Math.max(0, ny - 2); if (k > nz - 2) k = Math.max(0, nz - 2);
    const a = gx - i, b = gy - j, c = gz - k;
    const p = i + nx * (j + ny * k), dj = nx, dk = nx * ny;
    const w000 = (1 - a) * (1 - b) * (1 - c), w100 = a * (1 - b) * (1 - c), w010 = (1 - a) * b * (1 - c), w110 = a * b * (1 - c);
    const w001 = (1 - a) * (1 - b) * c, w101 = a * (1 - b) * c, w011 = (1 - a) * b * c, w111 = a * b * c;
    const U = this.uc, V = this.vc, W = this.wc, o = this.cv;
    o[0] = U[p] * w000 + U[p + 1] * w100 + U[p + dj] * w010 + U[p + dj + 1] * w110 + U[p + dk] * w001 + U[p + dk + 1] * w101 + U[p + dj + dk] * w011 + U[p + dj + dk + 1] * w111;
    o[1] = V[p] * w000 + V[p + 1] * w100 + V[p + dj] * w010 + V[p + dj + 1] * w110 + V[p + dk] * w001 + V[p + dk + 1] * w101 + V[p + dj + dk] * w011 + V[p + dj + dk + 1] * w111;
    o[2] = W[p] * w000 + W[p + 1] * w100 + W[p + dj] * w010 + W[p + dj + 1] * w110 + W[p + dk] * w001 + W[p + dk + 1] * w101 + W[p + dj + dk] * w011 + W[p + dj + dk + 1] * w111;
    return o;
  }
  /** RK2 departure point of a fluid parcel arriving at (x, y, z) after dt */
  private depart(x: number, y: number, z: number, dt: number, out: Float32Array | number[], o: number) {
    const v1 = this.velC(x, y, z); const xm = x - 0.5 * dt * v1[0], ym = y - 0.5 * dt * v1[1], zm = z - 0.5 * dt * v1[2];
    const v2 = this.velC(xm, ym, zm); out[o] = x - dt * v2[0]; out[o + 1] = y - dt * v2[1]; out[o + 2] = z - dt * v2[2];
  }

  private advectVelocity(dt: number) {
    const { nx, ny, nz, dx } = this;
    this.centreVelocity();
    this.ut.set(this.u); this.vt.set(this.v); this.wt.set(this.w);
    const d = [0, 0, 0];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) {
      const f = this.IU(i, j, k); if (this.fu[f] !== 0 && this.fu[f] !== 3) continue;
      this.depart(i * dx, (j + 0.5) * dx, (k + 0.5) * dx, dt, d, 0); this.u[f] = this.uAt(d[0], d[1], d[2], this.ut);
    }
    for (let k = 0; k < nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
      const f = this.IV(i, j, k); if (this.fv[f] !== 0 && this.fv[f] !== 3) continue;
      this.depart((i + 0.5) * dx, j * dx, (k + 0.5) * dx, dt, d, 0); this.v[f] = this.vAt(d[0], d[1], d[2], this.vt);
    }
    for (let k = 0; k <= nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const f = this.IW(i, j, k); if (this.fw[f] !== 0 && this.fw[f] !== 3) continue;
      this.depart((i + 0.5) * dx, (j + 0.5) * dx, k * dx, dt, d, 0); this.w[f] = this.wAt(d[0], d[1], d[2], this.wt);
    }
  }

  private meanSrc = 0;
  private comp = new Int32Array(0); private compClosed = new Uint8Array(0); private compSum = new Float64Array(0); private compN = new Float64Array(0); private compSrc = new Float64Array(0);
  /** pressure projection: A P = S − ∇·u* (× dx²), PCG with MIC(0); then u −= ∇P */
  private project() {
    const { nx, ny, nz, dx } = this; const S = this.solid; const b = this.r;
    const comp = this.comp, cc = this.compClosed, cS = this.compSum, cN = this.compN, cSrc = this.compSrc; cS.fill(0); cN.fill(0); cSrc.fill(0);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = this.IX(i, j, k); if (S[c]) { b[c] = 0; continue; }
      const div = (this.u[this.IU(i + 1, j, k)] - this.u[this.IU(i, j, k)] + this.v[this.IV(i, j + 1, k)] - this.v[this.IV(i, j, k)] + this.w[this.IW(i, j, k + 1)] - this.w[this.IW(i, j, k)]) / dx;
      b[c] = (this.src[c] - div) * dx * dx; const g = comp[c]; if (g >= 0) { cS[g] += b[c]; cSrc[g] += this.src[c]; cN[g]++; }
    }
    // closed regions: remove the mean (it becomes a uniform pressure rise); the reported rise is that of the burning region
    let best = 0; this.meanSrc = 0;
    for (let g = 0; g < cc.length; g++) { cS[g] = cc[g] && cN[g] ? cS[g] / cN[g] : 0; cSrc[g] = cc[g] && cN[g] ? cSrc[g] / cN[g] : 0; if (Math.abs(cSrc[g]) > best) { best = Math.abs(cSrc[g]); this.meanSrc = cSrc[g]; } }
    for (let c = 0; c < this.n; c++) if (!S[c] && comp[c] >= 0) b[c] -= cS[comp[c]];
    // r = b − A P (warm start); A x = Ad x_c − Σ x_nb over free faces
    const Pp = this.P, r = this.r, fl = this.fl, lo = this.nbLo, hi = this.nbHi, Ad = this.Ad, N = fl.length;
    const matvec = (x: Float64Array, y: Float64Array) => {
      for (let q = 0; q < N; q++) { const c = fl[q], o = q * 3; y[c] = Ad[c] * x[c] - x[lo[o]] - x[lo[o + 1]] - x[lo[o + 2]] - x[hi[o]] - x[hi[o + 1]] - x[hi[o + 2]]; }
    };
    for (let c = 0; c < this.n; c++) if (S[c]) Pp[c] = 0;
    const q_ = this.q; matvec(Pp, q_);
    for (let q = 0; q < N; q++) { const c = fl[q]; r[c] = b[c] - q_[c]; }
    cS.fill(0);
    for (let q = 0; q < N; q++) cS[comp[fl[q]]] += r[fl[q]];
    for (let g = 0; g < cc.length; g++) cS[g] = cc[g] && cN[g] ? cS[g] / cN[g] : 0;
    for (let q = 0; q < N; q++) r[fl[q]] -= cS[comp[fl[q]]];
    const tol = 5e-5 * dx * dx; // |∇·u − S| < 5e-5 1/s
    let rmax = 0; for (let q = 0; q < N; q++) rmax = Math.max(rmax, Math.abs(r[fl[q]]));
    let it = 0;
    if (rmax > tol) {
      const z = this.z, s = this.s;
      this.applyPrec(r, z); for (let q = 0; q < N; q++) s[fl[q]] = z[fl[q]];
      let rho = 0; for (let q = 0; q < N; q++) rho += r[fl[q]] * z[fl[q]];
      for (it = 1; it <= 400; it++) {
        matvec(s, q_);
        let sq = 0; for (let q = 0; q < N; q++) sq += s[fl[q]] * q_[fl[q]];
        if (Math.abs(sq) < 1e-30) break;
        const alpha = rho / sq; rmax = 0;
        for (let q = 0; q < N; q++) { const c = fl[q]; Pp[c] += alpha * s[c]; r[c] -= alpha * q_[c]; const a = r[c] < 0 ? -r[c] : r[c]; if (a > rmax) rmax = a; }
        if (rmax <= tol) break;
        this.applyPrec(r, z);
        let rn = 0; for (let q = 0; q < N; q++) rn += r[fl[q]] * z[fl[q]];
        const beta = rn / rho; rho = rn;
        for (let q = 0; q < N; q++) { const c = fl[q]; s[c] = z[c] + beta * s[c]; }
      }
    }
    this.pcgIters = it;
    // velocity update
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) {
      const f = this.IU(i, j, k), t = this.fu[f]; if (t === 1 || t === 2) continue;
      const pl = i > 0 ? Pp[this.IX(i - 1, j, k)] : 0, pr = i < nx ? Pp[this.IX(i, j, k)] : 0; this.u[f] -= (pr - pl) / dx;
    }
    for (let k = 0; k < nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) {
      const f = this.IV(i, j, k), t = this.fv[f]; if (t === 1 || t === 2) continue;
      const pl = j > 0 ? Pp[this.IX(i, j - 1, k)] : 0, pr = j < ny ? Pp[this.IX(i, j, k)] : 0; this.v[f] -= (pr - pl) / dx;
    }
    for (let k = 0; k <= nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const f = this.IW(i, j, k), t = this.fw[f]; if (t === 1 || t === 2) continue;
      const pl = k > 0 ? Pp[this.IX(i, j, k - 1)] : 0, pr = k < nz ? Pp[this.IX(i, j, k)] : 0; this.w[f] -= (pr - pl) / dx;
    }
    // measured residual and CFL
    let dmax = 0, vmax = 0;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = this.IX(i, j, k); if (S[c]) continue;
      const u0 = this.u[this.IU(i, j, k)], u1 = this.u[this.IU(i + 1, j, k)], v0 = this.v[this.IV(i, j, k)], v1 = this.v[this.IV(i, j + 1, k)], w0 = this.w[this.IW(i, j, k)], w1 = this.w[this.IW(i, j, k + 1)];
      const div = (u1 - u0 + v1 - v0 + w1 - w0) / dx - (this.src[c] - (comp[c] >= 0 ? cSrc[comp[c]] : 0));
      if (Math.abs(div) > dmax) dmax = Math.abs(div);
      const sp = 0.25 * ((u0 + u1) ** 2 + (v0 + v1) ** 2 + (w0 + w1) ** 2); if (sp > vmax) vmax = sp;
    }
    this.divMax = dmax; this.maxSpeed = Math.sqrt(vmax);
  }
  private applyPrec(r: Float64Array, z: Float64Array) {
    const pr = this.prec, q = this.q, fl = this.fl, lo = this.nbLo, hi = this.nbHi, N = fl.length;
    // L q = r (lower neighbours across free faces have coefficient −1)
    for (let m = 0; m < N; m++) { const c = fl[m], o = m * 3; q[c] = (r[c] + pr[lo[o]] * q[lo[o]] + pr[lo[o + 1]] * q[lo[o + 1]] + pr[lo[o + 2]] * q[lo[o + 2]]) * pr[c]; }
    // Lᵀ z = q
    for (let m = N - 1; m >= 0; m--) { const c = fl[m], o = m * 3; z[c] = (q[c] + pr[c] * (z[hi[o]] + z[hi[o + 1]] + z[hi[o + 2]])) * pr[c]; }
  }

  /** solid cells take the mean of their gas neighbours so interpolation does not leak wall values */
  private extrapolate(f: Float32Array) {
    const { nx, ny, nz } = this; const S = this.solid;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = this.IX(i, j, k); if (!S[c]) continue;
      let s = 0, m = 0;
      if (i > 0 && !S[c - 1]) { s += f[c - 1]; m++; } if (i < nx - 1 && !S[c + 1]) { s += f[c + 1]; m++; }
      if (j > 0 && !S[c - nx]) { s += f[c - nx]; m++; } if (j < ny - 1 && !S[c + nx]) { s += f[c + nx]; m++; }
      if (k > 0 && !S[c - nx * ny]) { s += f[c - nx * ny]; m++; } if (k < nz - 1 && !S[c + nx * ny]) { s += f[c + nx * ny]; m++; }
      if (m) f[c] = s / m;
    }
  }

  private advectScalars(dt: number) {
    const { nx, ny, nz, dx } = this; const S = this.solid; const P = this.params;
    const D = D_REF * Math.sqrt(101.325 / Math.max(10, P.pressureKpa));
    const a = (D * dt) / (dx * dx);
    // back-traced departure points (RK2) and forward arrival points, shared by all scalars
    this.centreVelocity();
    const dep = this.depCache ??= new Float32Array(this.n * 3), arr = this.arrCache ??= new Float32Array(this.n * 3);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = this.IX(i, j, k); if (S[c]) continue;
      const x = (i + 0.5) * dx, y = (j + 0.5) * dx, z = (k + 0.5) * dx;
      this.depart(x, y, z, dt, dep, c * 3);
      arr[c * 3] = x + dt * this.uc[c]; arr[c * 3 + 1] = y + dt * this.vc[c]; arr[c * 3 + 2] = z + dt * this.wc[c];
    }
    const inflow: [Float32Array, number, boolean][] = [[this.T, 0, true], [this.Y, P.o2, false], [this.C, 0, false], [this.S, 0, true]];
    for (const [f, amb, second] of inflow) {
      this.extrapolate(f);
      const fwd = this.tmp, bk = this.tmp2;
      for (let c = 0; c < this.n; c++) { if (S[c]) { fwd[c] = f[c]; continue; } fwd[c] = this.at(f, dep[c * 3], dep[c * 3 + 1], dep[c * 3 + 2]); }
      // MacCormack correction with min/max clamp (temperature and smoke; O2 and CO2 stay first order)
      if (!second) bk.set(fwd);
      else for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const c = this.IX(i, j, k); if (S[c]) { bk[c] = f[c]; continue; }
        const back = this.at(fwd, arr[c * 3], arr[c * 3 + 1], arr[c * 3 + 2]);
        let val = fwd[c] + 0.5 * (f[c] - back);
        const gx = dep[c * 3] / dx - 0.5, gy = dep[c * 3 + 1] / dx - 0.5, gz = dep[c * 3 + 2] / dx - 0.5;
        const i0 = Math.max(0, Math.min(nx - 1, Math.floor(gx))), j0 = Math.max(0, Math.min(ny - 1, Math.floor(gy))), k0 = Math.max(0, Math.min(nz - 1, Math.floor(gz)));
        const i1 = Math.min(nx - 1, i0 + 1), j1 = Math.min(ny - 1, j0 + 1), k1 = Math.min(nz - 1, k0 + 1);
        let lo = Infinity, hi = -Infinity;
        for (const ii of [i0, i1]) for (const jj of [j0, j1]) for (const kk of [k0, k1]) { const q = f[this.IX(ii, jj, kk)]; if (q < lo) lo = q; if (q > hi) hi = q; }
        if (val < lo || val > hi) val = fwd[c];
        bk[c] = val;
      }
      // diffusion (explicit, Neumann at walls) on top of the advected field
      for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const c = this.IX(i, j, k); if (S[c]) continue;
        const v0 = bk[c]; let lap = 0;
        if (i > 0 && !S[c - 1]) lap += bk[c - 1] - v0; if (i < nx - 1 && !S[c + 1]) lap += bk[c + 1] - v0;
        if (j > 0 && !S[c - nx]) lap += bk[c - nx] - v0; if (j < ny - 1 && !S[c + nx]) lap += bk[c + nx] - v0;
        if (k > 0 && !S[c - nx * ny]) lap += bk[c - nx * ny] - v0; if (k < nz - 1 && !S[c + nx * ny]) lap += bk[c + nx * ny] - v0;
        f[c] = v0 + a * lap;
      }
      // fresh air from supply vents
      for (const s of this.supplyCells) f[s.c] += (amb - f[s.c]) * Math.min(1, (s.speed * dt) / dx);
    }
  }

  // ------------------------------------------------------------------ combustion
  private combust(dt: number, T0: number) {
    const P = this.params; const mat = P.material; this.src.fill(0);
    let total = 0, burning = 0, charred = 0, mo = P.o2;
    if (this.state === "igniting" || this.state === "burning") {
      const pf = Math.sqrt(Math.max(0.1, P.pressureKpa / 101.325));                // reaction / pyrolysis pressure factor
      const lim = mat.limitO2 * Math.pow(101.325 / Math.max(20, P.pressureKpa), 0.12); // limiting O2 rises at low pressure
      const fuelMax = 0.035 * mat.rate * pf * (0.6 + 0.4 * P.igniter) * (0.5 + P.o2 / 0.42);
      const s = this.source!; const age = this.time - s.ignitedAt;
      const igniterOn = age < 4 * P.igniter;
      const byIdx = new Map<number, FuelCell>(); for (const f of this.fuel) byIdx.set(f.c, f);
      for (const f of this.fuel) {
        if (f.state !== 1) continue;
        f.ramp = Math.min(1, f.ramp + dt / 4);                                   // pyrolysis builds up over a few seconds
        let r = 0;
        const parts: [number, number][] = f.gas2 !== f.gas ? [[f.gas, 0.6], [f.gas2, 0.4]] : [[f.gas, 1]];
        for (const [c, share] of parts) {
          const ex = this.Y[c] - lim; if (ex <= 0) continue;
          let consumed = ex * (1 - Math.exp(-K_MIX * pf * dt)) * share;
          consumed = Math.min(consumed, fuelMax * f.ramp * share * dt);
          const room = Math.max(0, (T_MAX - this.T[c]) / HEAT); consumed = Math.min(consumed, room);
          if (consumed <= 0) continue;
          this.Y[c] -= consumed; this.C[c] += consumed;
          const dT = consumed * HEAT; this.T[c] += dT; this.src[c] += dT / dt / (T0 + this.T[c]);
          this.S[c] += consumed * SMOKE * mat.smoke;
          r += consumed / dt;
        }
        f.rate = r; f.used += r * dt; total += r;
        if (this.Y[f.gas] < mo) mo = this.Y[f.gas];
        if (f.used > mat.load) { f.state = 2; f.rate = 0; continue; }            // burnt out
        if (age > 3 && !igniterOn && r < R_CRIT * f.ramp * pf) { f.low += dt; if (f.low > 2) { f.state = 2; f.rate = 0; f.used = Math.max(f.used, 1e-4); } }
        else f.low = 0;
      }
      // igniter keeps the centre cell alight for its duration
      if (igniterOn) for (const f of this.fuel) if (f.a === 0 && f.b === 0 && f.state !== 1 && f.used < mat.load) { f.state = 1; f.low = 0; }
      // spread: pre-heating by burning neighbours on the panel
      const along = [0, 0, 0];
      for (const f of this.fuel) {
        if (f.state !== 0) continue;
        let q = 0;
        for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const pos = [f.i, f.j, f.k]; pos[s.tu] -= da; pos[s.tv] -= db;
          const [pi, pj, pk] = pos; if (this.isSolidCell(pi, pj, pk)) continue;
          const nb = byIdx.get(this.IX(pi, pj, pk)); if (!nb || nb.state !== 1 || nb.rate < R_CRIT) continue;
          along[0] = 0; along[1] = 0; along[2] = 0; along[s.tu] = da; along[s.tv] = db;
          const [ux, vy, wz] = this.velocity(this.centre(nb.i), this.centre(nb.j), this.centre(nb.k));
          const conc = Math.max(0, along[0] * ux + along[1] * vy + along[2] * wz);              // concurrent flow carries the flame
          const opp = Math.max(0, -(along[0] * ux + along[1] * vy + along[2] * wz));            // opposed flow slows it
          const uphill = P.gravity > 0 ? Math.max(0, along[1]) * 1.2 * Math.sqrt(P.gravity / 9.81) : 0;
          q += nb.rate * (1 + 8 * conc + uphill) / (1 + 2 * opp);
        }
        if (q > 0) { f.heat += q * mat.spread * dt * (P.o2 / 0.21); if (f.heat > 0.2) { f.state = 1; f.ramp = 0.1; } }
      }
      for (const f of this.fuel) { if (f.state === 1) burning++; else if (f.state === 2) charred++; }
      if (this.state === "igniting" && !igniterOn) this.state = burning ? "burning" : "extinguished";
      else if (this.state === "igniting" && burning > 1) this.state = "burning";
      if (this.state === "burning" && burning === 0 && !igniterOn) {
        const usedTot = this.fuel.reduce((a, f) => a + (f.used >= mat.load ? 1 : 0), 0);
        this.state = usedTot > this.fuel.length * 0.5 ? "burnt-out" : "extinguished";
      }
    } else for (const f of this.fuel) if (f.state === 2) charred++;
    this.hrr = total; this.minO2 = this.state === "idle" ? P.o2 : mo;
    this.burningArea = burning * this.dx * this.dx; this.charredArea = charred * this.dx * this.dx;
  }

  private updateDetectors() {
    for (const d of this.detectors) {
      d.reading = this.S[d.c];
      if (d.alarmAt === null && d.reading > ALARM && this.state !== "idle") d.alarmAt = this.time;
    }
  }

  zoneStats(): ZoneStat[] {
    return this.hab.zones.map((z) => {
      let t = 0, y = 0, s = 0, n = 0, tmax = 0;
      const [i0, i1, j0, j1, k0, k1] = z.box;
      for (let k = k0 - 1; k < Math.min(k1, this.nz); k++) for (let j = j0 - 1; j < Math.min(j1, this.ny); j++) for (let i = i0 - 1; i < Math.min(i1, this.nx); i++) {
        const c = this.IX(i, j, k); if (this.solid[c]) continue;
        t += this.T[c]; y += this.Y[c]; s += this.S[c]; n++; if (this.T[c] > tmax) tmax = this.T[c];
      }
      n = Math.max(1, n);
      return { id: z.id, name: z.name, meanT: t / n, maxT: tmax, meanO2: y / n, smoke: s / n };
    });
  }

  historyCsv(): string {
    const d = this.detectors;
    const head = ["t_s", "burning_rate", "min_O2_at_flame_pct", "max_T_rise_K", "pressure_rise_Pa", ...d.map((q) => `smoke_${q.id}`)];
    const rows = this.history.map((h) => [h.t.toFixed(2), h.hrr.toFixed(5), (h.minO2 * 100).toFixed(3), h.maxT.toFixed(1), h.dp.toFixed(1), ...h.det.map((r) => r.toFixed(5))].join(","));
    return [head.join(","), ...rows].join("\n");
  }
  private depCache: Float32Array | null = null; private arrCache: Float32Array | null = null;
}
