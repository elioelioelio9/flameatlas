/**
 * FlameAtlas cabin-fire model — an *educational* 2-D mid-plane simulation of a fire in a habitat module.
 *
 * Physics (incompressible, Boussinesq):
 *   ∂u/∂t + (u·∇)u = −∇p/ρ + g β ΔT ŷ          (Navier–Stokes, numerical viscosity only)
 *   ∇·u = 0                                       (pressure projection, Jacobi iterations)
 *   ∂φ/∂t + (u·∇)φ = D ∇²φ + S_φ                  for φ = temperature rise, O2 mole fraction, smoke
 * Discretisation: Stam's "stable fluids" (semi-Lagrangian advection + projection) on a collocated grid.
 *
 * Fire: a burning surface patch consumes local O2 in excess of a material limit; heat and smoke are released
 * in proportion. The flame dies when the burning rate stays below a critical value (radiative loss), which is
 * the mechanism behind microgravity quiescent extinction. Constants are chosen to reproduce *qualitative*
 * trends reported in NASA PSI data (ACME BRE, FLEX, BASS, SAFFIRE) — this is not a validated CFD code.
 */

export interface Material {
  id: string;
  label: string;
  /** limiting O2 mole fraction (indicative, from 1-g limiting oxygen index tests) */
  limitO2: number;
  /** relative smoke yield */
  smoke: number;
  /** relative spread propensity */
  spread: number;
}

export const MATERIALS: Material[] = [
  { id: "pmma", label: "PMMA (acrylic plastic)", limitO2: 0.175, smoke: 1.0, spread: 1.0 },
  { id: "cotton", label: "Cotton fabric", limitO2: 0.18, smoke: 1.3, spread: 1.6 },
  { id: "nomex", label: "Nomex (flame-resistant)", limitO2: 0.28, smoke: 0.7, spread: 0.5 },
];

export interface SimParams {
  gravity: number;        // m/s²  (0, 1.62, 3.71, 9.81)
  ventSpeed: number;      // m/s at the supply diffuser (0 = ventilation off)
  o2: number;             // ambient O2 mole fraction
  pressureKpa: number;    // cabin pressure
  material: Material;
}

export interface Detector { id: string; label: string; i: number; j: number; alarmAt: number | null; reading: number }

export type FlameState = "idle" | "burning" | "extinguished" | "burnt-out";

export const L = 6.0;   // module length modelled (m)
export const H = 2.1;   // aisle height (m)
export const NX = 120;
export const NY = 42;
const DX = L / NX;
const T0 = 293;         // ambient temperature (K)
const W = NX + 2;
const SIZE = (NX + 2) * (NY + 2);
const IX = (i: number, j: number) => i + W * j;

// tuning constants (model units)
const D_NUM = 0.8e-3;   // effective diffusivity at 1 atm (m²/s) — grid-scale mixing
const K_REACT = 6.0;    // 1/s : fraction of O2 excess consumed per second in a burning cell
const HEAT = 6000;      // K per unit mole fraction of O2 consumed
const SMOKE = 60;       // smoke units per unit mole fraction consumed
const R_CRIT = 0.008;   // critical burning rate per flame cell (mole-frac/s) below which the flame dies
const COOL = 0.06;      // 1/s : volumetric heat loss to walls/radiation
const ALARM = 0.05;     // detector threshold (smoke units)

export class CabinFire {
  u = new Float32Array(SIZE);
  v = new Float32Array(SIZE);
  u0 = new Float32Array(SIZE);
  v0 = new Float32Array(SIZE);
  p = new Float32Array(SIZE);
  div = new Float32Array(SIZE);
  T = new Float32Array(SIZE);
  Y = new Float32Array(SIZE);
  S = new Float32Array(SIZE);
  tmp = new Float32Array(SIZE);
  /** burning-rate field (for rendering the flame) */
  burn = new Float32Array(SIZE);
  /** cells of the fuel surface currently burning */
  fire: Set<number> = new Set();
  fuelRow: number[] = [];   // cell indices of the fuel strip (where fire can spread)
  time = 0;
  state: FlameState = "idle";
  ignitedAt = 0;
  lowSince: number | null = null;
  hrr = 0;            // total burning rate (model units)
  peakT = 0;
  minO2 = 1;
  history: { t: number; hrr: number; o2: number; smoke: number }[] = [];
  detectors: Detector[];
  params: SimParams;

  // vent geometry
  inlet = { i: 0, j0: 2, j1: NY - 1 };
  outlet = { i: NX + 1, j0: 2, j1: NY - 1 };

  constructor(params: SimParams) {
    this.params = { ...params };
    this.detectors = [
      { id: "return", label: "Return duct (mixed air)", i: NX - 3, j: Math.round(NY * 0.5), alarmAt: null, reading: 0 },
      { id: "ceiling", label: "Ceiling (mid)", i: Math.round(NX * 0.5), j: NY - 2, alarmAt: null, reading: 0 },
      { id: "supply", label: "Near supply (fwd)", i: 6, j: Math.round(NY * 0.5), alarmAt: null, reading: 0 },
    ];
    this.reset();
  }

  setParams(p: Partial<SimParams>) { this.params = { ...this.params, ...p }; }

  reset() {
    for (const a of [this.u, this.v, this.u0, this.v0, this.p, this.div, this.T, this.S, this.burn]) a.fill(0);
    this.Y.fill(this.params.o2);
    this.fire.clear();
    this.time = 0;
    this.state = "idle";
    this.lowSince = null;
    this.hrr = 0;
    this.peakT = 0;
    this.minO2 = this.params.o2;
    this.history = [];
    this.detectors.forEach((d) => { d.alarmAt = null; d.reading = 0; });
  }

  /** Ignite a fuel strip along the floor (or a wall) around cell (ci, cj). */
  ignite(ci: number, cj: number) {
    const i0 = Math.max(2, Math.min(NX - 1, Math.round(ci)));
    const j = Math.max(1, Math.min(NY, Math.round(cj)));
    // fuel strip: 1.6 m long horizontal surface through the clicked point
    this.fuelRow = [];
    for (let i = Math.max(1, i0 - 16); i <= Math.min(NX, i0 + 16); i++) this.fuelRow.push(IX(i, j));
    this.fire.clear();
    for (let i = i0 - 1; i <= i0 + 1; i++) this.fire.add(IX(i, j));
    this.state = "burning";
    this.ignitedAt = this.time;
    this.lowSince = null;
  }

  // ---------------------------------------------------------------- numerics
  private setBnd(b: 0 | 1 | 2, x: Float32Array) {
    // b = 1: u (x-velocity), b = 2: v, b = 0: scalar. Solid walls: reflect normal velocity.
    for (let j = 1; j <= NY; j++) {
      x[IX(0, j)] = b === 1 ? -x[IX(1, j)] : x[IX(1, j)];
      x[IX(NX + 1, j)] = b === 1 ? -x[IX(NX, j)] : x[IX(NX, j)];
    }
    for (let i = 1; i <= NX; i++) {
      x[IX(i, 0)] = b === 2 ? -x[IX(i, 1)] : x[IX(i, 1)];
      x[IX(i, NY + 1)] = b === 2 ? -x[IX(i, NY)] : x[IX(i, NY)];
    }
    x[IX(0, 0)] = 0.5 * (x[IX(1, 0)] + x[IX(0, 1)]);
    x[IX(0, NY + 1)] = 0.5 * (x[IX(1, NY + 1)] + x[IX(0, NY)]);
    x[IX(NX + 1, 0)] = 0.5 * (x[IX(NX, 0)] + x[IX(NX + 1, 1)]);
    x[IX(NX + 1, NY + 1)] = 0.5 * (x[IX(NX, NY + 1)] + x[IX(NX + 1, NY)]);
  }

  private ventBnd() {
    const vs = this.params.ventSpeed;
    if (vs <= 0) return;
    for (let j = this.inlet.j0; j <= this.inlet.j1; j++) {
      this.u[IX(0, j)] = vs; this.u[IX(1, j)] = vs; this.v[IX(1, j)] = 0;
    }
    for (let j = this.outlet.j0; j <= this.outlet.j1; j++) {
      this.u[IX(NX + 1, j)] = Math.max(this.u[IX(NX, j)], 0);
    }
  }

  private advect(b: 0 | 1 | 2, d: Float32Array, d0: Float32Array, u: Float32Array, v: Float32Array, dt: number) {
    const dt0 = dt / DX;
    for (let j = 1; j <= NY; j++) {
      for (let i = 1; i <= NX; i++) {
        let x = i - dt0 * u[IX(i, j)];
        let y = j - dt0 * v[IX(i, j)];
        if (x < 0.5) x = 0.5; if (x > NX + 0.5) x = NX + 0.5;
        if (y < 0.5) y = 0.5; if (y > NY + 0.5) y = NY + 0.5;
        const i0 = Math.floor(x), i1 = i0 + 1, j0 = Math.floor(y), j1 = j0 + 1;
        const s1 = x - i0, s0 = 1 - s1, t1 = y - j0, t0 = 1 - t1;
        d[IX(i, j)] = s0 * (t0 * d0[IX(i0, j0)] + t1 * d0[IX(i0, j1)]) + s1 * (t0 * d0[IX(i1, j0)] + t1 * d0[IX(i1, j1)]);
      }
    }
    this.setBnd(b, d);
  }

  private project(iters = 40) {
    const { u, v, p, div } = this;
    const h = DX;
    for (let j = 1; j <= NY; j++) for (let i = 1; i <= NX; i++) {
      div[IX(i, j)] = -0.5 * h * (u[IX(i + 1, j)] - u[IX(i - 1, j)] + v[IX(i, j + 1)] - v[IX(i, j - 1)]);
      p[IX(i, j)] = 0;
    }
    this.setBnd(0, div); this.setBnd(0, p);
    const outlet = this.params.ventSpeed > 0;
    for (let k = 0; k < iters; k++) {
      for (let j = 1; j <= NY; j++) for (let i = 1; i <= NX; i++) {
        p[IX(i, j)] = (div[IX(i, j)] + p[IX(i - 1, j)] + p[IX(i + 1, j)] + p[IX(i, j - 1)] + p[IX(i, j + 1)]) / 4;
      }
      this.setBnd(0, p);
      if (outlet) for (let j = this.outlet.j0; j <= this.outlet.j1; j++) p[IX(NX + 1, j)] = 0; // open return grille
    }
    for (let j = 1; j <= NY; j++) for (let i = 1; i <= NX; i++) {
      u[IX(i, j)] -= 0.5 * (p[IX(i + 1, j)] - p[IX(i - 1, j)]) / h;
      v[IX(i, j)] -= 0.5 * (p[IX(i, j + 1)] - p[IX(i, j - 1)]) / h;
    }
    this.setBnd(1, u); this.setBnd(2, v);
  }

  private diffuse(x: Float32Array, D: number, dt: number) {
    const a = (D * dt) / (DX * DX);
    const t = this.tmp;
    t.set(x);
    for (let j = 1; j <= NY; j++) for (let i = 1; i <= NX; i++) {
      x[IX(i, j)] = t[IX(i, j)] + a * (t[IX(i - 1, j)] + t[IX(i + 1, j)] + t[IX(i, j - 1)] + t[IX(i, j + 1)] - 4 * t[IX(i, j)]);
    }
  }

  private scalarBnd() {
    // supply air is fresh; walls are zero-gradient
    this.setBnd(0, this.T); this.setBnd(0, this.Y); this.setBnd(0, this.S);
    if (this.params.ventSpeed > 0) for (let j = this.inlet.j0; j <= this.inlet.j1; j++) {
      this.T[IX(0, j)] = 0; this.Y[IX(0, j)] = this.params.o2; this.S[IX(0, j)] = 0;
    }
  }

  // ---------------------------------------------------------------- one time step
  step(dt = 0.05) {
    const P = this.params;
    const { u, v, u0, v0, T, Y, S } = this;
    const D = D_NUM * Math.sqrt(101.325 / Math.max(10, P.pressureKpa)); // molecular part scales ~1/p
    const dtd = Math.min(dt, (0.2 * DX * DX) / D);

    // 1) forces: buoyancy (Boussinesq) — zero in microgravity
    if (P.gravity > 0) for (let k = 0; k < SIZE; k++) v[k] += dt * P.gravity * (T[k] / T0);

    // 2) velocity: advect + project
    this.ventBnd();
    u0.set(u); v0.set(v);
    this.advect(1, u, u0, u0, v0, dt);
    this.advect(2, v, v0, u0, v0, dt);
    this.ventBnd();
    this.project();
    this.ventBnd();

    // 3) scalars: advect + diffuse
    this.scalarBnd();
    this.tmp.set(T); this.advect(0, T, this.tmp, u, v, dt);
    this.tmp.set(Y); this.advect(0, Y, this.tmp, u, v, dt);
    this.tmp.set(S); this.advect(0, S, this.tmp, u, v, dt);
    const n = Math.max(1, Math.round(dt / dtd));
    for (let s = 0; s < n; s++) { this.diffuse(T, D, dt / n); this.diffuse(Y, D, dt / n); this.diffuse(S, D, dt / n); this.scalarBnd(); }

    // 4) heat loss
    const cool = Math.exp(-COOL * dt);
    for (let k = 0; k < SIZE; k++) T[k] *= cool;

    // 5) combustion on burning cells
    this.burn.fill(0);
    let total = 0;
    if (this.state === "burning") {
      const lim = P.material.limitO2;
      for (const c of this.fire) {
        const excess = Y[c] - lim;
        if (excess <= 0) continue;
        const consumed = excess * (1 - Math.exp(-K_REACT * dt));
        Y[c] -= consumed;
        // heat goes into the gas just above / downstream of the surface
        T[c] += consumed * HEAT;
        T[c + W] += consumed * HEAT * 0.5;
        S[c] += consumed * SMOKE * P.material.smoke;
        const r = consumed / dt;
        this.burn[c] = r;
        total += r;
      }
      // spread along the fuel strip: neighbours of strongly burning cells ignite, faster downstream
      const rate = P.material.spread * dt;
      const add: number[] = [];
      for (const c of this.fire) {
        if (this.burn[c] < R_CRIT * 1.8) continue;
        const k = this.fuelRow.indexOf(c);
        const ux = u[c];
        for (const dk of [-1, 1]) {
          const nb = this.fuelRow[k + dk];
          if (nb === undefined || this.fire.has(nb)) continue;
          const along = Math.max(0, Math.sign(dk) * ux); // concurrent flow speeds spread
          const prob = rate * (0.08 + 9 * along) * Math.min(3, this.burn[c] / R_CRIT / 3);
          if (Math.random() < prob) add.push(nb);
        }
      }
      add.forEach((c) => this.fire.add(c));
      const perCell = this.fire.size ? total / this.fire.size : 0;
      if (this.time - this.ignitedAt > 3 && perCell < R_CRIT) {
        this.lowSince ??= this.time;
        if (this.time - this.lowSince > 2) { this.state = "extinguished"; this.fire.clear(); }
      } else this.lowSince = null;
      if (this.fire.size === this.fuelRow.length && this.time - this.ignitedAt > 240) this.state = "burnt-out";
    }
    this.hrr = total;

    // 6) diagnostics
    this.time += dt;
    let pk = 0, mn = 1, sm = 0;
    for (let j = 1; j <= NY; j++) for (let i = 1; i <= NX; i++) {
      const k = IX(i, j);
      if (T[k] > pk) pk = T[k];
      if (Y[k] < mn) mn = Y[k];
      sm += S[k];
    }
    this.peakT = Math.max(this.peakT, pk);
    this.minO2 = Math.min(this.minO2, mn);
    for (const d of this.detectors) {
      if (d.id === "return" && this.params.ventSpeed > 0) {
        // a return-duct detector samples the mixed air leaving the module (flow-weighted average)
        let num = 0, den = 0;
        for (let j = 1; j <= NY; j++) { const w = Math.max(this.u[IX(NX, j)], 0.002); num += w * S[IX(NX, j)]; den += w; }
        d.reading = den > 0 ? num / den : 0;
      } else d.reading = S[IX(d.i, d.j)];
      if (d.alarmAt === null && d.reading > ALARM) d.alarmAt = this.time;
    }
    if (this.history.length === 0 || this.time - this.history[this.history.length - 1].t >= 0.5) {
      this.history.push({ t: this.time, hrr: total, o2: mn, smoke: sm / (NX * NY) });
      if (this.history.length > 600) this.history.shift();
    }
  }

  /** bilinear velocity sample at physical coordinates (x along module, y height), m/s */
  velocityAt(x: number, y: number): [number, number] {
    const fx = Math.min(NX + 0.5, Math.max(0.5, x / DX + 0.5));
    const fy = Math.min(NY + 0.5, Math.max(0.5, y / DX + 0.5));
    const i0 = Math.floor(fx), j0 = Math.floor(fy), s = fx - i0, t = fy - j0;
    const f = (a: Float32Array) => (1 - s) * ((1 - t) * a[IX(i0, j0)] + t * a[IX(i0, j0 + 1)]) + s * ((1 - t) * a[IX(i0 + 1, j0)] + t * a[IX(i0 + 1, j0 + 1)]);
    return [f(this.u), f(this.v)];
  }

  sample(field: Float32Array, x: number, y: number): number {
    const i = Math.min(NX, Math.max(1, Math.round(x / DX + 0.5)));
    const j = Math.min(NY, Math.max(1, Math.round(y / DX + 0.5)));
    return field[IX(i, j)];
  }

  static cellToX(i: number) { return (i - 0.5) * DX; }
  static cellToY(j: number) { return (j - 0.5) * DX; }
  static xToCell(x: number) { return x / DX + 0.5; }
  static yToCell(y: number) { return y / DX + 0.5; }
  static IX = IX;
  static DX = DX;
  static ALARM = ALARM;
}
