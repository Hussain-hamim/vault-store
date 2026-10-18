import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  build: { outDir: "dist/client", chunkSizeWarningLimit: 1100 },
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    allowedHosts: ["terminal.local"],
    proxy: { "/api": "http://127.0.0.1:4174" },
  },
});
