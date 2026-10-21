import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";

globalThis.MonacoEnvironment = {
  ...globalThis.MonacoEnvironment,
  getWorker() {
    return new EditorWorker();
  },
};
