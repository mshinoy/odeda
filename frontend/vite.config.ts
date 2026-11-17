import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// In dev the browser talks only to Vite; /api is proxied to FastAPI so the
// session cookie stays same-origin and the backend needs no CORS.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiUrl = env.VITE_API_URL || "http://127.0.0.1:8000";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": path.resolve(import.meta.dirname, "src") },
    },
    // The build is served by FastAPI from the Python package (odeda/ui/).
    build: {
      outDir: path.resolve(import.meta.dirname, "../odeda/ui"),
      emptyOutDir: true,
    },
    server: {
      allowedHosts: [".ts.net"],
      proxy: {
        "/api": { target: apiUrl, changeOrigin: true },
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
      passWithNoTests: true,
    },
  };
});
