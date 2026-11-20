import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In compose, API_PROXY_TARGET=http://backend:8000; locally it defaults to localhost.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
});
