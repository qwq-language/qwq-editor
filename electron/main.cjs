const { app, BrowserWindow, dialog, ipcMain, protocol } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const MAX_OUTPUT_CHARS = 2_000_000;
const MAX_SOURCE_CHARS = 5_000_000;
const RUN_TIMEOUT_MS = 120_000;
let mainWindow = null;
let appProtocolReady = false;
const activeSessions = new Map();

protocol.registerSchemesAsPrivileged([{
  scheme: "qwq",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
}]);

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  })[extension] ?? "application/octet-stream";
}

async function registerAppProtocol() {
  if (appProtocolReady) return;
  const distRoot = path.resolve(__dirname, "..", "dist");
  await protocol.handle("qwq", async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
    const filePath = path.resolve(distRoot, relativePath);
    if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${path.sep}`)) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) throw new Error("not a file");
      const headers = {
        "Cache-Control": "no-store",
        "Content-Type": mimeType(filePath),
        "X-Content-Type-Options": "nosniff",
      };
      if (request.method === "HEAD") return new Response(null, { status: 200, headers });
      return new Response(await fsp.readFile(filePath), { status: 200, headers });
    } catch {
      return new Response("Editor asset not found. Rebuild the desktop app and try again.", { status: 404 });
    }
  });
  appProtocolReady = true;
}

function appIconPath() {
  const candidates = process.platform === "win32"
    ? [path.resolve(__dirname, "..", "dist", "app-icon.ico"), path.resolve(__dirname, "..", "public", "app-icon.ico")]
    : [path.resolve(__dirname, "..", "dist", "app-icon.png"), path.resolve(__dirname, "..", "public", "app-icon.png")];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function runtimeSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

async function readRuntimeSettings() {
  try {
    const settings = JSON.parse(await fsp.readFile(runtimeSettingsPath(), "utf8"));
    return settings && typeof settings === "object" ? settings : {};
  } catch {
    return {};
  }
}

async function readSavedRuntimePath() {
  const settings = await readRuntimeSettings();
  return typeof settings.qwqwqPath === "string" ? settings.qwqwqPath : "";
}

function isExecutable(filePath) {
  if (!filePath) return false;
  try {
    if (!fs.statSync(filePath).isFile()) return false;
    fs.accessSync(filePath, process.platform === "win32" ? fs.constants.R_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function readRuntimeVersion(executable) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(executable, ["--version"], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      resolve("");
      return;
    }

    let output = "";
    let settled = false;
    let timer = null;
    const finish = (version) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(version);
    };
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish("");
    }, 4000);

    child.stdout?.on("data", (chunk) => {
      if (output.length < 4096) output += chunk.toString();
    });
    child.once("error", () => finish(""));
    child.once("close", () => {
      const match = output.match(/\b(\d+\.\d+\.\d+[\w.+-]*)/);
      finish(match ? match[1] : "");
    });
  });
}

async function resolveRuntimePath() {
  const savedPath = await readSavedRuntimePath();
  const directCandidates = [process.env.QWQWQ_PATH, savedPath].filter(Boolean);
  for (const candidate of directCandidates) {
    const resolved = path.resolve(candidate);
    if (isExecutable(resolved)) return resolved;
  }

  const executableNames = process.platform === "win32" ? ["qwqwq.exe"] : ["qwqwq"];
  const searchDirectories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  if (process.platform === "darwin") {
    searchDirectories.push("/opt/homebrew/bin", "/usr/local/bin");
  } else if (process.platform === "win32") {
    const home = os.homedir();
    searchDirectories.push(
      path.join(home, "AppData", "Local", "Programs", "qwqwq"),
      path.join(process.env.ProgramFiles ?? "C:\\Program Files", "qwqwq"),
    );
  } else {
    searchDirectories.push("/usr/local/bin", "/usr/bin", "/bin", path.join(os.homedir(), ".local", "bin"));
  }

  for (const directory of new Set(searchDirectories)) {
    for (const executableName of executableNames) {
      const candidate = path.join(directory, executableName);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

function findInPath(name) {
  const directories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  if (process.platform !== "win32") directories.push("/usr/local/bin", "/usr/bin", "/bin");
  const extensions = process.platform === "win32" && !path.extname(name)
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\"'\"'")}'`;
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}


function spawnSystemTerminal(command, args, cwd = undefined) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        detached: process.platform !== "win32",
        stdio: "ignore",
        windowsHide: process.platform === "win32",
      });
    } catch (error) {
      reject(error);
      return;
    }

    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      if (error) reject(error);
      else resolve();
    };
    const startupTimer = setTimeout(() => finish(), 1500);
    startupTimer.unref?.();
    child.once("error", (error) => finish(error));
    child.once("spawn", () => child.unref());
    child.once("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(`The system terminal exited with code ${code}.`));
    });
  });
}

async function startSystemTerminal(source) {
  if (typeof source !== "string") throw new Error("Source code must be text.");
  if (source.length > MAX_SOURCE_CHARS) throw new Error("The source file is too large to run.");
  const executable = await resolveRuntimePath();
  if (!executable) {
    throw new Error("The local qwqwq runtime was not found. Install it and add it to PATH, or select it in Settings.");
  }

  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), "qwq-editor-terminal-"));
  const sourcePath = path.join(temporaryDirectory, "program.qwq");
  await fsp.writeFile(sourcePath, source, "utf8");

  try {
    if (process.platform === "win32") {
      const powershell = findInPath("powershell.exe") || path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const launcherPath = path.join(temporaryDirectory, "run.ps1");
      const script = [
        "$ErrorActionPreference = 'Continue'",
        `& ${powershellQuote(executable)} --max-steps 1000000 ${powershellQuote(sourcePath)}`,
        "$qwqExitCode = $LASTEXITCODE",
        "Write-Host ''",
        "Write-Host ('qwqwq exited with status ' + $qwqExitCode + '.')",
        "Read-Host 'Press Enter to close this terminal'",
        `Remove-Item -LiteralPath ${powershellQuote(temporaryDirectory)} -Recurse -Force -ErrorAction SilentlyContinue`,
        "exit $qwqExitCode",
      ].join("\r\n");
      await fsp.writeFile(launcherPath, script, "utf8");

      const windowsTerminal = findInPath("wt.exe");
      if (windowsTerminal) {
        try {
          await spawnSystemTerminal(windowsTerminal, [
            "-w", "new", "new-tab", "--title", "qwq-editor",
            powershell, "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcherPath,
          ], temporaryDirectory);
          return { terminal: "Windows Terminal" };
        } catch {
          // Fall back to the Windows Console if Windows Terminal cannot be launched.
        }
      }

      const commandProcessor = findInPath("cmd.exe") || path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
      const command = `start "" "${powershell}" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "${launcherPath}"`;
      await spawnSystemTerminal(commandProcessor, ["/d", "/s", "/c", command], temporaryDirectory);
      return { terminal: "Windows Console" };
    }

    const bash = findInPath("bash") || "/bin/bash";
    const rcPath = path.join(temporaryDirectory, "bashrc");
    const rc = [
      `QWQ_EDITOR_TMP=${shellQuote(temporaryDirectory)}`,
      `trap 'rm -rf -- "$QWQ_EDITOR_TMP"' EXIT`,
      `printf '%s\\n' ${shellQuote("Running the installed qwqwq executable in the system terminal.")}`, 
      `${shellQuote(executable)} --max-steps 1000000 ${shellQuote(sourcePath)}`,
      "qwq_status=$?",
      `printf '\\nqwqwq exited with status %s.\\n' "$qwq_status"`,
      "",
    ].join("\n");
    await fsp.writeFile(rcPath, rc, "utf8");

    if (process.platform === "darwin") {
      const command = `${shellQuote(bash)} --rcfile ${shellQuote(rcPath)} -i`;
      const appleScript = [
        'tell application "Terminal" to activate',
        `tell application "Terminal" to do script ${JSON.stringify(command)}`,
      ].join("\n");
      await spawnSystemTerminal("/usr/bin/osascript", ["-e", appleScript], temporaryDirectory);
      return { terminal: "Terminal.app" };
    }

    const shellArgs = [bash, "--rcfile", rcPath, "-i"];
    const candidates = [
      ["x-terminal-emulator", ["-e", ...shellArgs]],
      ["gnome-terminal", ["--", ...shellArgs]],
      ["konsole", ["-e", ...shellArgs]],
      ["xfce4-terminal", ["--execute", ...shellArgs]],
      ["mate-terminal", ["--", ...shellArgs]],
      ["kgx", ["--", ...shellArgs]],
      ["xterm", ["-e", ...shellArgs]],
      ["kitty", ["--", ...shellArgs]],
      ["alacritty", ["-e", ...shellArgs]],
      ["foot", ["-e", ...shellArgs]],
    ];
    let launchError = null;
    for (const [name, args] of candidates) {
      const terminalPath = findInPath(name);
      if (!terminalPath) continue;
      try {
        await spawnSystemTerminal(terminalPath, args, temporaryDirectory);
        return { terminal: name };
      } catch (error) {
        launchError = error;
      }
    }
    if (launchError) throw new Error(`A system terminal could not be launched: ${String(launchError.message ?? launchError)}`);
    throw new Error("No supported system terminal was found. Install a terminal emulator and try again.");
  } catch (error) {
    await fsp.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Could not open the system terminal: ${String(error?.message ?? error)}`);
  }
}
function getWindowForSender(sender) {
  const candidate = BrowserWindow.fromWebContents(sender);
  return candidate === mainWindow ? candidate : null;
}

function sendSessionEvent(session, event) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("qwq:terminal-event", { runId: session.runId, ...event });
}

async function removeSessionFiles(session) {
  if (session.timeoutId) clearTimeout(session.timeoutId);
  activeSessions.delete(session.runId);
  await fsp.rm(session.temporaryDirectory, { recursive: true, force: true }).catch(() => {});
}

async function startLocalRun(source, requestedRunId = "") {
  if (typeof source !== "string") throw new Error("Source code must be text.");
  if (source.length > MAX_SOURCE_CHARS) throw new Error("The source file is too large to run.");

  const executable = await resolveRuntimePath();
  if (!executable) {
    throw new Error("The local qwqwq runtime was not found. Install it and add it to PATH, or select it in Settings.");
  }

  const runId = requestedRunId || crypto.randomUUID();
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), "qwq-editor-"));
  const sourcePath = path.join(temporaryDirectory, "program.qwq");
  await fsp.writeFile(sourcePath, source, "utf8");

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, ["--max-steps", "1000000", sourcePath], {
        cwd: temporaryDirectory,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      void fsp.rm(temporaryDirectory, { recursive: true, force: true });
      reject(error);
      return;
    }

    const session = {
      runId,
      child,
      temporaryDirectory,
      outputLength: 0,
      timedOut: false,
      outputLimitReached: false,
      finished: false,
      timeoutId: null,
    };
    activeSessions.set(runId, session);

    const emitOutput = (stream, chunk) => {
      if (session.finished) return;
      const available = Math.max(0, MAX_OUTPUT_CHARS - session.outputLength);
      const accepted = chunk.slice(0, available);
      session.outputLength += accepted.length;
      if (accepted) sendSessionEvent(session, { type: "data", stream, data: accepted });
      if (chunk.length > accepted.length && !session.outputLimitReached) {
        session.outputLimitReached = true;
        child.kill();
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => emitOutput("stdout", chunk));
    child.stderr.on("data", (chunk) => emitOutput("stderr", chunk));
    child.stdin.on("error", () => {});

    const finish = async (code, signal) => {
      if (session.finished) return;
      session.finished = true;
      if (session.timedOut) {
        sendSessionEvent(session, {
          type: "data",
          stream: "stderr",
          data: "\n\nqwqwq exceeded the two-minute time limit and was terminated.\n",
        });
      }
      if (session.outputLimitReached) {
        sendSessionEvent(session, {
          type: "data",
          stream: "stderr",
          data: "\n\nOutput exceeded 2,000,000 characters and the process was terminated.\n",
        });
      }
      sendSessionEvent(session, { type: "exit", code, signal, timedOut: session.timedOut });
      await removeSessionFiles(session);
    };

    let started = false;
    child.once("spawn", () => {
      started = true;
      sendSessionEvent(session, { type: "session", runId });
      resolve({ runId });
    });
    child.once("error", (error) => {
      sendSessionEvent(session, { type: "error", message: error.message });
      if (!started) reject(error);
      void finish(null, null);
    });
    child.once("close", (code, signal) => { void finish(code, signal); });

    session.timeoutId = setTimeout(() => {
      session.timedOut = true;
      child.kill();
    }, RUN_TIMEOUT_MS);
    session.timeoutId.unref?.();
  });
}

function stopSession(runId) {
  const session = activeSessions.get(runId);
  if (!session || session.finished) return false;
  return session.child.kill();
}

function writeSessionInput(runId, data) {
  const session = activeSessions.get(runId);
  if (!session || session.finished || !session.child.stdin.writable) return false;
  if (typeof data !== "string" || data.length > 100_000) return false;
  return session.child.stdin.write(data);
}

function endSessionInput(runId) {
  const session = activeSessions.get(runId);
  if (!session || session.finished || !session.child.stdin.writable) return false;
  session.child.stdin.end();
  return true;
}

ipcMain.handle("qwq:open-file", async (event) => {
  if (getWindowForSender(event.sender) !== mainWindow) throw new Error("Invalid editor window.");
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open qwq source file",
    properties: ["openFile"],
    filters: [
      { name: "qwq source files", extensions: ["qwq"] },
      { name: "Text files", extensions: ["txt"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = path.resolve(result.filePaths[0]);
  return {
    path: filePath,
    name: path.basename(filePath),
    source: await fsp.readFile(filePath, "utf8"),
  };
});

ipcMain.handle("qwq:save-file", async (event, payload = {}) => {
  if (getWindowForSender(event.sender) !== mainWindow) throw new Error("Invalid editor window.");
  if (typeof payload.source !== "string") throw new Error("Source code must be text.");
  let filePath = typeof payload.path === "string" && path.isAbsolute(payload.path)
    ? path.resolve(payload.path)
    : "";
  if (!filePath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save qwq source file",
      defaultPath: path.basename(String(payload.name || "untitled.qwq")),
      filters: [
        { name: "qwq source files", extensions: ["qwq"] },
        { name: "Text files", extensions: ["txt"] },
      ],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    filePath = path.resolve(result.filePath);
  }
  await fsp.writeFile(filePath, payload.source, "utf8");
  return { canceled: false, path: filePath, name: path.basename(filePath) };
});

ipcMain.handle("qwq:run-start", async (event, payload = {}) => {
  if (getWindowForSender(event.sender) !== mainWindow) throw new Error("Invalid editor window.");
  return startLocalRun(payload.source, payload.runId);
});

ipcMain.handle("qwq:terminal-open", async (event, payload = {}) => {
  if (getWindowForSender(event.sender) !== mainWindow) throw new Error("Invalid editor window.");
  return startSystemTerminal(payload.source);
});

ipcMain.on("qwq:run-input", (event, payload = {}) => {
  if (getWindowForSender(event.sender) !== mainWindow) return;
  writeSessionInput(payload.runId, payload.data);
});
ipcMain.on("qwq:run-eof", (event, payload = {}) => {
  if (getWindowForSender(event.sender) !== mainWindow) return;
  endSessionInput(payload.runId);
});
ipcMain.on("qwq:run-stop", (event, payload = {}) => {
  if (getWindowForSender(event.sender) !== mainWindow) return;
  stopSession(payload.runId);
});


ipcMain.handle("qwq:get-runtime-path", async (event) => {
  if (getWindowForSender(event.sender) !== mainWindow) throw new Error("Invalid editor window.");
  return (await resolveRuntimePath()) ?? "";
});

ipcMain.handle("qwq:get-runtime-version", async (event) => {
  if (getWindowForSender(event.sender) !== mainWindow) throw new Error("Invalid editor window.");
  const executable = await resolveRuntimePath();
  if (!executable) return "";
  return await readRuntimeVersion(executable);
});

ipcMain.handle("qwq:choose-runtime", async (event) => {
  if (getWindowForSender(event.sender) !== mainWindow) throw new Error("Invalid editor window.");
  const options = {
    title: "Select the qwqwq executable",
    properties: ["openFile"],
  };
  if (process.platform === "win32") options.filters = [{ name: "qwqwq executable", extensions: ["exe"] }];
  const result = await dialog.showOpenDialog(mainWindow, options);
  if (result.canceled || !result.filePaths[0]) return null;

  const selectedPath = path.resolve(result.filePaths[0]);
  if (!isExecutable(selectedPath)) throw new Error("The selected file is not an executable qwqwq binary.");
  const settings = await readRuntimeSettings();
  settings.qwqwqPath = selectedPath;
  const settingsFile = runtimeSettingsPath();
  await fsp.mkdir(path.dirname(settingsFile), { recursive: true });
  await fsp.writeFile(settingsFile, JSON.stringify(settings, null, 2), "utf8");
  return selectedPath;
});

ipcMain.handle("qwq:window-control", async (event, action) => {
  const window = getWindowForSender(event.sender);
  if (!window || window !== mainWindow) throw new Error("Invalid editor window.");
  if (action === "minimize") window.minimize();
  else if (action === "toggle-maximize") {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  } else if (action === "close") window.close();
  else throw new Error("Unknown window action.");
  return { maximized: window.isMaximized() };
});

ipcMain.handle("qwq:window-state", async (event) => {
  const window = getWindowForSender(event.sender);
  if (!window) throw new Error("Invalid window.");
  return { maximized: window.isMaximized() };
});


async function createMainWindow() {
  let rendererUrl = process.env.VITE_DEV_SERVER_URL;
  if (!rendererUrl) {
    await registerAppProtocol();
    rendererUrl = "qwq://editor/";
  }

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    title: "qwq-editor",
    frame: false,
    icon: appIconPath(),
    autoHideMenuBar: true,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const allowedOrigin = new URL(rendererUrl).origin;
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== allowedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const reportWindowState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("qwq:window-state-changed", { maximized: mainWindow.isMaximized() });
  };
  mainWindow.on("maximize", reportWindowState);
  mainWindow.on("unmaximize", reportWindowState);
  mainWindow.on("closed", () => { mainWindow = null; });
  await mainWindow.loadURL(rendererUrl);
}

app.whenReady().then(createMainWindow).catch((error) => {
  dialog.showErrorBox("qwq-editor failed to start", String(error?.stack ?? error));
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow().catch((error) => {
      dialog.showErrorBox("qwq-editor failed to start", String(error?.stack ?? error));
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  for (const session of activeSessions.values()) session.child.kill();
});
