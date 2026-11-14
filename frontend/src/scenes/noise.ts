/** Small deterministic noise toolkit (value noise + fBm + ridged + worley-ish craters) for procedural terrain. */

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function hash3(x: number, y: number, z: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144269) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** smooth 3-D value noise in [-1, 1] */
export function noise3(x: number, y: number, z: number, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  let acc = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
    const wt = (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
    acc += wt * hash3(xi + dx, yi + dy, zi + dz, seed);
  }
  return acc * 2 - 1;
}
export const noise2 = (x: number, y: number, seed = 0) => noise3(x, y, 0.5, seed);

export function fbm2(x: number, y: number, oct = 5, seed = 0, lac = 2.03, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let o = 0; o < oct; o++) { s += a * noise2(x * f, y * f, seed + o * 17); n += a; a *= gain; f *= lac; }
  return s / n;
}
export function ridged2(x: number, y: number, oct = 5, seed = 0) {
  let a = 1, f = 1, s = 0, n = 0, prev = 1;
  for (let o = 0; o < oct; o++) {
    let r = 1 - Math.abs(noise2(x * f, y * f, seed + o * 31)); r *= r; r *= prev; prev = r;
    s += a * r; n += a; a *= 0.5; f *= 2.1;
  }
  return s / n;
}
export function fbm3(x: number, y: number, z: number, oct = 4, seed = 0) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let o = 0; o < oct; o++) { s += a * noise3(x * f, y * f, z * f, seed + o * 13); n += a; a *= 0.5; f *= 2.0; }
  return s / n;
}

export interface Crater { x: number; z: number; r: number; depth: number }
/** crater profile: bowl + raised rim + ejecta falloff (heights relative to crater radius) */
export function craterHeight(cs: Crater[], x: number, z: number) {
  let h = 0;
  for (const c of cs) {
    const d = Math.hypot(x - c.x, z - c.z) / c.r;
    if (d > 2.4) continue;
    if (d < 1) h += c.depth * (d * d - 1) + c.depth * 0.25 * Math.pow(d, 6);
    else h += c.depth * 0.25 * Math.exp(-((d - 1) * (d - 1)) / 0.12);
  }
  return h;
}

export const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
