const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Turns electron-builder output in release/ into the published release assets:
// a portable .7z per platform plus the native installers, named with --suffix.
// Usage: node scripts/release-assets.cjs --suffix <target-triple> [--version <v>]

const root = path.resolve(__dirname, "..");
const releaseDir = path.join(root, "release");
const assetsDir = path.join(root, "release-assets");

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? "" : (args[index + 1] ?? "");
};
const version = option("version") || JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const suffix = option("suffix") || `${process.arch}-${process.platform}`;
const stem = `qwq-editor-${version}-${suffix}`;

if (!fs.existsSync(releaseDir)) {
  console.error("release-assets: run electron-builder first; release/ is missing");
  process.exit(1);
}

function sevenZip() {
  try {
    const bundled = require("7zip-bin").path7za;
    if (bundled && fs.existsSync(bundled)) {
      if (process.platform !== "win32") fs.chmodSync(bundled, 0o755);
      return bundled;
    }
  } catch {}
  for (const candidate of [process.env.SEVEN_ZIP, "7z", "7za", "7zz"].filter(Boolean)) {
    if (spawnSync(candidate, ["i"], { stdio: "ignore" }).status === 0) return candidate;
  }
  console.error("release-assets: no 7-Zip executable found");
  process.exit(1);
}

function compress(type, archivePath, sourcePath, entryName) {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "qwq-release-"));
  try {
    const target = path.join(staging, entryName);
    if (fs.statSync(sourcePath).isDirectory()) fs.cpSync(sourcePath, target, { recursive: true, verbatimSymlinks: true });
    else fs.copyFileSync(sourcePath, target);
    const flags = ["a", `-t${type}`, "-mx=9", "-bd", "-y", archivePath, entryName];
    // macOS bundles depend on symlinks inside their frameworks.
    if (process.platform === "darwin") flags.splice(1, 0, "-snl");
    const result = spawnSync(sevenZip(), flags, { cwd: staging, stdio: "inherit" });
    if (result.status !== 0) {
      console.error(`release-assets: 7-Zip failed on ${entryName}`);
      process.exit(1);
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  const size = (fs.statSync(archivePath).size / 1024 / 1024).toFixed(1);
  console.log(`${path.basename(archivePath)}  ${size} MiB`);
}

function find(regex) {
  return fs.readdirSync(releaseDir).filter((name) => regex.test(name)).map((name) => path.join(releaseDir, name));
}

fs.mkdirSync(assetsDir, { recursive: true });
fs.rmSync(assetsDir, { recursive: true, force: true });
fs.mkdirSync(assetsDir, { recursive: true });

// Portable build: the unpacked application tree, or the macOS bundle.
const unpacked = find(/-unpacked$/)[0];
const macBundle = find(/\.app$/)[0] ?? (unpacked && find(/\.app$/)[0]);
if (unpacked) {
  compress("7z", path.join(assetsDir, `${stem}.7z`), unpacked, "qwq-editor");
} else if (macBundle) {
  compress("7z", path.join(assetsDir, `${stem}.7z`), macBundle, "qwq-editor.app");
}

// Installers. A bare .exe is refused by Edge/SmartScreen, so it ships zipped
// with a short inner name; the other installers are published as they are.
for (const installer of find(/\.exe$/)) {
  compress("zip", path.join(assetsDir, `${stem}-setup.zip`), installer, `qwq-editor-${version}-setup.exe`);
}
for (const installer of find(/\.(dmg|deb|AppImage|rpm)$/)) {
  const extension = path.extname(installer);
  const name = extension === ".AppImage" ? `${stem}.AppImage` : `${stem}${extension}`;
  fs.copyFileSync(installer, path.join(assetsDir, name));
  console.log(`${name}  ${(fs.statSync(path.join(assetsDir, name)).size / 1024 / 1024).toFixed(1)} MiB`);
}

if (!fs.readdirSync(assetsDir).length) {
  console.error("release-assets: nothing to publish; check the electron-builder targets");
  process.exit(1);
}
