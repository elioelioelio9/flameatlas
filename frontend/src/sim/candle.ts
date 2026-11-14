/**
 * A candle flame at any gravity, computed live: the simplest model that contains the physics of the challenge.
 *
 * Geometry: axisymmetric (r, y), 4 cm radius × 10 cm high, 0.625 mm cells, staggered (MAC) grid.
 * Flow:     incompressible Boussinesq, ∂u/∂t + (u·∇)u = −∇p + ν(T)∇²u + g (1 − T∞/T) ŷ, ∇·u = 0
 *           (semi-Lagrangian advection, implicit viscosity, SOR pressure projection; open boundaries, no-slip candle).
 * Flame:    Burke–Schumann flame sheet. One scalar, the mixture fraction Z (1 = fuel vapour at the wick, 0 = air),
 *           obeys ∂Z/∂t + u·∇Z = ∇·(D(T)∇Z). Fuel and oxygen meet in stoichiometric proportion where Z = Z_st
 *           (0.064 for paraffin in air): that surface is the flame. Temperature is a function of Z, peaking at
 *           the sheet. Transport properties grow as T^1.7.
 * Heat loss: the peak temperature falls when the flame is weakly strained (thick, slow, as in weightlessness),
 *           T_f = T∞ + (T_max − T∞)·a/(a + a½) with a = D|∇Z|² averaged on the sheet (the scalar dissipation rate).
 *           That is the radiative-loss mechanism that makes microgravity flames cooler, blue and soot-free.
 *
 * Not included: thermal expansion of the gas, detailed chemistry, soot transport, wax melting. The model shows
 * trends (shape, size, temperature, flow) and is not a quantitative prediction.
 */
export const NR = 64, NY = 160, DX = 0.000625;
export const T_INF = 293, T_MAX = 1670, T_WICK = 600, Z_ST = 0.064;
const Z_WICK = 0.55;           // fuel-vapour mixture fraction at the wick surface
const D0 = 2.0e-5;             // diffusivity of O2 in air at 293 K (m²/s); ν ≈ D (Schmidt number ≈ 1)
const A_HALF = 0.008;           // dissipation rate (1/s) at which half of the temperature rise is lost
const CANDLE_R = 14, CANDLE_H = 20, WICK_R = 2, WICK_H = 12; // cells
const N = NR * NY;

export class Candle {
  g = 9.81;
  time = 0;
  /** staggered velocities: u at radial faces (NR+1)×NY, v at axial faces NR×(NY+1) */
  u = new Float32Array((NR + 1) * NY); v = new Float32Array(NR * (NY + 1));
  private u0 = new Float32Array((NR + 1) * NY); private v0 = new Float32Array(NR * (NY + 1));
  Z = new Float32Array(N); private Z0 = new Float32Array(N);
  T = new Float32Array(N).fill(T_INF);
  private D = new Float32Array(N).fill(D0);
  private phi = new Float32Array(N); private div = new Float32Array(N);
  solid = new Uint8Array(N); wick = new Uint8Array(N);
  /** cell-centred velocity and vorticity, for display */
  uc = new Float32Array(N); vc = new Float32Array(N); vort = new Float32Array(N);
  zw = Z_WICK; private fu = new Uint8Array((NR + 1) * NY); private fv = new Uint8Array(NR * (NY + 1)); private wall = new Uint8Array(N);
  Tf = T_MAX; strain = 0; vmax = 0; height = 0; width = 0; fuelRate = 0; divMax = 0;

  constructor() {
    for (let j = 0; j < NY; j++) for (let i = 0; i < NR; i++) {
      const c = i + NR * j;
      if (j < CANDLE_H && i < CANDLE_R) this.solid[c] = 1;
      if (j >= CANDLE_H && j < CANDLE_H + WICK_H && i < WICK_R) { this.solid[c] = 1; this.wick[c] = 1; }
    }
    for (let c = 0; c < N; c++) this.wall[c] = this.solid[c] && !this.wick[c] ? 1 : 0;
    for (let j = 0; j < NY; j++) for (let i = 1; i <= NR; i++) this.fu[i + (NR + 1) * j] = (i < NR && this.sol(i, j)) || this.sol(i - 1, j) ? 0 : 1;
    for (let j = 0; j <= NY; j++) for (let i = 0; i < NR; i++) this.fv[i + NR * j] = (j < NY && this.sol(i, j)) || this.sol(i, j - 1) || (j === 0 && i < CANDLE_R) ? 0 : 1;
    this.reset();
  }
  reset() {
    this.u.fill(0); this.v.fill(0); this.phi.fill(0); this.time = 0; this.Tf = T_MAX;
    // ignition: a small pocket of fuel vapour around the wick
    for (let j = 0; j < NY; j++) for (let i = 0; i < NR; i++) {
      const c = i + NR * j, d = Math.hypot(i + 0.5, j + 0.5 - (CANDLE_H + WICK_H * 0.6)) * DX;
      this.zw = Z_WICK; this.Z[c] = this.wick[c] ? Z_WICK : this.solid[c] ? 0 : Z_WICK * Math.exp(-((d / 0.004) ** 2));
    }
    this.thermo();
  }

  private uAt(x: number, y: number) { return bil(this.u0, NR + 1, NY, x / DX, y / DX - 0.5); }
  private vAt(x: number, y: number) { return bil(this.v0, NR, NY + 1, x / DX - 0.5, y / DX); }
  /** velocity at a point (metres), from the current field */
  velocity(x: number, y: number): [number, number] { const r = Math.abs(x); const ur = bil(this.u, NR + 1, NY, r / DX, y / DX - 0.5); return [x < 0 ? -ur : ur, bil(this.v, NR, NY + 1, r / DX - 0.5, y / DX)]; }
  private sol(i: number, j: number) { return i >= 0 && i < NR && j >= 0 && j < NY && this.solid[i + NR * j] === 1; }

  /** temperature and transport properties from the mixture fraction (flame-sheet state relations) */
  private thermo() {
    const { Z, T, D, Tf } = this;
    for (let c = 0; c < N; c++) {
      const z = Z[c];
      const t = z <= Z_ST ? T_INF + (Tf - T_INF) * (z / Z_ST) : T_WICK + (Tf - T_WICK) * ((1 - z) / (1 - Z_ST));
      T[c] = t; D[c] = D0 * Math.pow(t / T_INF, 1.7);
    }
  }

  step(dt: number) {
    const { u, v, u0, v0, Z, Z0, T, D, phi, div, solid, wick } = this;
    // ---- 1. advect momentum (semi-Lagrangian)
    u0.set(u); v0.set(v);
    for (let j = 0; j < NY; j++) for (let i = 1; i <= NR; i++) {
      const x = i * DX, y = (j + 0.5) * DX, f = i + (NR + 1) * j;
      const uu = u0[f], vv = this.vAt(x, y);
      u[f] = this.uAt(Math.max(0, x - dt * uu), y - dt * vv);
    }
    for (let j = 0; j <= NY; j++) for (let i = 0; i < NR; i++) {
      const x = (i + 0.5) * DX, y = j * DX, f = i + NR * j;
      const uu = this.uAt(x, y), vv = v0[f];
      v[f] = this.vAt(Math.max(0, x - dt * uu), y - dt * vv);
    }
    // ---- 2. buoyancy on the axial faces: g (1 − T∞/T)
    if (this.g > 0) for (let j = 1; j < NY; j++) for (let i = 0; i < NR; i++) {
      const tm = 0.5 * (T[i + NR * j] + T[i + NR * (j - 1)]);
      v[i + NR * j] += dt * this.g * (1 - T_INF / tm);
    }
    // ---- 3. viscosity (implicit, Gauss–Seidel), ν = D
    const k = dt / (DX * DX); const ur = this.ur, vr = this.vr; ur.set(u); vr.set(v);
    this.enforceSolid(); // wall faces hold 0, so reading them as neighbours gives no-slip
    const { fu, fv, wall } = this;
    for (let it = 0; it < 6; it++) {
      for (let j = 1; j < NY; j++) for (let i = 0; i < NR; i++) {
        const f = i + NR * j; if (!fv[f]) continue;
        const a = k * 0.5 * (D[f] + D[f - NR]), wE = (i + 1) / (i + 0.5), wW = i / (i + 0.5);
        v[f] = (vr[f] + a * (wE * (i + 1 < NR ? v[f + 1] : v[f]) + (i > 0 ? wW * v[f - 1] : 0) + v[f + NR] + v[f - NR])) / (1 + a * (wE + wW + 2));
      }
      for (let j = 0; j < NY; j++) for (let i = 1; i < NR; i++) {
        const f = i + (NR + 1) * j; if (!fu[f]) continue;
        const a = k * 0.5 * (D[i + NR * j] + D[i - 1 + NR * j]), wE = (i + 0.5) / i, wW = (i - 0.5) / i;
        u[f] = (ur[f] + a * (wE * u[f + 1] + wW * u[f - 1] + (j + 1 < NY ? u[f + NR + 1] : u[f]) + (j > 0 ? u[f - NR - 1] : u[f]))) / (1 + a * (wE + wW + 2 + 1 / (i * i)));
      }
    }
    for (let j = 0; j < NY; j++) u[(NR + 1) * j] = 0; // axis
    // ---- 4. projection: Σ A (φnb − φ) = r dx² ∇·u, faces weighted by radius; φ = 0 on open boundaries
    this.enforceSolid();
    let dmax = 0;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NR; i++) {
      const c = i + NR * j; if (solid[c]) { div[c] = 0; continue; }
      const d = ((i + 1) * u[i + 1 + (NR + 1) * j] - i * u[i + (NR + 1) * j]) / (i + 0.5) + v[c + NR] - v[c];
      div[c] = d * (i + 0.5) * DX;
    }
    for (let it = 0; it < 30; it++) for (let j = 0; j < NY; j++) for (let i = 0; i < NR; i++) {
      const c = i + NR * j; if (solid[c]) continue;
      let s = 0, a = 0; const rc = i + 0.5;
      if (i + 1 < NR) { if (!solid[c + 1]) { s += (i + 1) * phi[c + 1]; a += i + 1; } } else a += i + 1;
      if (i > 0 && !solid[c - 1]) { s += i * phi[c - 1]; a += i; }
      if (j + 1 < NY) { if (!solid[c + NR]) { s += rc * phi[c + NR]; a += rc; } } else a += rc;
      if (j > 0) { if (!solid[c - NR]) { s += rc * phi[c - NR]; a += rc; } } else a += rc;
      const p = (s - div[c]) / a; phi[c] += 1.7 * (p - phi[c]);
    }
    for (let j = 0; j < NY; j++) for (let i = 1; i <= NR; i++) {
      const f = i + (NR + 1) * j; if (!fu[f]) continue;
      u[f] -= ((i < NR ? phi[i + NR * j] : 0) - phi[i - 1 + NR * j]) / DX;
    }
    for (let j = 0; j <= NY; j++) for (let i = 0; i < NR; i++) {
      const f = i + NR * j; if (!fv[f]) continue;
      v[f] -= ((j < NY ? phi[i + NR * j] : 0) - (j > 0 ? phi[i + NR * (j - 1)] : 0)) / DX;
    }
    // ---- 5. mixture fraction: advect, then implicit diffusion with D(T)
    let vm = 0;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NR; i++) {
      const c = i + NR * j;
      this.uc[c] = 0.5 * (u[i + (NR + 1) * j] + u[i + 1 + (NR + 1) * j]); this.vc[c] = 0.5 * (v[c] + v[c + NR]);
      const d = ((i + 1) * u[i + 1 + (NR + 1) * j] - i * u[i + (NR + 1) * j]) / (i + 0.5) + v[c + NR] - v[c];
      if (!solid[c]) { dmax = Math.max(dmax, Math.abs(d) / DX); vm = Math.max(vm, Math.hypot(this.uc[c], this.vc[c])); }
    }
    this.divMax = dmax; this.vmax = vm;
    Z0.set(Z);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NR; i++) {
      const c = i + NR * j; if (solid[c]) continue;
      const x = (i + 0.5) - (dt * this.uc[c]) / DX, y = (j + 0.5) - (dt * this.vc[c]) / DX;
      Z[c] = x > NR || y < 0 ? 0 : bil(Z0, NR, NY, Math.max(0.5, x) - 0.5, y - 0.5);
    }
    Z0.set(Z);
    // fuel vapour at the wick follows the heat it receives from the flame
    const zw = this.zw = Z_WICK * Math.max(0.2, (this.Tf - T_WICK) / (T_MAX - T_WICK));
    for (let it = 0; it < 8; it++) for (let j = 0; j < NY; j++) for (let i = 0; i < NR; i++) {
      const c = i + NR * j; if (wick[c]) { Z[c] = zw; continue; } if (solid[c]) continue;
      const a = k * D[c], wE = (i + 1) / (i + 0.5), wW = i / (i + 0.5), z = Z[c];
      const e = i + 1 < NR ? (wall[c + 1] ? z : Z[c + 1]) : 0, w = i > 0 ? (wall[c - 1] ? z : Z[c - 1]) : z;
      const n = j + 1 < NY ? (wall[c + NR] ? z : Z[c + NR]) : z, sdn = j > 0 ? (wall[c - NR] ? z : Z[c - NR]) : 0;
      Z[c] = (Z0[c] + a * (wE * e + wW * w + n + sdn)) / (1 + a * (wE + wW + 2));
    }
    // ---- 6. flame temperature from the dissipation rate on the sheet, then state relations
    let sa = 0, sw = 0, hTop = 0, wMax = 0, flux = 0;
    for (let j = 1; j < NY - 1; j++) for (let i = 0; i < NR; i++) {
      const c = i + NR * j; if (solid[c]) continue;
      if (Z[c] >= Z_ST) { hTop = Math.max(hTop, j + 1); wMax = Math.max(wMax, i + 1); }
      if (Math.abs(Z[c] - Z_ST) > 0.3 * Z_ST) continue;
      const gx = ((i + 1 < NR ? Z[c + 1] : 0) - (i > 0 ? Z[c - 1] : Z[c])) / (i > 0 ? 2 * DX : DX), gy = (Z[c + NR] - Z[c - NR]) / (2 * DX);
      sa += D[c] * (gx * gx + gy * gy) * (i + 0.5); sw += i + 0.5;
    }
    // fuel leaving the wick by diffusion (ρD ≈ 2.6e-5 kg/m/s at the wick, Stefan factor 1/(1 − Z_w)), kg/s
    for (let j = CANDLE_H; j < CANDLE_H + WICK_H; j++) flux += (zw - Z[WICK_R + NR * j]) / (DX / 2) * 2 * Math.PI * WICK_R * DX * DX;
    for (let i = 0; i < WICK_R; i++) flux += (zw - Z[i + NR * (CANDLE_H + WICK_H)]) / (DX / 2) * Math.PI * ((i + 1) ** 2 - i ** 2) * DX * DX;
    this.fuelRate = (2.6e-5 * flux) / (1 - zw);
    this.strain = sw > 0 ? sa / sw : 0;
    const target = T_INF + (T_MAX - T_INF) * (this.strain / (this.strain + A_HALF));
    this.Tf += (Math.max(1100, target) - this.Tf) * Math.min(1, dt / 0.15);
    this.height = Math.max(0, hTop - CANDLE_H) * DX; this.width = 2 * wMax * DX;
    this.thermo();
    this.time += dt;
  }

  private ur = new Float32Array((NR + 1) * NY); private vr = new Float32Array(NR * (NY + 1));

  private enforceSolid() {
    const { u, v, fu, fv } = this;
    for (let f = 0; f < u.length; f++) if (!fu[f]) u[f] = 0;
    for (let f = 0; f < v.length; f++) if (!fv[f]) v[f] = 0;
  }

  computeVorticity() {
    const { uc, vc, vort } = this;
    for (let j = 1; j < NY - 1; j++) for (let i = 0; i < NR; i++) {
      const c = i + NR * j;
      vort[c] = ((i + 1 < NR ? vc[c + 1] : vc[c]) - (i > 0 ? vc[c - 1] : vc[c])) / (i > 0 && i + 1 < NR ? 2 * DX : DX) - (uc[c + NR] - uc[c - NR]) / (2 * DX);
    }
  }
}

export const GEOM = { CANDLE_R, CANDLE_H, WICK_R, WICK_H };

function bil(a: Float32Array, nx: number, ny: number, gx: number, gy: number) {
  gx = gx < 0 ? 0 : gx > nx - 1 ? nx - 1 : gx; gy = gy < 0 ? 0 : gy > ny - 1 ? ny - 1 : gy;
  const i = Math.min(nx - 2, gx | 0), j = Math.min(ny - 2, gy | 0), fx = gx - i, fy = gy - j, c = i + nx * j;
  return (a[c] * (1 - fx) + a[c + 1] * fx) * (1 - fy) + (a[c + nx] * (1 - fx) + a[c + nx + 1] * fx) * fy;
}
