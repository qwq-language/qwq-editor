const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

// Records provenance for a freshly built WASM directory: the version from
// version.hpp plus the source commit, without touching the qwqwq tree.
function record(rootDir, outputDir) {
  const version = fs.readFileSync(path.join(rootDir, "src", "include", "version.hpp"), "utf8").match(/kVersion\s*=\s*"([^"]+)"/)?.[1];
  if (!version) {
    console.error("Could not read kVersion from version.hpp");
    process.exit(1);
  }
  let commit = "";
  try {
    commit = execFileSync("git", ["-C", rootDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {}
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "version.json"),
    `${JSON.stringify({ qwqwqVersion: version, qwqwqCommit: commit, builtAt: new Date().toISOString() }, null, 2)}\n`,
  );
  console.log(`Recorded qwqwq ${version} for ${path.relative(process.cwd(), outputDir)}`);
}

// Prints the qwqwq version of a WASM build directory.
// The value comes from the compiled binary's qwq_version export; when a build
// predates that export, it falls back to the version.json written at build time.
// Usage: node scripts/wasm-version.cjs [src/wasm | src/wasm-analysis] [--json]
function readRecordedVersion(moduleDir) {
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(moduleDir, "version.json"), "utf8"));
    return typeof metadata.qwqwqVersion === "string" ? metadata : null;
  } catch {
    return null;
  }
}

async function readBinaryVersion(moduleDir) {
  const imported = await import(pathToFileURL(path.join(moduleDir, "qwq.js")).href);
  const createQwqModule = imported.default ?? imported.createQwqModule;
  if (typeof createQwqModule !== "function") throw new Error("No module factory was exported by qwq.js");
  const module = await createQwqModule({ wasmBinary: fs.readFileSync(path.join(moduleDir, "qwq.wasm")) });
  if (typeof module._qwq_version !== "function") return "";
  return module.ccall("qwq_version", "string", [], []);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--record") return record(path.resolve(args[1] ?? "."), path.resolve(args[2] ?? "src/wasm"));

  const asJson = args.includes("--json");
  const moduleDir = path.resolve(args.find((arg) => !arg.startsWith("--")) ?? "src/wasm");

  for (const filePath of [path.join(moduleDir, "qwq.js"), path.join(moduleDir, "qwq.wasm")]) {
    if (!fs.existsSync(filePath)) {
      console.error(`Missing ${path.relative(process.cwd(), filePath)}`);
      process.exit(1);
    }
  }

  let version = "";
  let source = "binary";
  try {
    version = await readBinaryVersion(moduleDir);
  } catch {}
  if (!version) {
    const recorded = readRecordedVersion(moduleDir);
    version = recorded?.qwqwqVersion ?? "";
    source = recorded ? "version.json" : "";
  }

  if (!version) {
    console.error("This WASM build does not report a version. Rebuild it with QWQ_REBUILD_WASM=1.");
    process.exit(1);
  }

  if (!asJson) {
    process.stdout.write(`${version}\n`);
    return;
  }
  const recorded = readRecordedVersion(moduleDir);
  process.stdout.write(`${JSON.stringify({
    version,
    source,
    commit: recorded?.qwqwqCommit ?? "",
    builtAt: recorded?.builtAt ?? "",
    directory: path.relative(process.cwd(), moduleDir) || ".",
  })}\n`);
}

main().catch((error) => {
  console.error(String(error?.message ?? error));
  process.exit(1);
});
