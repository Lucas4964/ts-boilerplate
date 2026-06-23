import { defineConfig } from "vite";

// Static SPA. `base: "./"` keeps asset paths relative so the built `dist/`
// can be opened from the file system (e.g. loaded by the Electron wrapper),
// mirroring how the original app loads war/circuitjs.html via file://.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    target: "es2020",
  },
});
