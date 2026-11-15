/**
 * Background of the first page: streamlines of a slow, mostly horizontal flow, drawn like the streamlines of the
 * simulation (thin lines, coloured by speed from teal to yellow). The field is divergence-free, built from a stream
 * function ψ = U·y + Σ aₖ sin(kₓx − ωt + φ) sin(k_y y), so u = ∂ψ/∂y and v = −∂ψ/∂x. Decorative, not a simulation.
 */
import { useEffect, useRef } from "react";

const MODES = [
  { a: 0.32, kx: 1.6, ky: 2.1, w: 0.11, p: 0.3 },
  { a: 0.18, kx: 3.1, ky: 1.3, w: -0.07, p: 1.9 },
  { a: 0.09, kx: 5.2, ky: 4.4, w: 0.16, p: 4.1 },
];
const U = 1.0;

export default function FlowBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext("2d")!;
    let W = 0, H = 0, dpr = 1;
    const resize = () => { dpr = Math.min(2, window.devicePixelRatio); W = cv.width = Math.round(window.innerWidth * dpr); H = cv.height = Math.round(window.innerHeight * dpr); ctx.fillStyle = "#050606"; ctx.fillRect(0, 0, W, H); };
    resize(); window.addEventListener("resize", resize);
    // velocity in units of the screen height per second
    const vel = (x: number, y: number, t: number): [number, number] => {
      let u = U, v = 0;
      for (const m of MODES) {
        const sx = Math.sin(m.kx * x - m.w * t + m.p), cx = Math.cos(m.kx * x - m.w * t + m.p), sy = Math.sin(m.ky * y), cy = Math.cos(m.ky * y);
        u += m.a * m.ky * sx * cy; v -= m.a * m.kx * cx * sy;
      }
      return [u, v];
    };
    const N = 1300;
    const P = Array.from({ length: N }, () => ({ x: Math.random() * 3, y: Math.random(), life: Math.random() * 6 }));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, last = performance.now(), t = 0;
    const colour = (s: number) => {
      // teal (low speed) → yellow (high speed), like the streamline colouring in the simulation
      const k = Math.max(0, Math.min(1, (s - 0.55) / 1.0));
      return `rgba(${Math.round(76 + 170 * k)},${Math.round(194 + 32 * k)},${Math.round(176 - 60 * k)},`;
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick); if (document.hidden) { last = now; return; }
      const dt = Math.min(0.05, (now - last) / 1000); last = now; step(dt);
    };
    const step = (dt: number) => {
      t += dt;
      ctx.fillStyle = "rgba(5,6,6,0.07)"; ctx.fillRect(0, 0, W, H);
      const asp = W / H, sp = 0.035;
      ctx.lineWidth = dpr; ctx.lineCap = "round";
      for (const p of P) {
        const [u, v] = vel(p.x, p.y, t); const s = Math.hypot(u, v);
        const nx = p.x + u * sp * dt * 4, ny = p.y + v * sp * dt * 4;
        ctx.strokeStyle = colour(s) + "0.42)";
        ctx.beginPath(); ctx.moveTo((p.x / asp) * W, p.y * H); ctx.lineTo((nx / asp) * W, ny * H); ctx.stroke();
        p.x = nx; p.y = ny; p.life -= dt;
        if (p.x > asp + 0.05 || p.y < -0.05 || p.y > 1.05 || p.life < 0) { p.x = Math.random() < 0.7 ? -0.02 : Math.random() * asp; p.y = Math.random(); p.life = 4 + Math.random() * 8; }
      }
    };
    if (reduce) for (let q = 0; q < 240; q++) step(0.016);
    else raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} className="flow-bg" aria-hidden="true" />;
}
