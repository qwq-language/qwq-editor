const path = require("node:path");
const { spawnSync } = require("node:child_process");

const scriptName = process.argv[2];
const supportedScripts = new Set(["build-wasm", "predev"]);
if (!supportedScripts.has(scriptName)) {
  console.error(`Unknown platform script: ${scriptName ?? "(missing)"}`);
  process.exit(2);
}

const isWindows = process.platform === "win32";
const scriptPath = path.join(__dirname, `${scriptName}${isWindows ? ".bat" : ".sh"}`);
const result = isWindows
  ? spawnSync(scriptPath, [], {
      cwd: path.resolve(__dirname, ".."),
      env: process.env,
      shell: true,
      stdio: "inherit",
    })
  : spawnSync("bash", [scriptPath], {
      cwd: path.resolve(__dirname, ".."),
      env: process.env,
      stdio: "inherit",
    });

if (result.error) {
  console.error(`Failed to run ${scriptPath}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
