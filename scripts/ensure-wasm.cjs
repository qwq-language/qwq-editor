const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const mode = process.argv[2];
const webEditorDir = path.resolve(__dirname, "..");
const outputs = {
  full: ["src/wasm/qwq.js", "src/wasm/qwq.wasm"],
  analysis: ["src/wasm-analysis/qwq.js", "src/wasm-analysis/qwq.wasm"],
};

if (!Object.hasOwn(outputs, mode)) {
  console.error(`Usage: node ${path.basename(__filename)} <full|analysis>`);
  process.exit(2);
}

function hasOutputFiles() {
  return outputs[mode].every((relativePath) => {
    const filePath = path.join(webEditorDir, relativePath);
    try {
      return fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
    } catch {
      return false;
    }
  });
}

if (hasOutputFiles() && process.env.QWQ_REBUILD_WASM !== "1") {
  console.log(`Using checked-in ${mode} WASM assets.`);
  process.exit(0);
}

const rootDir = path.resolve(process.env.QWQ_ROOT_DIR || path.join(webEditorDir, ".."));
if (!fs.existsSync(path.join(rootDir, "src", "ast.cpp"))) {
  console.error(`Missing ${mode} WASM assets, and no qwqwq C++ source tree was found at ${rootDir}.`);
  console.error("The editor can build from its included WASM assets. To regenerate them, set QWQ_ROOT_DIR to a qwqwq source checkout and QWQ_REBUILD_WASM=1.");
  process.exit(1);
}

const env = { ...process.env, QWQ_REBUILD_WASM: "1" };
if (mode === "analysis") {
  env.QWQ_ANALYZE_ONLY = "1";
  env.QWQ_WASM_OUTPUT_DIR = process.env.QWQ_WASM_OUTPUT_DIR || "src/wasm-analysis";
} else if (!process.env.QWQ_WASM_OUTPUT_DIR) {
  delete env.QWQ_ANALYZE_ONLY;
}

const runner = path.join(__dirname, "run-platform-script.cjs");
const result = spawnSync(process.execPath, [runner, "build-wasm"], {
  cwd: webEditorDir,
  env,
  stdio: "inherit",
});
if (result.error) {
  console.error(`Failed to rebuild ${mode} WASM: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
