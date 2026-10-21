import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const webEditorDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const analysisOnly = mode === "electron";
  const base = mode === "electron" ? "./" : (process.env.VITE_BASE_PATH || "/");

  return {
    base,
    resolve: {
      alias: analysisOnly
        ? [
            {
              find: /^\.\/wasm\/qwq\.js$/,
              replacement: path.join(webEditorDir, "src/wasm-analysis/qwq.js"),
            },
          ]
        : [],
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: true,
    },
    preview: {
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
