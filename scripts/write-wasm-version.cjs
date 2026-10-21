const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

// Records provenance for a WASM build without touching the qwqwq sources.
// Usage: node scripts/write-wasm-version.cjs <qwqwq root> <output dir>
function readVersion(rootDir) {
  const headerPath = path.join(rootDir, "src", "include", "version.hpp");
  if (!fs.existsSync(headerPath)) return "";
  const match = fs.readFileSync(headerPath, "utf8").match(/kVersion\s*=\s*"([^"]+)"/);
  return match ? match[1] : "";
}

function readCommit(rootDir) {
  try {
    return execFileSync("git", ["-C", rootDir, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

const rootDir = path.resolve(process.argv[2] ?? ".");
const outputDir = path.resolve(process.argv[3] ?? "src/wasm");
const version = readVersion(rootDir);
if (!version) {
  console.error(`Could not read kVersion from ${path.join(rootDir, "src", "include", "version.hpp")}`);
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });
const metadata = {
  qwqwqVersion: version,
  qwqwqCommit: readCommit(rootDir),
  builtAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outputDir, "version.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
console.log(`Recorded qwqwq ${version}${metadata.qwqwqCommit ? ` (${metadata.qwqwqCommit.slice(0, 7)})` : ""} for ${path.relative(process.cwd(), outputDir) || "."}`);
