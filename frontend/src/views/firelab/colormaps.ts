/** Perceptually uniform scientific colormaps (polynomial fits of matplotlib's viridis / inferno / plasma),
 *  shared by the GLSL shaders and the HTML legends so the two always agree. */

type V3 = [number, number, number];
const POLY: Record<"viridis" | "inferno" | "plasma", V3[]> = {
  viridis: [
    [0.2777273272234177, 0.005407344544966578, 0.3340998053353061],
    [0.1050930431085774, 1.404613529898575, 1.384590162594685],
    [-0.3308618287255563, 0.214847559468213, 0.09509516302823659],
    [-4.634230498983486, -5.799100973351585, -19.33244095627987],
    [6.228269936347081, 14.17993336680509, 56.69055260068105],
    [4.776384997670288, -13.74514537774601, -65.35303263337234],
    [-5.435455855934631, 4.645852612178535, 26.3124352495832],
  ],
  inferno: [
    [0.0002189403691192265, 0.001651004631001012, -0.01948089843709184],
    [0.1065134194856116, 0.5639564367884091, 3.932712388889277],
    [11.60249308247187, -3.972853965665698, -15.9423941062914],
    [-41.70399613139459, 17.43639888205313, 44.35414519872813],
    [77.162935699427, -33.40235894210092, -81.80730925738993],
    [-71.31942824499214, 32.62606426397723, 73.20951985803202],
    [25.13112622477341, -12.24266895238567, -23.07032500287172],
  ],
  plasma: [
    [0.05873234392399702, 0.02333670892565664, 0.5433401826748754],
    [2.176514634195958, 0.2383834171260182, 0.7539604599784036],
    [-2.689460476458034, -7.455851135738909, 3.110799939717086],
    [6.130348345893603, 42.3461881477227, -28.51885465332158],
    [-11.10743619062271, -82.66631109428045, 60.13984767418263],
    [10.02306557647065, 71.41361770095349, -54.07218655560067],
    [-3.658713842777788, -22.93153465461149, 18.19190778539828],
  ],
};

export type CMap = "viridis" | "inferno" | "plasma" | "gray" | "diverging";

export function cmap(name: CMap, t: number): V3 {
  t = Math.max(0, Math.min(1, t));
  if (name === "gray") { const g = 0.08 + 0.9 * t; return [g, g, g]; }
  if (name === "diverging") {
    // cool–warm (Moreland) through a neutral grey
    const a: V3 = [0.23, 0.30, 0.75], m: V3 = [0.87, 0.87, 0.87], b: V3 = [0.71, 0.02, 0.15];
    const [p, q, u] = t < 0.5 ? [a, m, t * 2] : [m, b, (t - 0.5) * 2];
    return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u];
  }
  const c = POLY[name];
  const out: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    let v = c[6][k];
    for (let n = 5; n >= 0; n--) v = v * t + c[n][k];
    out[k] = Math.max(0, Math.min(1, v));
  }
  return out;
}

export function cmapCss(name: CMap, stops = 12): string {
  const s: string[] = [];
  for (let k = 0; k <= stops; k++) {
    const [r, g, b] = cmap(name, k / stops);
    s.push(`rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) ${((k / stops) * 100).toFixed(0)}%`);
  }
  return `linear-gradient(90deg, ${s.join(",")})`;
}

const glslVec = (v: V3) => `vec3(${v.map((x) => x.toFixed(10)).join(",")})`;
const glslPoly = (name: "viridis" | "inferno" | "plasma") => {
  const c = POLY[name];
  return `vec3 ${name}(float t){ t=clamp(t,0.,1.); return clamp(${glslVec(c[0])}+t*(${glslVec(c[1])}+t*(${glslVec(c[2])}+t*(${glslVec(c[3])}+t*(${glslVec(c[4])}+t*(${glslVec(c[5])}+t*${glslVec(c[6])}))))),0.,1.); }`;
};

export const GLSL_CMAPS = `
${glslPoly("viridis")}
${glslPoly("inferno")}
${glslPoly("plasma")}
vec3 grayc(float t){ float g=0.08+0.9*clamp(t,0.,1.); return vec3(g); }
vec3 diverging(float t){ t=clamp(t,0.,1.); vec3 a=vec3(.23,.30,.75), m=vec3(.87), b=vec3(.71,.02,.15);
  return t<.5 ? mix(a,m,t*2.) : mix(m,b,(t-.5)*2.); }
vec3 applyCmap(int id, float t){
  if(id==0) return viridis(t); if(id==1) return inferno(t); if(id==2) return plasma(t); if(id==3) return grayc(t); return diverging(t);
}
`;
export const CMAP_ID: Record<CMap, number> = { viridis: 0, inferno: 1, plasma: 2, gray: 3, diverging: 4 };
