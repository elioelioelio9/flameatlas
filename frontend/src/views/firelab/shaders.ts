import * as THREE from "three";
import { GLSL_CMAPS } from "./colormaps";

const DIMS = "uniform vec3 DIMS;";

/** Ray-marched volume (smoke as absorbing medium, heat / CO2 as emissive medium) */
export function volumeMaterial(tex: THREE.Data3DTexture, dims: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true, depthWrite: false, side: THREE.BackSide,
    uniforms: { uVol: { value: tex }, uMode: { value: 0 }, uGain: { value: 1 }, DIMS: { value: dims } },
    vertexShader: /* glsl */ `
      out vec3 vWorld;
      void main(){ vec4 w = modelMatrix * vec4(position,1.); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      precision highp float; precision highp sampler3D;
      ${DIMS}
      ${GLSL_CMAPS}
      uniform sampler3D uVol; uniform int uMode; uniform float uGain;
      in vec3 vWorld; out vec4 outColor;
      vec2 hitBox(vec3 o, vec3 d){ vec3 inv = 1./d; vec3 t0 = (vec3(0.)-o)*inv, t1 = (DIMS-o)*inv;
        vec3 tmin = min(t0,t1), tmax = max(t0,t1); return vec2(max(max(tmin.x,tmin.y),tmin.z), min(min(tmax.x,tmax.y),tmax.z)); }
      void main(){
        vec3 o = cameraPosition; vec3 d = normalize(vWorld - o);
        vec2 t = hitBox(o, d); t.x = max(t.x, 0.); if (t.x >= t.y) discard;
        const int N = 120; float dt = (t.y - t.x) / float(N);
        float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453);
        vec3 col = vec3(0.); float a = 0.;
        for (int k = 0; k < N; k++){
          vec3 p = o + d * (t.x + (float(k)+jitter) * dt);
          vec2 tv = texture(uVol, p / DIMS).rg; float v = tv.r * step(0.5, tv.g) * uGain;
          if (v < 0.01) continue;
          vec3 c; float alpha;
          if (uMode == 0) { c = mix(vec3(.62,.62,.6), vec3(.22,.21,.2), clamp(v,0.,1.)); alpha = 1. - exp(-v * 3.2 * dt); }
          else if (uMode == 1) { c = inferno(.25 + .75*v) * (1.2 + v); alpha = 1. - exp(-v * 1.6 * dt); }
          else { c = viridis(v); alpha = 1. - exp(-v * 1.4 * dt); }
          col += (1.-a) * alpha * c; a += (1.-a) * alpha;
          if (a > .97) break;
        }
        if (a < 0.004) discard;
        outColor = vec4(col / max(a, 1e-3), a);
      }`,
  });
}

/** Cutting plane coloured by a scalar field, with iso-contours (fwidth-based, resolution independent) */
export function sliceMaterial(tex: THREE.Data3DTexture, dims: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uField: { value: tex }, uCmap: { value: 1 }, uOpacity: { value: 0.85 }, uLines: { value: 10 }, uContours: { value: 1 }, uAlphaMode: { value: 1 }, DIMS: { value: dims } },
    vertexShader: /* glsl */ `
      out vec3 vWorld;
      void main(){ vec4 w = modelMatrix * vec4(position,1.); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      precision highp float; precision highp sampler3D;
      ${DIMS}
      ${GLSL_CMAPS}
      uniform sampler3D uField; uniform int uCmap; uniform float uOpacity; uniform float uLines; uniform int uContours; uniform int uAlphaMode;
      in vec3 vWorld; out vec4 outColor;
      void main(){
        vec2 tv = texture(uField, clamp(vWorld / DIMS, 0.001, 0.999)).rg; if (tv.g < 0.5) discard; float v = tv.r;
        vec3 c = applyCmap(uCmap, v);
        if (uContours == 1) {
          float x = v * uLines; float f = abs(fract(x - .5) - .5) / max(fwidth(x), 1e-4);
          float line = 1. - clamp(f - .25, 0., 1.);
          c = mix(c, vec3(0.04), line * .55);
        }
        float w = uAlphaMode == 1 ? v : uAlphaMode == 2 ? 1. - v : 1.;
        float a = uAlphaMode == 0 ? uOpacity : uOpacity * (0.22 + 0.78 * smoothstep(0.0, 0.35, w));
        outColor = vec4(c, a);
      }`,
  });
}

/** soft additive sprites for flames (per-point colour and size) */
export function flameMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 600 } },
    vertexShader: /* glsl */ `
      attribute vec3 color; attribute float size; varying vec3 vCol; uniform float uScale;
      void main(){ vCol = color; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = size * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main(){ vec2 q = gl_PointCoord*2.-1.; float r = dot(q,q); if (r>1.) discard; float a = pow(1.-r, 2.2); gl_FragColor = vec4(vCol*a, a); }`,
  });
}
