import "./monaco-worker.js";
import { version as editorVersion } from "../package.json";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  byteOffsetsToUtf16,
  clearFlowHoverData,
  decorationsForAnalysis,
  flowNavigationAtPosition,
  markersForAnalysis,
  monaco,
  qwqLanguageId,
  qwqThemeName,
} from "./qwq-monaco.js";
import "./style.css";

const buildMode = import.meta.env.MODE;
const runEnabled = true;
const electronBuild = buildMode === "electron";
const appIconUrl = `${import.meta.env.BASE_URL}app-icon.png`;

const documentKey = "qwq.web-editor.source.v1";
const filenameKey = "qwq.web-editor.filename.v1";
const workspaceKey = "qwq.web-editor.workspace.v1";
const settingsKey = "qwq.editor.settings.v1";
const defaultSettings = {
  primaryFont: "Consolas",
  secondaryFont: "微软雅黑",
  fontLigatures: true,
  terminalMode: "embedded",
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey) ?? "null");
    return {
      primaryFont: typeof saved?.primaryFont === "string" && saved.primaryFont.trim()
        ? saved.primaryFont.trim()
        : defaultSettings.primaryFont,
      secondaryFont: typeof saved?.secondaryFont === "string" && saved.secondaryFont.trim()
        ? saved.secondaryFont.trim()
        : defaultSettings.secondaryFont,
      fontLigatures: typeof saved?.fontLigatures === "boolean" ? saved.fontLigatures : true,
      terminalMode: electronBuild && ["system", "popup"].includes(saved?.terminalMode) ? "system" : "embedded",
    };
  } catch {
    return { ...defaultSettings };
  }
}

let settings = loadSettings();

const icon = {
  file: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.8h7l5 5v11.4H6z"/><path d="M13 3.8v5h5"/></svg>`,
  open: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h6l2 2h8v9.2a1.3 1.3 0 0 1-1.3 1.3H5.3A1.3 1.3 0 0 1 4 17.7z"/><path d="M12 12v5m-2-2 2 2 2-2"/></svg>`,
  save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h12l2.5 2.5v12.5H4.5v-14A1 1 0 0 1 5.5 4.5z"/><path d="M8 4.5v5h8v-5M8 19.5v-6h8v6"/></svg>`,
  format: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 11h10M4 16h16M4 21h10"/><path d="m17 9 3 2-3 2"/></svg>`,
  run: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.8 6.5h6l2 2h8.4v9.8a1.2 1.2 0 0 1-1.2 1.2H5a1.2 1.2 0 0 1-1.2-1.2z"/><path d="M3.8 9h16.4"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.427 1.756 2.925 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.427 1.756-2.925 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.427-1.756-2.925 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.3.124 2.572-1.065Z"/><path d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z"/></svg>`,
  minimize: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>`,
  maximize: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="5.5" width="13" height="13" rx="1"/></svg>`,
  restore: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5h10.5V16M5.5 8.5v10h10v-10z"/></svg>`,
  close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
};

document.querySelector("#app").innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand"><img src="${appIconUrl}" alt="" /><strong>qwq-editor</strong></div>
      <span class="header-divider"></span>
      <div class="topbar-spacer"></div>
      <input id="file-input" class="visually-hidden" type="file" accept=".qwq,text/plain" aria-label="Open a qwq source file" />
      <button class="toolbar-button" id="open-button" title="Open a file (Ctrl/Cmd + O)">${icon.open}<span>Open</span></button>
      <button class="toolbar-button" id="save-button" title="Save (Ctrl/Cmd + S)">${icon.save}<span>Save</span></button>
      <span class="toolbar-divider"></span>
      <button class="toolbar-button" id="format-button" title="Format (Ctrl/Cmd + Shift + F)">${icon.format}<span>Format</span></button>
      <button class="toolbar-button run-button" id="run-button" title="Run (Ctrl/Cmd + Enter)" disabled>${icon.run}<span>Run</span></button>
      <button class="toolbar-button" id="settings-button" title="Settings">${icon.settings}<span>Settings</span></button>
      <div class="window-controls" id="window-controls" hidden>
        <button class="window-control-button" id="minimize-button" title="Minimize" aria-label="Minimize">${icon.minimize}</button>
        <button class="window-control-button" id="maximize-button" title="Maximize" aria-label="Maximize">${icon.maximize}</button>
        <button class="window-control-button close" id="window-close-button" title="Close" aria-label="Close">${icon.close}</button>
      </div>
    </header>

    <main class="editor-layout">
      <aside class="explorer" aria-label="Explorer">
        <div class="explorer-title">
          <span>EXPLORER</span>
          <div class="explorer-actions">
            <button class="icon-button" id="new-file-button" title="New file (Ctrl/Cmd + N)" aria-label="New file">${icon.plus}</button>
            <button class="icon-button" id="explorer-open-button" title="Open file (Ctrl/Cmd + O)" aria-label="Open file">${icon.folder}</button>
          </div>
        </div>
        <div class="workspace-file-list" id="workspace-file-list" role="tree"></div>
      </aside>

      <section class="workspace-main" aria-label="Code editor">
        <div class="file-tabs" id="file-tabs" role="tablist" aria-label="Open files"></div>
        <div class="editor-host" id="editor-host">
          <div class="empty-editor-message" id="empty-editor-message" hidden>
            <strong>No file open</strong>
            <span>Open or create a file to get started.</span>
          </div>
        </div>
      </section>

      <section class="bottom-panel" aria-label="Diagnostics and terminal">
        <header class="panel-header">
          <div class="panel-tabs">
            <button id="problems-tab" class="panel-tab active">Problems <span id="problem-count">0</span></button>
            <button id="run-tab" class="panel-tab">Terminal</button>
          </div>
          <span id="panel-status" class="panel-status"></span>
        </header>
        <div class="panel-content">
          <div id="diagnostics-panel" class="diagnostics-panel" aria-live="polite"></div>
          <div id="run-panel" class="run-panel" hidden>
            <div class="terminal-toolbar">
              <span class="panel-label">Terminal</span>
              <span id="run-result-status" class="terminal-status"></span>
              <span class="terminal-toolbar-spacer"></span>
              <button class="terminal-action" id="clear-terminal-button" type="button">Clear</button>
            </div>
            <div id="terminal-host" class="terminal-host" role="application" aria-label="Interactive terminal"></div>
            <div id="run-diagnostics"></div>
          </div>
        </div>
      </section>
    </main>

    <footer class="statusbar">
      <span id="status-text">Loading</span>
      <span class="status-spacer"></span>
      <span id="cursor-position">Line 1, Column 1</span>
    </footer>
  </div>

  <dialog class="settings-dialog" id="settings-dialog" aria-labelledby="settings-title">
    <form id="settings-form">
      <div class="dialog-header">
        <div><h2 id="settings-title">Settings</h2><p>Editor appearance and runtime behavior</p></div>
        <button class="icon-button dialog-close" id="settings-close" type="button" aria-label="Close settings">${icon.close}</button>
      </div>
      <div class="settings-section">
        <label class="setting-field" for="primary-font-input">
          <span>Primary editor font</span>
          <input id="primary-font-input" type="text" autocomplete="off" spellcheck="false" />
        </label>
        <label class="setting-field" for="secondary-font-input">
          <span>Secondary fallback font</span>
          <input id="secondary-font-input" type="text" autocomplete="off" spellcheck="false" />
        </label>
        <label class="checkbox-setting" for="font-ligatures-input">
          <input id="font-ligatures-input" type="checkbox" />
          <span>Enable font ligatures</span>
        </label>
        <p class="setting-help">Fonts are used in the code editor in the order shown.</p>
      </div>
      <div class="settings-section runtime-setting" id="runtime-setting" hidden>
        <div class="runtime-setting-row">
          <div><span class="runtime-setting-label">Local runtime executable</span><p class="setting-help">Uses <code>qwqwq</code> from PATH by default.</p></div>
          <button class="secondary-button" id="choose-runtime-button" type="button">Choose…</button>
        </div>
        <p class="runtime-path" id="runtime-path-label">Using qwqwq from PATH</p>
      </div>
      <fieldset class="settings-section terminal-setting">
        <legend>Runtime terminal</legend>
        <label class="radio-setting"><input type="radio" name="terminal-mode" value="embedded" /><span>Embedded terminal</span></label>
        <label class="radio-setting" id="system-terminal-setting"><input type="radio" name="terminal-mode" value="system" /><span>System terminal</span></label>
        <p class="setting-help" id="web-terminal-note" hidden>Web builds always use the embedded terminal.</p>
      </fieldset>
      <div class="settings-section update-setting">
        <div class="runtime-setting-row">
          <div><span class="runtime-setting-label">Updates</span><p class="setting-help" id="update-status">Current version</p></div>
          <button class="secondary-button" id="check-updates-button" type="button">Check for updates</button>
        </div>
        <p class="runtime-path" id="latest-release-label" hidden></p>
      </div>
      <div class="version-line">
        <span id="editor-version-label">qwq-editor</span>
        <span id="runtime-version-label" hidden></span>
      </div>
      <div class="dialog-actions">
        <button class="secondary-button" id="reset-settings" type="button">Reset to defaults</button>
        <button class="primary-button" id="settings-done" type="submit">Done</button>
      </div>
    </form>
  </dialog>
`;

const editorHost = document.querySelector("#editor-host");
const fileTabsElement = document.querySelector("#file-tabs");
const workspaceFileList = document.querySelector("#workspace-file-list");
const emptyEditorMessage = document.querySelector("#empty-editor-message");
const statusText = document.querySelector("#status-text");
const panelStatus = document.querySelector("#panel-status");
const problemCount = document.querySelector("#problem-count");
const diagnosticsPanel = document.querySelector("#diagnostics-panel");
const runPanel = document.querySelector("#run-panel");
const terminalHost = document.querySelector("#terminal-host");
const runDiagnostics = document.querySelector("#run-diagnostics");
const runResultStatus = document.querySelector("#run-result-status");
const runButton = document.querySelector("#run-button");
const runtimeSetting = document.querySelector("#runtime-setting");
const chooseRuntimeButton = document.querySelector("#choose-runtime-button");
const runtimePathLabel = document.querySelector("#runtime-path-label");
const fileInput = document.querySelector("#file-input");
const newFileButton = document.querySelector("#new-file-button");
const explorerOpenButton = document.querySelector("#explorer-open-button");
const problemsTab = document.querySelector("#problems-tab");
const runTab = document.querySelector("#run-tab");
const settingsButton = document.querySelector("#settings-button");
const settingsDialog = document.querySelector("#settings-dialog");
const settingsForm = document.querySelector("#settings-form");
const settingsClose = document.querySelector("#settings-close");
const resetSettingsButton = document.querySelector("#reset-settings");
const primaryFontInput = document.querySelector("#primary-font-input");
const secondaryFontInput = document.querySelector("#secondary-font-input");
const fontLigaturesInput = document.querySelector("#font-ligatures-input");
const systemTerminalRadio = document.querySelector('input[name="terminal-mode"][value="system"]');
const embeddedTerminalRadio = document.querySelector('input[name="terminal-mode"][value="embedded"]');
const systemTerminalSetting = document.querySelector("#system-terminal-setting");
const webTerminalNote = document.querySelector("#web-terminal-note");
const checkUpdatesButton = document.querySelector("#check-updates-button");
const updateStatus = document.querySelector("#update-status");
const latestReleaseLabel = document.querySelector("#latest-release-label");
const editorVersionLabel = document.querySelector("#editor-version-label");
const runtimeVersionLabel = document.querySelector("#runtime-version-label");
let wasmRuntimeVersion = "";
const clearTerminalButton = document.querySelector("#clear-terminal-button");
const windowControls = document.querySelector("#window-controls");
const minimizeButton = document.querySelector("#minimize-button");
const maximizeButton = document.querySelector("#maximize-button");
const windowCloseButton = document.querySelector("#window-close-button");

if (electronBuild) {
  runtimeSetting.hidden = false;
  windowControls.hidden = false;
} else {
  systemTerminalSetting.classList.add("disabled-setting");
  systemTerminalRadio.disabled = true;
  webTerminalNote.hidden = false;
}

primaryFontInput.value = settings.primaryFont;
secondaryFontInput.value = settings.secondaryFont;
fontLigaturesInput.checked = settings.fontLigatures;
embeddedTerminalRadio.checked = settings.terminalMode === "embedded";
systemTerminalRadio.checked = electronBuild && settings.terminalMode === "system";
updateVersionLabels();

function updateVersionLabels() {
  if (editorVersionLabel) editorVersionLabel.textContent = `qwq-editor ${editorVersion || "unknown"}`;
  if (!runtimeVersionLabel || electronBuild) return;
  runtimeVersionLabel.hidden = !wasmRuntimeVersion;
  runtimeVersionLabel.textContent = wasmRuntimeVersion
    ? `qwqwq ${wasmRuntimeVersion} (WebAssembly)`
    : "";
}

async function refreshRuntimeVersionLabel() {
  if (!electronBuild || !runtimeVersionLabel) return;
  if (typeof window.qwqDesktop?.getRuntimeVersion !== "function") {
    runtimeVersionLabel.hidden = false;
    runtimeVersionLabel.textContent = "qwqwq version unavailable";
    return;
  }
  runtimeVersionLabel.hidden = false;
  runtimeVersionLabel.textContent = "qwqwq …";
  try {
    const runtimeVersion = await window.qwqDesktop.getRuntimeVersion();
    runtimeVersionLabel.textContent = runtimeVersion ? `qwqwq ${runtimeVersion}` : "qwqwq version unavailable";
  } catch {
    runtimeVersionLabel.textContent = "qwqwq version unavailable";
  }
}

function readStorage(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeFilename(name) {
  const filename = String(name || "untitled.qwq").trim() || "untitled.qwq";
  return /\.[^./\\]+$/.test(filename) ? filename : `${filename}.qwq`;
}

function createFileId() {
  return globalThis.crypto?.randomUUID?.() ?? `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function restoreWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(workspaceKey) ?? "null");
    if (saved && Array.isArray(saved.files)) {
      const files = saved.files
        .filter((file) => file && typeof file.name === "string" && typeof file.source === "string")
        .map((file) => ({
          id: typeof file.id === "string" ? file.id : createFileId(),
          name: normalizeFilename(file.name),
          source: file.source,
          savedSource: typeof file.savedSource === "string" ? file.savedSource : file.source,
          path: typeof file.path === "string" ? file.path : null,
          handle: null,
        }));
      const fileIds = new Set(files.map((file) => file.id));
      const openTabs = Array.isArray(saved.openTabs)
        ? [...new Set(saved.openTabs.filter((id) => fileIds.has(id)))]
        : (files.length > 0 ? [files[0].id] : []);
      const activeFileId = openTabs.includes(saved.activeFileId)
        ? saved.activeFileId
        : (openTabs[0] ?? null);
      return { files, openTabs, activeFileId };
    }
  } catch {
    // Invalid browser storage falls back to the legacy single-file save when available.
  }

  const legacySource = readStorage(documentKey, null);
  if (typeof legacySource === "string") {
    const file = {
      id: "main",
      name: normalizeFilename(readStorage(filenameKey, "main.qwq")),
      source: legacySource,
      savedSource: legacySource,
      path: null,
      handle: null,
    };
    return { files: [file], openTabs: [file.id], activeFileId: file.id };
  }
  return { files: [], openTabs: [], activeFileId: null };
}

const restoredWorkspace = restoreWorkspace();
let workspaceFiles = restoredWorkspace.files;
let openTabIds = restoredWorkspace.openTabs;
let activeFileId = restoredWorkspace.activeFileId;
const modelsByFileId = new Map();
let untitledSequence = 1;
let currentRevision = 0;
let requestSequence = 0;
let analysisTimer = 0;
let workerReady = false;
let worker = null;
let editor = null;
let terminal = null;
let terminalFitAddon = null;
let terminalResizeObserver = null;
let terminalLineBuffer = "";
let emptyModel = null;
let runSession = null;
let syntaxDecorationIds = [];
let navigationDecorationIds = [];
let navigationDecorationKey = "";
let hoveredNavigationPosition = null;
let maximizedWindow = false;
const pendingRequests = new Map();

function clearNavigationLink() {
  if (editor && navigationDecorationIds.length > 0) {
    navigationDecorationIds = editor.deltaDecorations(navigationDecorationIds, []);
  }
  navigationDecorationKey = "";
}

function showNavigationLink(model, position) {
  const target = flowNavigationAtPosition(model, position);
  if (!target) {
    clearNavigationLink();
    return;
  }

  const key = `${target.kind}:${target.start}:${target.end}:${target.offset}`;
  if (key === navigationDecorationKey) return;

  navigationDecorationIds = editor.deltaDecorations(navigationDecorationIds, [{
    range: monaco.Range.fromPositions(
      model.getPositionAt(target.start),
      model.getPositionAt(target.end),
    ),
    options: { inlineClassName: "qwq-navigation-link" },
  }]);
  navigationDecorationKey = key;
}

function getWorkspaceFile(fileId = activeFileId) {
  return fileId == null ? null : (workspaceFiles.find((file) => file.id === fileId) ?? null);
}

function getFileModel(file) {
  let model = modelsByFileId.get(file.id);
  if (!model || model.isDisposed()) {
    model = monaco.editor.createModel(file.source, qwqLanguageId);
    modelsByFileId.set(file.id, model);
  }
  return model;
}

function uniqueFilename(requestedName) {
  const base = normalizeFilename(requestedName);
  const extension = base.slice(base.lastIndexOf("."));
  const stem = base.slice(0, -extension.length);
  const exists = (name) => workspaceFiles.some((file) => file.name.toLowerCase() === name.toLowerCase());
  if (!exists(base)) return base;
  let suffix = 2;
  while (exists(`${stem} (${suffix})${extension}`)) suffix += 1;
  return `${stem} (${suffix})${extension}`;
}

function createWorkspaceFile(name, source = "", savedSource = source, metadata = {}) {
  const file = {
    id: createFileId(),
    name: metadata.keepName ? normalizeFilename(name) : uniqueFilename(name),
    source: String(source),
    savedSource: String(savedSource),
    path: typeof metadata.path === "string" ? metadata.path : null,
    handle: metadata.handle ?? null,
  };
  workspaceFiles.push(file);
  return file;
}

function persistWorkspace() {
  for (const file of workspaceFiles) {
    const model = modelsByFileId.get(file.id);
    if (model && !model.isDisposed()) file.source = model.getValue();
  }
  const activeFile = getWorkspaceFile();
  const snapshot = {
    files: workspaceFiles.map((file) => ({
      id: file.id,
      name: file.name,
      source: file.source,
      savedSource: file.savedSource,
      path: file.path ?? null,
    })),
    openTabs: [...openTabIds],
    activeFileId,
  };
  try {
    localStorage.setItem(workspaceKey, JSON.stringify(snapshot));
  } catch {
    // The current editor remains usable if browser storage is full or unavailable.
  }
  if (activeFile) {
    try {
      localStorage.setItem(documentKey, activeFile.source);
      localStorage.setItem(filenameKey, activeFile.name);
    } catch {
      // Keep the workspace for the current session if browser storage is unavailable.
    }
  }
}

function persistSettings() {
  try {
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  } catch {
    // Settings remain active for this session when storage is unavailable.
  }
}

function fontFamilyForEditor() {
  const quote = (value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  const primary = settings.primaryFont.trim() || defaultSettings.primaryFont;
  const secondary = settings.secondaryFont.trim() || defaultSettings.secondaryFont;
  return `${quote(primary)}, ${quote(secondary)}, monospace`;
}

function applyEditorFont() {
  const fontFamily = fontFamilyForEditor();
  editor?.updateOptions({ fontFamily, fontLigatures: settings.fontLigatures });
  if (terminal) terminal.options.fontFamily = fontFamily;
}

function updateSettingsFromDialog() {
  settings = {
    primaryFont: primaryFontInput.value.trim() || defaultSettings.primaryFont,
    secondaryFont: secondaryFontInput.value.trim() || defaultSettings.secondaryFont,
    fontLigatures: fontLigaturesInput.checked,
    terminalMode: electronBuild && systemTerminalRadio.checked ? "system" : "embedded",
  };
  primaryFontInput.value = settings.primaryFont;
  secondaryFontInput.value = settings.secondaryFont;
  fontLigaturesInput.checked = settings.fontLigatures;
  persistSettings();
  applyEditorFont();
}

function renderFileTabs() {
  fileTabsElement.replaceChildren();
  if (openTabIds.length === 0) {
    const empty = document.createElement("span");
    empty.className = "tab-empty";
    empty.textContent = "No open files";
    fileTabsElement.append(empty);
    return;
  }

  for (const fileId of openTabIds) {
    const file = getWorkspaceFile(fileId);
    if (!file) continue;
    const tab = document.createElement("div");
    const active = file.id === activeFileId;
    const dirty = file.source !== file.savedSource;
    tab.className = `editor-tab${active ? " active" : ""}`;

    const select = document.createElement("button");
    select.className = "editor-tab-select";
    select.type = "button";
    select.setAttribute("role", "tab");
    select.setAttribute("aria-selected", String(active));
    select.tabIndex = active ? 0 : -1;
    select.title = file.name;
    const fileGlyph = document.createElement("span");
    fileGlyph.className = "file-glyph";
    fileGlyph.innerHTML = icon.file;
    const label = document.createElement("span");
    label.className = "editor-tab-name";
    label.textContent = file.name;
    select.append(fileGlyph, label);
    select.addEventListener("click", () => activateWorkspaceFile(file.id));

    if (dirty) {
      const dirtyMark = document.createElement("span");
      dirtyMark.className = "dirty-dot";
      dirtyMark.title = "Unsaved changes";
      dirtyMark.setAttribute("aria-label", "Unsaved changes");
      select.append(dirtyMark);
    }

    const close = document.createElement("button");
    close.className = "editor-tab-close";
    close.type = "button";
    close.title = `Close ${file.name}`;
    close.setAttribute("aria-label", `Close ${file.name}`);
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeFileTab(file.id);
    });
    tab.append(select, close);
    fileTabsElement.append(tab);
  }
}

function revealActiveFileTab() {
  fileTabsElement.querySelector(".editor-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function renderWorkspaceFiles() {
  workspaceFileList.replaceChildren();
  for (const file of workspaceFiles) {
    const row = document.createElement("div");
    row.className = `explorer-file${file.id === activeFileId ? " active" : ""}`;
    const select = document.createElement("button");
    select.className = "explorer-file-select";
    select.type = "button";
    select.setAttribute("role", "treeitem");
    select.setAttribute("aria-selected", String(file.id === activeFileId));
    select.title = file.path ? `${file.name}\n${file.path}` : file.name;
    const fileGlyph = document.createElement("span");
    fileGlyph.className = "file-glyph explorer-glyph";
    fileGlyph.innerHTML = icon.file;
    const label = document.createElement("span");
    label.className = "explorer-file-name";
    label.textContent = file.name;
    select.append(fileGlyph, label);
    if (file.source !== file.savedSource) {
      const dirtyMark = document.createElement("span");
      dirtyMark.className = "dirty-dot explorer-dirty-dot";
      dirtyMark.title = "Unsaved changes";
      select.append(dirtyMark);
    }
    select.addEventListener("click", () => activateWorkspaceFile(file.id));
    row.append(select);

    const remove = document.createElement("button");
    remove.className = "explorer-file-close";
    remove.type = "button";
    remove.title = `Remove ${file.name} from Explorer`;
    remove.setAttribute("aria-label", `Remove ${file.name} from Explorer`);
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      closeWorkspaceFile(file.id);
    });
    row.append(remove);
    workspaceFileList.append(row);
  }
  if (workspaceFiles.length === 0) {
    const empty = document.createElement("div");
    empty.className = "explorer-empty";
    empty.textContent = "No files";
    workspaceFileList.append(empty);
  }
}

function updateActiveFilename() {
  const file = getWorkspaceFile();
  document.title = file ? `${file.name} — qwq-editor` : "qwq-editor";
  emptyEditorMessage.hidden = Boolean(file);
}

function activateWorkspaceFile(fileId) {
  const file = getWorkspaceFile(fileId);
  if (!file) return;
  if (!openTabIds.includes(fileId)) openTabIds = [...openTabIds, fileId];
  const nextModel = getFileModel(file);
  const previousModel = editor?.getModel();
  const modelChanged = Boolean(editor && previousModel !== nextModel);
  activeFileId = fileId;

  if (modelChanged) {
    clearNavigationLink();
    syntaxDecorationIds = editor.deltaDecorations(syntaxDecorationIds, []);
    monaco.editor.setModelMarkers(previousModel, "qwq", []);
    clearFlowHoverData(previousModel);
    editor.setModel(nextModel);
    clearFlowHoverData(nextModel);
    hoveredNavigationPosition = null;
    currentRevision += 1;
    diagnosticsPanel.classList.add("stale");
  }

  updateActiveFilename();
  renderFileTabs();
  revealActiveFileTab();
  renderWorkspaceFiles();
  persistWorkspace();
  updateCursor();
  if (modelChanged && workerReady) scheduleAnalysis();
  editor?.focus();
}

function activateEmptyEditor() {
  activeFileId = null;
  const previousModel = editor?.getModel();
  const modelChanged = Boolean(editor && previousModel !== emptyModel);
  if (modelChanged) {
    clearNavigationLink();
    syntaxDecorationIds = editor.deltaDecorations(syntaxDecorationIds, []);
    monaco.editor.setModelMarkers(previousModel, "qwq", []);
    clearFlowHoverData(previousModel);
    editor.setModel(emptyModel);
    clearFlowHoverData(emptyModel);
    hoveredNavigationPosition = null;
    currentRevision += 1;
    diagnosticsPanel.classList.add("stale");
  }
  updateActiveFilename();
  renderFileTabs();
  renderWorkspaceFiles();
  persistWorkspace();
  updateCursor();
  if (modelChanged && workerReady) scheduleAnalysis();
}

function nextUntitledName() {
  let name;
  do {
    name = `untitled-${untitledSequence++}.qwq`;
  } while (workspaceFiles.some((file) => file.name.toLowerCase() === name.toLowerCase()));
  return name;
}

function createNewFile() {
  const file = createWorkspaceFile(nextUntitledName());
  openTabIds = [...openTabIds, file.id];
  activateWorkspaceFile(file.id);
  setStatus(`Created ${file.name}`, "success");
}

function closeFileTab(fileId) {
  const index = openTabIds.indexOf(fileId);
  if (index < 0) return;
  const wasActive = activeFileId === fileId;
  openTabIds = openTabIds.filter((id) => id !== fileId);
  if (wasActive) {
    const nextId = openTabIds[Math.min(index, openTabIds.length - 1)];
    if (nextId) activateWorkspaceFile(nextId);
    else activateEmptyEditor();
  } else {
    renderFileTabs();
    persistWorkspace();
  }
}

function closeWorkspaceFile(fileId) {
  const file = getWorkspaceFile(fileId);
  if (!file) return;
  if (file.source !== file.savedSource &&
      !window.confirm(`Remove ${file.name} from Explorer? Its unsaved changes will be discarded.`)) return;

  const index = openTabIds.indexOf(fileId);
  const wasActive = activeFileId === fileId;
  workspaceFiles = workspaceFiles.filter((candidate) => candidate.id !== fileId);
  openTabIds = openTabIds.filter((id) => id !== fileId);
  const model = modelsByFileId.get(fileId);
  modelsByFileId.delete(fileId);

  if (wasActive) {
    const nextId = openTabIds[Math.min(index < 0 ? 0 : index, openTabIds.length - 1)];
    if (nextId) activateWorkspaceFile(nextId);
    else activateEmptyEditor();
    if (model && model !== editor?.getModel() && !model.isDisposed()) model.dispose();
  } else {
    if (model && !model.isDisposed()) model.dispose();
    renderFileTabs();
    renderWorkspaceFiles();
    persistWorkspace();
  }
}

function setStatus(message, state = "") {
  statusText.textContent = message;
  statusText.className = state ? `status-${state}` : "";
}

function setPanelTab(tab) {
  const showRun = runEnabled && tab === "run";
  problemsTab.classList.toggle("active", !showRun);
  runTab.classList.toggle("active", showRun);
  diagnosticsPanel.hidden = showRun;
  runPanel.hidden = !showRun;
  if (showRun) window.requestAnimationFrame(fitTerminal);
}

function utf16Location(source, byteOffset) {
  if (byteOffset == null) return null;
  const byteOffsets = byteOffsetsToUtf16(source);
  const offset = byteOffsets[Math.max(0, Math.min(byteOffset, byteOffsets.length - 1))] ?? 0;
  const prefix = source.slice(0, offset);
  const lastNewline = prefix.lastIndexOf("\n");
  return { offset, line: prefix.split("\n").length, column: offset - lastNewline };
}

function phaseName(phase) {
  return ({ lex: "Lexical", syntax: "Syntax", type: "Type", internal: "Internal", runtime: "Runtime" })[phase] ?? "Analysis";
}

function rejectWorkerRequests(message, name = "Error") {
  const error = new Error(message);
  error.name = name;
  for (const pending of pendingRequests.values()) pending.reject(error);
  pendingRequests.clear();
}

function startAnalysisWorker({ quiet = false } = {}) {
  workerReady = false;
  runButton.disabled = true;
  if (!quiet) setStatus("Loading qwq core…");
  try {
    const currentWorker = new Worker(new URL("./qwq-worker.js", import.meta.url), { type: "module" });
    worker = currentWorker;
    currentWorker.addEventListener("message", (event) => {
      if (worker !== currentWorker) return;
      const message = event.data;
      if (message.type === "ready") {
        workerReady = true;
        if (typeof message.version === "string" && message.version) {
          wasmRuntimeVersion = message.version;
          updateVersionLabels();
        }
        runButton.disabled = false;
        if (!quiet) setStatus("Checking…");
        void analyzeNow();
        return;
      }
      if (message.type === "startup-error") {
        workerReady = false;
        runButton.disabled = true;
        setStatus(`Could not load qwq core: ${message.message}`, "error");
        return;
      }
      const pending = pendingRequests.get(message.id);
      if (!pending) return;
      pendingRequests.delete(message.id);
      if (message.type === "request-error") pending.reject(new Error(message.message));
      else pending.resolve(message);
    });
    currentWorker.addEventListener("error", (event) => {
      if (worker !== currentWorker) return;
      worker = null;
      workerReady = false;
      runButton.disabled = true;
      rejectWorkerRequests(event.message || "qwq worker failed");
      setStatus(`Editor core error: ${event.message}`, "error");
    });
  } catch (error) {
    worker = null;
    setStatus(`Could not start the analyzer: ${String(error?.message ?? error)}`, "error");
  }
}

function restartAnalysisWorker() {
  const previousWorker = worker;
  worker = null;
  workerReady = false;
  previousWorker?.terminate();
  rejectWorkerRequests("The run was stopped.", "AbortError");
  startAnalysisWorker({ quiet: true });
}

function requestWorker(action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!worker || !workerReady) {
      reject(new Error("The qwq core is not ready yet."));
      return;
    }
    const id = ++requestSequence;
    pendingRequests.set(id, { resolve, reject });
    worker.postMessage({ id, action, ...payload });
  });
}

function renderDiagnostics(result, source) {
  const diagnostics = result.diagnostics ?? [];
  problemCount.textContent = String(diagnostics.length);
  panelStatus.textContent = result.ok ? "Type check passed" : `${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"}`;
  panelStatus.className = result.ok ? "panel-status success" : "panel-status error";
  diagnosticsPanel.replaceChildren();

  if (diagnostics.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-problems";
    empty.textContent = "No issues";
    diagnosticsPanel.append(empty);
    return;
  }

  for (const diagnostic of diagnostics) {
    const row = document.createElement("button");
    row.className = "diagnostic-row";
    const location = utf16Location(source, diagnostic.start);
    const phase = document.createElement("span");
    phase.className = "diagnostic-phase";
    phase.textContent = phaseName(diagnostic.phase);
    const message = document.createElement("span");
    message.className = "diagnostic-message";
    message.textContent = diagnostic.message;
    const where = document.createElement("span");
    where.className = "diagnostic-location";
    where.textContent = location ? `Line ${location.line}, column ${location.column}` : "Global";
    row.append(phase, message, where);
    row.addEventListener("click", () => {
      if (!location) return;
      const position = editor.getModel().getPositionAt(location.offset);
      editor.setPosition(position);
      editor.revealPositionInCenter(position);
      editor.focus();
    });
    diagnosticsPanel.append(row);
  }
}

function renderRunDiagnostics(diagnostics, source) {
  runDiagnostics.replaceChildren();
  for (const diagnostic of diagnostics ?? []) {
    const row = document.createElement("div");
    row.className = "run-diagnostic";
    const message = document.createElement("span");
    message.textContent = `${phaseName(diagnostic.phase)}: ${diagnostic.message}`;
    const location = utf16Location(source, diagnostic.start);
    const position = document.createElement("span");
    position.className = "diagnostic-location";
    position.textContent = location ? `Line ${location.line}, column ${location.column}` : "";
    row.append(message, position);
    runDiagnostics.append(row);
  }
}

function appendTerminalText(text, stream = "stdout") {
  if (!text || !terminal) return;
  terminal.write(stream === "stderr" ? `\u001b[38;5;203m${text}\u001b[0m` : text);
}

function writeTerminalInputBlock(block) {
  if (!terminal || !block) return;
  const lines = block.replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length - 1; index += 1) {
    terminal.write(`${lines[index]}\r\n`);
  }
}

function clearTerminalOutput() {
  terminal?.reset();
  terminalLineBuffer = "";
  runDiagnostics.replaceChildren();
  if (runSession?.kind === "web") {
    runSession.lastOutput = "";
    runSession.echoedInputs = [];
  }
}

function setTerminalStatus(message, state = "") {
  runResultStatus.textContent = message;
  runResultStatus.className = `terminal-status${state ? ` ${state}` : ""}`;
}

function setTerminalInputEnabled(enabled) {
  if (!terminal) return;
  terminal.options.disableStdin = !enabled;
  if (enabled) terminal.focus();
}

function setTerminalProcessControls({ running = false, acceptsInput = false } = {}) {
  setTerminalInputEnabled(acceptsInput);
  runButton.disabled = running || !workerReady;
}

function finishRunSession({ success = false, message = "Finished", state = "success" } = {}) {
  if (runSession) runSession.running = false;
  setTerminalStatus(message, state);
  setTerminalProcessControls();
  setStatus(message, state === "error" ? "error" : "success");
}

function handleTerminalEvent(event) {
  if (!runSession || event.runId !== runSession.id) return;
  if (event.type === "session") {
    runSession.running = true;
    setTerminalStatus(runSession.kind === "electron-system" ? "Running in system terminal" : "Running", "working");
    if (runSession.kind === "electron-embedded") {
      setTerminalProcessControls({ running: true, acceptsInput: true });
    } else {
      setTerminalProcessControls({ running: true });
    }
    return;
  }
  if (event.type === "data") {
    appendTerminalText(event.data, event.stream);
    return;
  }
  if (event.type === "error") {
    appendTerminalText(`${event.message}\n`, "stderr");
    finishRunSession({ message: "Failed to start", state: "error" });
    return;
  }
  if (event.type === "exit") {
    const success = event.code === 0 && !event.timedOut;
    const changed = runSession.revision !== currentRevision;
    const message = changed
      ? (success ? "Finished (source changed)" : "Stopped (source changed)")
      : (success ? "Finished" : (event.signal ? "Stopped" : "Exited with errors"));
    finishRunSession({ success, message, state: success ? "success" : "error" });
  }
}

function updateCursor(position = editor?.getPosition()) {
  if (!position) return;
  document.querySelector("#cursor-position").textContent = `Line ${position.lineNumber}, column ${position.column}`;
}

function isWaitingForWasmInput(result) {
  return (result.diagnostics ?? []).some((diagnostic) =>
    diagnostic.phase === "runtime" && diagnostic.message.includes("from the input stream, but the input ended"));
}

async function executeWebRun(session) {
  if (runSession !== session || session.cancelled) return;
  setTerminalStatus("Running", "working");
  setStatus("Running…");
  setTerminalProcessControls({ running: true, acceptsInput: true });
  session.executing = true;
  try {
    const response = await requestWorker("run", {
      source: session.source,
      input: session.input,
      revision: session.revision,
    });
    session.executing = false;
    if (runSession !== session || session.cancelled) return;
    const result = response.result;
    const output = result.output ?? "";
    if (output.startsWith(session.lastOutput)) {
      appendTerminalText(output.slice(session.lastOutput.length));
    } else {
      terminal.reset();
          terminalLineBuffer = "";
      appendTerminalText(output);
      for (const block of session.echoedInputs) writeTerminalInputBlock(block);
    }
    session.lastOutput = output;

    if (isWaitingForWasmInput(result) && !session.eof) {
      session.waiting = true;
      setTerminalStatus("Waiting for input", "working");
      setTerminalProcessControls({ running: true, acceptsInput: true });
      setStatus("Waiting for input");
      return;
    }

    renderRunDiagnostics(result.diagnostics, session.source);
    if (result.ok) finishRunSession({ success: true, message: "Finished" });
    else finishRunSession({ success: false, message: "Exited with errors", state: "error" });
  } catch (error) {
    session.executing = false;
    if (runSession !== session || session.cancelled) return;
    appendTerminalText(`${String(error?.message ?? error)}\n`, "stderr");
    finishRunSession({ success: false, message: "Run failed", state: "error" });
  }
}

function handleTerminalShortcut(event) {
  if (event.type !== "keydown" || !event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !runSession?.running || runSession.kind === "electron-system") {
    return true;
  }

  const key = event.key.toLowerCase();
  if (key === "c") {
    terminal.write("^C\\r\\n");
    stopRun();
    return false;
  }
  if (key === "z" || key === "d") {
    if (runSession.kind === "web" && !runSession.waiting) return false;
    void sendTerminalEOF();
    return false;
  }
  return true;
}

function handleTerminalInput(data) {
  if (!runSession?.running) return;
  if (data === "\u0003") {
    terminal.write("^C\r\n");
    stopRun();
    return;
  }
  if (data === "\u001a" || data === "\u0004") {
    if (runSession.kind === "web" && !runSession.waiting) return;
    void sendTerminalEOF();
    return;
  }
  if (runSession.kind === "web" && !runSession.waiting) return;

  const completedLines = [];
  const normalized = data.replace(/\r\n?/g, "\n");
  for (const character of normalized) {
    if (character === "\n") {
      terminal.write("\r\n");
      completedLines.push(`${terminalLineBuffer}\n`);
      terminalLineBuffer = "";
    } else if (character === "\u007f" || character === "\b") {
      if (terminalLineBuffer.length > 0) {
        terminalLineBuffer = Array.from(terminalLineBuffer).slice(0, -1).join("");
        terminal.write("\b \b");
      }
    } else if (character === "\t" || character >= " ") {
      terminalLineBuffer += character;
      terminal.write(character);
    }
  }

  if (completedLines.length === 0) return;
  const inputBlock = completedLines.join("");
  if (runSession.kind === "web") {
    const session = runSession;
    session.echoedInputs.push(...completedLines);
    session.input += inputBlock;
    session.waiting = false;
    void executeWebRun(session);
  } else if (runSession.kind === "electron-embedded") {
    window.qwqDesktop.writeInput(runSession.id, inputBlock);
  }
}
async function sendTerminalEOF() {
  if (!runSession?.running) return;
  const session = runSession;
  if (terminalLineBuffer) {
    terminal.write("\r\n");
    const pendingLine = `${terminalLineBuffer}\n`;
    terminalLineBuffer = "";
    if (session.kind === "web" && session.waiting) {
      session.input += pendingLine;
      session.echoedInputs.push(pendingLine);
    } else if (session.kind === "electron-embedded") {
      window.qwqDesktop.writeInput(session.id, pendingLine);
    }
  }

  if (session.kind === "web") {
    session.eof = true;
    session.waiting = false;
    setTerminalProcessControls({ running: true });
    await executeWebRun(session);
  } else if (session.kind === "electron-embedded") {
    window.qwqDesktop.endInput(session.id);
    setTerminalInputEnabled(false);
  }
}
function stopRun() {
  if (!runSession?.running) return;
  if (runSession.kind === "web") {
    const session = runSession;
    session.cancelled = true;
    const restartWorker = session.executing;
    finishRunSession({ success: false, message: "Stopped", state: "error" });
    if (restartWorker) restartAnalysisWorker();
  } else if (electronBuild && runSession.id) {
    window.qwqDesktop.stopRun(runSession.id);
  }
}

function applyAnalysisDecorations(result, source) {
  clearNavigationLink();
  const model = editor.getModel();
  syntaxDecorationIds = editor.deltaDecorations(
    syntaxDecorationIds,
    decorationsForAnalysis(result, source, model),
  );
  monaco.editor.setModelMarkers(model, "qwq", markersForAnalysis(result, source, model));
}

async function analyzeNow() {
  if (!workerReady) return;
  const revision = currentRevision;
  const source = editor.getValue();
  try {
    const response = await requestWorker("analyze", { source, revision });
    if (revision !== currentRevision) return;
    const result = response.result;
    applyAnalysisDecorations(result, source);
    diagnosticsPanel.classList.remove("stale");
    renderDiagnostics(result, source);
    setStatus(result.ok ? "Type check passed" : `${result.diagnostics.length} issue${result.diagnostics.length === 1 ? "" : "s"}`, result.ok ? "success" : "error");
  } catch (error) {
    if (revision !== currentRevision || error?.name === "AbortError") return;
    setStatus(String(error?.message ?? error), "error");
    panelStatus.textContent = "Analysis failed";
    panelStatus.className = "panel-status error";
  }
}

function scheduleAnalysis() {
  window.clearTimeout(analysisTimer);
  diagnosticsPanel.classList.add("stale");
  setStatus("Checking…");
  analysisTimer = window.setTimeout(analyzeNow, 180);
}

async function formatDocument() {
  if (!workerReady) return;
  const revision = currentRevision;
  const source = editor.getValue();
  setStatus("Formatting…");
  try {
    const response = await requestWorker("format", { source, revision });
    if (revision !== currentRevision) return;
    if (typeof response.result !== "string") throw new Error("Formatting failed. Fix the syntax errors first.");
    if (response.result !== source) {
      editor.pushUndoStop();
      editor.executeEdits("qwq-format", [{
        range: editor.getModel().getFullModelRange(),
        text: response.result,
        forceMoveMarkers: true,
      }]);
      editor.pushUndoStop();
    } else {
      setStatus("Already formatted", "success");
    }
    editor.focus();
  } catch (error) {
    setStatus(String(error?.message ?? error), "error");
  }
}

function addOpenedFile(name, source, metadata = {}) {
  const existing = workspaceFiles.find((file) =>
    (metadata.path && file.path === metadata.path) ||
    (metadata.handle && file.handle === metadata.handle));
  if (existing) {
    activateWorkspaceFile(existing.id);
    return existing;
  }
  const file = createWorkspaceFile(name, source, source, { ...metadata, keepName: true });
  activateWorkspaceFile(file.id);
  return file;
}

async function openCurrentFile() {
  try {
    if (electronBuild) {
      const opened = await window.qwqDesktop.openFile();
      if (!opened) return;
      addOpenedFile(opened.name, opened.source, { path: opened.path });
      setStatus(`Opened ${opened.name}`, "success");
      return;
    }

    if (typeof window.showOpenFilePicker === "function") {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: "qwq source files", accept: { "text/plain": [".qwq"] } }],
        });
        if (!handle) return;
        const file = await handle.getFile();
        addOpenedFile(file.name, await file.text(), { handle });
        setStatus(`Opened ${file.name}`, "success");
      } catch (error) {
        if (error?.name !== "AbortError") throw error;
      }
      return;
    }
    fileInput.click();
  } catch (error) {
    setStatus(`Could not open file: ${String(error?.message ?? error)}`, "error");
  }
}

async function writeBrowserFile(handle, source) {
  if (typeof handle.queryPermission === "function") {
    let permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted" && typeof handle.requestPermission === "function") {
      permission = await handle.requestPermission({ mode: "readwrite" });
    }
    if (permission !== "granted") throw new Error("Write access was not granted for this file.");
  }
  const writable = await handle.createWritable();
  await writable.write(source);
  await writable.close();
}

function downloadBrowserCopy(file, source) {
  const blob = new Blob([source], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveCurrentFile() {
  const file = getWorkspaceFile();
  if (!file) {
    setStatus("No file to save. Open or create a file first.", "error");
    return;
  }
  const source = editor.getValue();
  let savedAsDownload = false;
  try {
    if (electronBuild) {
      const result = await window.qwqDesktop.saveFile(file.path, source, file.name);
      if (result.canceled) return;
      file.path = result.path;
      file.name = normalizeFilename(result.name);
    } else if (file.handle) {
      await writeBrowserFile(file.handle, source);
    } else if (typeof window.showSaveFilePicker === "function") {
      try {
        file.handle = await window.showSaveFilePicker({
          suggestedName: file.name,
          types: [{ description: "qwq source files", accept: { "text/plain": [".qwq"] } }],
        });
        await writeBrowserFile(file.handle, source);
        const savedFile = await file.handle.getFile();
        file.name = normalizeFilename(savedFile.name);
      } catch (error) {
        if (error?.name === "AbortError") return;
        throw error;
      }
    } else {
      downloadBrowserCopy(file, source);
      savedAsDownload = true;
    }

    file.source = source;
    file.savedSource = source;
    persistWorkspace();
    renderFileTabs();
    renderWorkspaceFiles();
    updateActiveFilename();
    setStatus(savedAsDownload ? `Downloaded a copy of ${file.name}` : `Saved ${file.name}`, "success");
  } catch (error) {
    setStatus(`Could not save file: ${String(error?.message ?? error)}`, "error");
  }
}

async function runProgram() {
  if (!runEnabled || !workerReady) return;
  if (runSession?.running) {
    setStatus("A program is already running. Stop it before starting another.", "error");
    return;
  }

  window.clearTimeout(analysisTimer);
  setPanelTab("run");
  runButton.disabled = true;
  runResultStatus.textContent = "Starting…";
  runResultStatus.className = "terminal-status working";
  clearTerminalOutput();
  runDiagnostics.replaceChildren();
  terminalLineBuffer = "";
  setTerminalProcessControls({ running: true });
  setStatus("Starting runtime…");

  const source = editor.getValue();
  const revision = currentRevision;
  try {
    if (electronBuild) {
      const runId = globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const kind = settings.terminalMode === "system" ? "electron-system" : "electron-embedded";
      runSession = { id: runId, kind, source, revision, running: true };
      if (kind === "electron-system") {
        if (typeof window.qwqDesktop?.openTerminal !== "function") {
          throw new Error("The system terminal launcher is unavailable. Restart qwq-editor and try again.");
        }
        const result = await window.qwqDesktop.openTerminal(source);
        const terminalName = result?.terminal || "system terminal";
        appendTerminalText(`Opened ${terminalName}\n`);
        finishRunSession({ success: true, message: `Opened ${terminalName}` });
      } else {
        if (typeof window.qwqDesktop?.startRun !== "function") {
          throw new Error("The desktop runtime bridge is unavailable. Restart qwq-editor and try again.");
        }
        await window.qwqDesktop.startRun(source, runId);
      }
    } else {
      runSession = {
        id: globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: "web",
        source,
        revision,
        input: "",
        lastOutput: "",
        echoedInputs: [],
        waiting: false,
        eof: false,
        cancelled: false,
        executing: false,
        running: true,
      };
      await executeWebRun(runSession);
    }
  } catch (error) {
    const message = String(error?.message ?? error);
    appendTerminalText(`${message}\n`, "stderr");
    finishRunSession({ success: false, message: "Run failed", state: "error" });
  }
}

function createEditor() {
  emptyModel = monaco.editor.createModel("", qwqLanguageId);
  const activeFile = getWorkspaceFile();
  const model = activeFile ? getFileModel(activeFile) : emptyModel;
  if (!activeFile) activeFileId = null;
  const instance = monaco.editor.create(editorHost, {
    model,
    theme: qwqThemeName,
    automaticLayout: true,
    fontFamily: fontFamilyForEditor(),
    fontLigatures: settings.fontLigatures,
    fontSize: 14,
    lineHeight: 24,
    tabSize: 4,
    insertSpaces: false,
    detectIndentation: false,
    autoIndent: "full",
    autoClosingBrackets: "always",
    autoClosingQuotes: "always",
    autoClosingDelete: "always",
    autoClosingOvertype: "always",
    autoSurround: "brackets",
    wordWrap: "off",
    lineNumbers: "on",
    lineNumbersMinChars: 3,
    lineDecorationsWidth: 10,
    glyphMargin: true,
    folding: true,
    showFoldingControls: "mouseover",
    minimap: { enabled: true, side: "right", showSlider: "always", renderCharacters: false },
    scrollBeyondLastLine: true,
    renderLineHighlight: "all",
    matchBrackets: "always",
    bracketPairColorization: { enabled: true },
    guides: { indentation: true, bracketPairs: true, highlightActiveIndentation: true },
    padding: { top: 10, bottom: 24 },
    overviewRulerBorder: false,
    overviewRulerLanes: 2,
    hideCursorInOverviewRuler: true,
    smoothScrolling: true,
    cursorBlinking: "smooth",
    selectionHighlight: true,
    hover: { enabled: true, delay: 350, sticky: true },
    contextmenu: true,
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      alwaysConsumeMouseWheel: false,
    },
  });
  instance.onDidChangeModelContent(() => {
    const currentModel = instance.getModel();
    clearNavigationLink();
    hoveredNavigationPosition = null;
    clearFlowHoverData(currentModel);
    currentRevision += 1;
    monaco.editor.setModelMarkers(currentModel, "qwq", []);
    let file = getWorkspaceFile();
    if (!file && currentModel === emptyModel && instance.getValue().length > 0) {
      file = createWorkspaceFile(nextUntitledName(), instance.getValue(), "");
      modelsByFileId.set(file.id, currentModel);
      emptyModel = monaco.editor.createModel("", qwqLanguageId);
      activeFileId = file.id;
      openTabIds = [file.id];
      updateActiveFilename();
    }
    if (file) file.source = instance.getValue();
    persistWorkspace();
    renderFileTabs();
    renderWorkspaceFiles();
    scheduleAnalysis();
  });
  instance.onDidChangeCursorPosition((event) => updateCursor(event.position));
  instance.onMouseMove((event) => {
    const position = event.target?.position;
    hoveredNavigationPosition = position ?? null;
    const browserEvent = event.event?.browserEvent;
    if (position && (browserEvent?.ctrlKey || browserEvent?.metaKey)) {
      showNavigationLink(instance.getModel(), position);
    } else {
      clearNavigationLink();
    }
  });
  instance.onMouseLeave(() => {
    hoveredNavigationPosition = null;
    clearNavigationLink();
  });
  window.addEventListener("keydown", (event) => {
    if ((event.key === "Control" || event.key === "Meta") && hoveredNavigationPosition) {
      showNavigationLink(instance.getModel(), hoveredNavigationPosition);
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "Control" || event.key === "Meta") clearNavigationLink();
  });
  window.addEventListener("blur", clearNavigationLink);
  instance.onMouseDown((event) => {
    const mouseEvent = event.event?.browserEvent;
    if (!mouseEvent || (!mouseEvent.ctrlKey && !mouseEvent.metaKey)) return;
    const position = event.target?.position;
    if (!position) return;

    const model = instance.getModel();
    const target = flowNavigationAtPosition(model, position);
    if (!target) return;

    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();
    clearNavigationLink();
    hoveredNavigationPosition = null;
    const destination = model.getPositionAt(target.offset);
    instance.setPosition(destination);
    instance.revealPositionInCenter(destination);
    instance.focus();
  });
  instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
    void formatDocument();
  });
  instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void saveCurrentFile(); });
  instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, createNewFile);
  instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO, () => { void openCurrentFile(); });
  for (const key of [monaco.KeyCode.Enter, monaco.KeyCode.F5, monaco.KeyCode.F11]) {
    instance.addCommand(monaco.KeyMod.CtrlCmd | key, () => {
      if (workerReady) void runProgram();
    });
    if (key !== monaco.KeyCode.Enter) {
      instance.addCommand(key, () => {
        if (workerReady) void runProgram();
      });
    }
  }
  return instance;
}

function fitTerminal() {
  if (!terminal || !terminalFitAddon || runPanel.hidden) return;
  const bounds = terminalHost.getBoundingClientRect();
  if (bounds.width < 40 || bounds.height < 40) return;
  try {
    terminalFitAddon.fit();
  } catch {
    // Xterm can be between layout passes while the terminal tab is opening.
  }
}

function initializeTerminal() {
  terminal = new Terminal({
    allowTransparency: false,
    convertEol: true,
    cursorBlink: true,
    cursorStyle: "bar",
    disableStdin: true,
    fontFamily: fontFamilyForEditor(),
    fontSize: 12,
    scrollback: 10000,
    theme: {
      background: "#1e1e1e",
      foreground: "#d4d4d4",
      cursor: "#d4d4d4",
      selectionBackground: "#264f78",
      black: "#000000",
      red: "#cd3131",
      green: "#0dbc79",
      yellow: "#e5e510",
      blue: "#2472c8",
      magenta: "#bc3fbc",
      cyan: "#11a8cd",
      white: "#e5e5e5",
      brightBlack: "#666666",
      brightRed: "#f14c4c",
      brightGreen: "#23d18b",
      brightYellow: "#f5f543",
      brightBlue: "#3b8eea",
      brightMagenta: "#d670d6",
      brightCyan: "#29b8db",
      brightWhite: "#ffffff",
    },
  });
  terminalFitAddon = new FitAddon();
  terminal.loadAddon(terminalFitAddon);
  terminal.open(terminalHost);
  terminal.onData(handleTerminalInput);
  terminal.attachCustomKeyEventHandler(handleTerminalShortcut);
  terminal.write("Run a program to see its output here.\r\n");

  if (typeof ResizeObserver === "function") {
    terminalResizeObserver = new ResizeObserver(fitTerminal);
    terminalResizeObserver.observe(terminalHost);
  } else {
    window.addEventListener("resize", fitTerminal);
  }
}

initializeTerminal();
editor = createEditor();
updateActiveFilename();
renderFileTabs();
revealActiveFileTab();
renderWorkspaceFiles();
persistWorkspace();
updateCursor();

problemsTab.addEventListener("click", () => setPanelTab("problems"));
runTab.addEventListener("click", () => setPanelTab("run"));
newFileButton.addEventListener("click", createNewFile);
explorerOpenButton.addEventListener("click", () => { void openCurrentFile(); });
document.querySelector("#open-button").addEventListener("click", () => { void openCurrentFile(); });
document.querySelector("#save-button").addEventListener("click", () => { void saveCurrentFile(); });
document.querySelector("#format-button").addEventListener("click", () => { void formatDocument(); });
runButton.addEventListener("click", () => { void runProgram(); });
clearTerminalButton.addEventListener("click", clearTerminalOutput);

fileInput.addEventListener("change", async () => {
  const inputFile = fileInput.files?.[0];
  if (!inputFile) return;
  try {
    const source = await inputFile.text();
    addOpenedFile(inputFile.name, source);
    setStatus(`Opened ${inputFile.name}`, "success");
  } catch (error) {
    setStatus(`Could not open file: ${String(error?.message ?? error)}`, "error");
  } finally {
    fileInput.value = "";
  }
});

chooseRuntimeButton.addEventListener("click", async () => {
  if (typeof window.qwqDesktop?.chooseRuntime !== "function") return;
  chooseRuntimeButton.disabled = true;
  try {
    const selectedPath = await window.qwqDesktop.chooseRuntime();
    if (selectedPath) {
      runtimePathLabel.textContent = selectedPath;
      runtimePathLabel.title = selectedPath;
      const filename = selectedPath.split(/[\\/]/).pop();
      setStatus(`Selected qwqwq runtime: ${filename}`, "success");
      void refreshRuntimeVersionLabel();
    }
  } catch (error) {
    setStatus(`Could not set runtime: ${String(error?.message ?? error)}`, "error");
  } finally {
    chooseRuntimeButton.disabled = false;
  }
});

const releasesUrl = "https://github.com/qwq-language/qwq-editor/releases/latest";

function compareVersions(left, right) {
  const parse = (value) => String(value).replace(/^v/i, "").split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0);
  const first = parse(left);
  const second = parse(right);
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    const difference = (first[index] ?? 0) - (second[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

async function checkForUpdates() {
  checkUpdatesButton.disabled = true;
  updateStatus.textContent = "Checking…";
  try {
    const response = await fetch("https://api.github.com/repos/qwq-language/qwq-editor/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const release = await response.json();
    const tag = String(release.tag_name ?? "").trim();
    if (!tag) throw new Error("The latest release has no tag");
    const comparison = compareVersions(tag, editorVersion);
    latestReleaseLabel.hidden = false;
    latestReleaseLabel.textContent = release.html_url || releasesUrl;
    if (comparison > 0) {
      updateStatus.textContent = `Latest release: ${tag}`;
      checkUpdatesButton.textContent = "Open release";
      checkUpdatesButton.dataset.openRelease = "true";
    } else {
      updateStatus.textContent = `Up to date (latest ${tag})`;
      checkUpdatesButton.textContent = "Open releases";
      checkUpdatesButton.dataset.openRelease = "false";
    }
  } catch (error) {
    updateStatus.textContent = `Could not check: ${String(error?.message ?? error)}`;
    checkUpdatesButton.textContent = "Open releases";
    checkUpdatesButton.dataset.openRelease = "false";
  } finally {
    checkUpdatesButton.disabled = false;
  }
}

function openLatestRelease() {
  const url = latestReleaseLabel.hidden || !latestReleaseLabel.textContent
    ? releasesUrl
    : latestReleaseLabel.textContent;
  if (electronBuild && typeof window.qwqDesktop?.openExternal === "function") {
    void window.qwqDesktop.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

checkUpdatesButton.addEventListener("click", () => {
  if (checkUpdatesButton.dataset.openRelease) openLatestRelease();
  else void checkForUpdates();
});

settingsButton.addEventListener("click", () => {
  primaryFontInput.value = settings.primaryFont;
  secondaryFontInput.value = settings.secondaryFont;
  fontLigaturesInput.checked = settings.fontLigatures;
  embeddedTerminalRadio.checked = settings.terminalMode === "embedded";
  systemTerminalRadio.checked = electronBuild && settings.terminalMode === "system";
  if (typeof settingsDialog.showModal === "function") settingsDialog.showModal();
  else settingsDialog.setAttribute("open", "");
  void refreshRuntimeVersionLabel();
});
settingsClose.addEventListener("click", () => settingsDialog.close());
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  updateSettingsFromDialog();
  settingsDialog.close();
});
primaryFontInput.addEventListener("input", () => {
  settings.primaryFont = primaryFontInput.value.trim() || defaultSettings.primaryFont;
  applyEditorFont();
});
secondaryFontInput.addEventListener("input", () => {
  settings.secondaryFont = secondaryFontInput.value.trim() || defaultSettings.secondaryFont;
  applyEditorFont();
});
fontLigaturesInput.addEventListener("change", () => {
  settings.fontLigatures = fontLigaturesInput.checked;
  applyEditorFont();
});
embeddedTerminalRadio.addEventListener("change", () => {
  if (!embeddedTerminalRadio.checked) return;
  settings.terminalMode = "embedded";
  persistSettings();
});
systemTerminalRadio.addEventListener("change", () => {
  if (!electronBuild || !systemTerminalRadio.checked) return;
  settings.terminalMode = "system";
  persistSettings();
});
resetSettingsButton.addEventListener("click", () => {
  settings = { ...defaultSettings };
  primaryFontInput.value = settings.primaryFont;
  secondaryFontInput.value = settings.secondaryFont;
  fontLigaturesInput.checked = settings.fontLigatures;
  embeddedTerminalRadio.checked = true;
  systemTerminalRadio.checked = false;
  persistSettings();
  applyEditorFont();
});
settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});

function updateMaximizeButton(maximized) {
  maximizedWindow = Boolean(maximized);
  maximizeButton.innerHTML = maximizedWindow ? icon.restore : icon.maximize;
  maximizeButton.title = maximizedWindow ? "Restore" : "Maximize";
  maximizeButton.setAttribute("aria-label", maximizeButton.title);
}

minimizeButton.addEventListener("click", () => { void window.qwqDesktop?.minimize(); });
maximizeButton.addEventListener("click", async () => {
  const state = await window.qwqDesktop?.toggleMaximize();
  if (state) updateMaximizeButton(state.maximized);
});
windowCloseButton.addEventListener("click", () => { void window.qwqDesktop?.closeWindow(); });
if (electronBuild && window.qwqDesktop) {
  window.qwqDesktop.getWindowState().then((state) => updateMaximizeButton(state.maximized)).catch(() => {});
  window.qwqDesktop.getRuntimePath().then((runtimePath) => {
    runtimePathLabel.textContent = runtimePath || "qwqwq was not found on PATH";
    runtimePathLabel.title = runtimePath || runtimePathLabel.textContent;
  }).catch(() => {});
  window.qwqDesktop.onWindowStateChanged((state) => updateMaximizeButton(state.maximized));
  window.qwqDesktop.onTerminalEvent(handleTerminalEvent);
}

embeddedTerminalRadio.checked = settings.terminalMode === "embedded";
systemTerminalRadio.checked = electronBuild && settings.terminalMode === "system";
problemsTab.click();
startAnalysisWorker();
