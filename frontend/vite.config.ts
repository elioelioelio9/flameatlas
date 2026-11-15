import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs on :8000 (uvicorn); Vite proxies /api to it.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8000" } },
  // VITE_STATIC=1: server-less build for GitHub Pages (relative paths, answers from static-api/)
  base: process.env.VITE_STATIC ? "./" : "/",
  build: { outDir: "dist", sourcemap: false },
});
