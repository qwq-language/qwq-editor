const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("qwqDesktop", Object.freeze({
  openFile: () => ipcRenderer.invoke("qwq:open-file"),
  saveFile: (filePath, source, name) => ipcRenderer.invoke("qwq:save-file", {
    path: filePath,
    source,
    name,
  }),
  startRun: (source, runId) => ipcRenderer.invoke("qwq:run-start", { source, runId }),
  openTerminal: (source) => ipcRenderer.invoke("qwq:terminal-open", { source }),
  getRuntimePath: () => ipcRenderer.invoke("qwq:get-runtime-path"),
  getRuntimeVersion: () => ipcRenderer.invoke("qwq:get-runtime-version"),
  chooseRuntime: () => ipcRenderer.invoke("qwq:choose-runtime"),
  minimize: () => ipcRenderer.invoke("qwq:window-control", "minimize"),
  toggleMaximize: () => ipcRenderer.invoke("qwq:window-control", "toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("qwq:window-control", "close"),
  getWindowState: () => ipcRenderer.invoke("qwq:window-state"),
  writeInput: (runId, data) => ipcRenderer.send("qwq:run-input", { runId, data }),
  endInput: (runId) => ipcRenderer.send("qwq:run-eof", { runId }),
  stopRun: (runId) => ipcRenderer.send("qwq:run-stop", { runId }),
  onTerminalEvent: (callback) => subscribe("qwq:terminal-event", callback),
  onWindowStateChanged: (callback) => subscribe("qwq:window-state-changed", callback),
}));

