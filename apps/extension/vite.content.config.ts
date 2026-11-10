import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const r = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@jobpilot/shared": r("../../packages/shared/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    lib: {
      entry: r("src/content/index.ts"),
      name: "JobPilotContent",
      formats: ["iife"],
      fileName: () => "content.js",
    },
  },
});
