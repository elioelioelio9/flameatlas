/**
 * Soft billboard particles (one draw call): used for rocket exhaust, steam clouds, smoke and flames.
 * Each particle carries position, velocity, age/life and grows / fades over its life. The caller owns the physics
 * (it can move particles itself with a velocity field) or lets the system integrate a simple drift.
 */
import * as THREE from "three";

export interface PuffOptions {
  max: number;
  additive?: boolean;
  /** start and end size (world units) */
  size: [number, number];
  /** start and end colour */
  color: [THREE.ColorRepresentation, THREE.ColorRepresentation];
  /** start and end opacity */
  opacity: [number, number];
  /** extra opacity ramp at birth (fraction of life) */
  fadeIn?: number;
  /** procedural billow inside each sprite (0 = smooth) */
  billow?: number;
  /** linear drag (1/s) and constant acceleration applied by step() */
  drag?: number;
  accel?: [number, number, number];
  lit?: boolean;
}

export class Puffs {
  readonly points: THREE.Points;
  readonly pos: Float32Array; readonly vel: Float32Array; readonly age: Float32Array; readonly life: Float32Array; readonly seed: Float32Array;
  private geo: THREE.BufferGeometry; private mat: THREE.ShaderMaterial; private next = 0;
  readonly n: number; private opts: PuffOptions;

  constructor(opts: PuffOptions) {
    this.opts = opts; this.n = opts.max;
    this.pos = new Float32Array(this.n * 3).fill(-9999); this.vel = new Float32Array(this.n * 3);
    this.age = new Float32Array(this.n).fill(1); this.life = new Float32Array(this.n).fill(1); this.seed = new Float32Array(this.n);
    for (let q = 0; q < this.n; q++) this.seed[q] = Math.random();
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aT", new THREE.BufferAttribute(new Float32Array(this.n), 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSeed", new THREE.BufferAttribute(this.seed, 1));
    const c0 = new THREE.Color(opts.color[0]), c1 = new THREE.Color(opts.color[1]);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uS0: { value: opts.size[0] }, uS1: { value: opts.size[1] }, uC0: { value: c0 }, uC1: { value: c1 },
        uA0: { value: opts.opacity[0] }, uA1: { value: opts.opacity[1] }, uFadeIn: { value: opts.fadeIn ?? 0.08 },
        uScale: { value: 800 }, uBillow: { value: opts.billow ?? 0.6 }, uTime: { value: 0 },
        uLight: { value: new THREE.Color(0, 0, 0) }, uLightPos: { value: new THREE.Vector3() }, uLightR: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aT; attribute float aSeed;
        uniform float uS0, uS1, uScale;
        varying float vT; varying float vSeed; varying vec3 vWorld;
        void main(){
          vT = aT; vSeed = aSeed;
          vec4 w = modelMatrix * vec4(position, 1.); vWorld = w.xyz;
          vec4 mv = viewMatrix * w;
          gl_Position = projectionMatrix * mv;
          float s = mix(uS0, uS1, sqrt(clamp(aT, 0., 1.))) * (0.75 + 0.5 * aSeed);
          gl_PointSize = aT >= 1. ? 0. : s * uScale / max(0.01, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uC0, uC1, uLight, uLightPos; uniform float uA0, uA1, uFadeIn, uBillow, uTime, uLightR;
        varying float vT; varying float vSeed; varying vec3 vWorld;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 p = gl_PointCoord * 2. - 1.; float r = length(p);
          if (r > 1.) discard;
          float a = vSeed * 6.283 + vT * 1.7;
          vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
          float n = vn(q * 2.6 + vSeed * 17.) * 0.6 + vn(q * 5.3 - vSeed * 9.) * 0.4;
          float soft = smoothstep(1., 0.15, r) * mix(1., 0.45 + 0.9 * n, uBillow);
          float alpha = soft * mix(uA0, uA1, vT) * smoothstep(0., uFadeIn, vT);
          if (alpha < 0.003) discard;
          vec3 col = mix(uC0, uC1, vT) * (0.82 + 0.3 * n);
          float d = length(vWorld - uLightPos); col += uLight * exp(-d * d / (uLightR * uLightR));
          gl_FragColor = vec4(col, alpha);
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = opts.additive ? 6 : 5;
  }

  setLight(color: THREE.Color, pos: THREE.Vector3, radius: number) { this.mat.uniforms.uLight.value.copy(color); this.mat.uniforms.uLightPos.value.copy(pos); this.mat.uniforms.uLightR.value = radius; }
  setViewportHeight(px: number) { this.mat.uniforms.uScale.value = px * 0.9; }
  setSize(s0: number, s1: number) { this.mat.uniforms.uS0.value = s0; this.mat.uniforms.uS1.value = s1; }
  /** multiply the configured sizes (for systems inside a scaled group: point sizes ignore the model scale) */
  setScale(k: number) { this.mat.uniforms.uS0.value = this.opts.size[0] * k; this.mat.uniforms.uS1.value = this.opts.size[1] * k; }
  setColors(c0: THREE.ColorRepresentation, c1: THREE.ColorRepresentation) { this.mat.uniforms.uC0.value.set(c0); this.mat.uniforms.uC1.value.set(c1); }
  setOpacity(a0: number, a1: number) { this.mat.uniforms.uA0.value = a0; this.mat.uniforms.uA1.value = a1; }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) {
    const q = this.next; this.next = (this.next + 1) % this.n;
    this.pos[q * 3] = x; this.pos[q * 3 + 1] = y; this.pos[q * 3 + 2] = z;
    this.vel[q * 3] = vx; this.vel[q * 3 + 1] = vy; this.vel[q * 3 + 2] = vz;
    this.age[q] = 0; this.life[q] = life;
    return q;
  }

  clear() { this.age.fill(1); this.life.fill(1); this.pos.fill(-9999); this.sync(); }

  /** integrate drift + drag + accel; optional velocity field (adds to particle velocity as advection) */
  step(dt: number, field?: (x: number, y: number, z: number) => [number, number, number] | null, blocked?: (x: number, y: number, z: number) => boolean, jitter = 0) {
    const drag = this.opts.drag ?? 0, acc = this.opts.accel ?? [0, 0, 0], k = Math.exp(-drag * dt);
    for (let q = 0; q < this.n; q++) {
      if (this.age[q] >= this.life[q]) continue;
      this.age[q] += dt;
      const o = q * 3;
      this.vel[o] = this.vel[o] * k + acc[0] * dt; this.vel[o + 1] = this.vel[o + 1] * k + acc[1] * dt; this.vel[o + 2] = this.vel[o + 2] * k + acc[2] * dt;
      let fx = 0, fy = 0, fz = 0;
      if (field) { const f = field(this.pos[o], this.pos[o + 1], this.pos[o + 2]); if (f === null) { this.age[q] = this.life[q]; continue; } [fx, fy, fz] = f; }
      const nx = this.pos[o] + (this.vel[o] + fx) * dt + (jitter ? (Math.random() - 0.5) * jitter : 0);
      const ny = this.pos[o + 1] + (this.vel[o + 1] + fy) * dt + (jitter ? (Math.random() - 0.5) * jitter : 0);
      const nz = this.pos[o + 2] + (this.vel[o + 2] + fz) * dt + (jitter ? (Math.random() - 0.5) * jitter : 0);
      if (blocked && blocked(nx, ny, nz)) { this.vel[o] *= 0.5; this.vel[o + 1] *= 0.5; this.vel[o + 2] *= 0.5; continue; }
      this.pos[o] = nx; this.pos[o + 1] = ny; this.pos[o + 2] = nz;
    }
    this.sync();
  }

  sync() {
    const t = this.geo.attributes.aT.array as Float32Array;
    for (let q = 0; q < this.n; q++) t[q] = Math.min(1, this.age[q] / this.life[q]);
    this.geo.attributes.aT.needsUpdate = true; this.geo.attributes.position.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.mat.dispose(); }
}
