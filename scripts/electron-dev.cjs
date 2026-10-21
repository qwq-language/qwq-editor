const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const webEditorDir = path.resolve(__dirname, "..");
const viteEntry = require.resolve("vite");
const viteCli = path.resolve(path.dirname(viteEntry), "..", "..", "bin", "vite.js");
const electronBinary = require("electron");
const devUrl = "http://127.0.0.1:5174/";

if (!fs.existsSync(viteCli)) {
  throw new Error(`Cannot locate the Vite CLI at ${viteCli}`);
}

const childEnvironment = {
  ...process.env,
  VITE_DEV_SERVER_URL: devUrl,
};
const vite = spawn(process.execPath, [viteCli, "--mode", "electron", "--host", "127.0.0.1", "--port", "5174", "--strictPort"], {
  cwd: webEditorDir,
  env: childEnvironment,
  stdio: ["inherit", "pipe", "pipe"],
});

let electron = null;
let shuttingDown = false;
let viteOutput = "";

function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = code;
  if (electron && electron.exitCode === null) electron.kill();
  if (vite.exitCode === null) vite.kill();
}

function forwardViteOutput(stream, destination) {
  stream.on("data", (chunk) => {
    destination.write(chunk);
    viteOutput = `${viteOutput}${chunk.toString()}`.slice(-4000);
    if (!electron && /ready in|Local:\s+http:\/\/127\.0\.0\.1:5174/i.test(viteOutput)) {
      electron = spawn(electronBinary, ["."], {
        cwd: webEditorDir,
        env: childEnvironment,
        stdio: "inherit",
      });
      electron.once("error", (error) => {
        console.error(`Failed to start Electron: ${error.message}`);
        stop(1);
      });
      electron.once("exit", (code) => stop(code ?? 0));
    }
  });
}

forwardViteOutput(vite.stdout, process.stdout);
forwardViteOutput(vite.stderr, process.stderr);
vite.once("error", (error) => {
  console.error(`Failed to start Vite: ${error.message}`);
  stop(1);
});
vite.once("exit", (code) => {
  if (!shuttingDown) stop(code ?? 1);
});

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
