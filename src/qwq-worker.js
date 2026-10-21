import createQwqModule from "./wasm/qwq.js";

function callStringFunction(module, name, args) {
  const pointer = module.ccall(name, "number", args.map(() => "string"), args);
  if (!pointer) throw new Error(`qwq core returned no result from ${name}`);
  const value = module.UTF8ToString(pointer);
  module._qwq_free(pointer);
  return value;
}

const corePromise = createQwqModule()
  .then((module) => {
    self.postMessage({ type: "ready" });
    return module;
  })
  .catch((error) => {
    self.postMessage({ type: "startup-error", message: String(error?.message ?? error) });
    return null;
  });

self.addEventListener("message", async (event) => {
  const { id, action, source, input = "", revision } = event.data;
  try {
    const module = await corePromise;
    if (!module) throw new Error("qwq WebAssembly core failed to load");
    let result;
    if (action === "analyze") {
      result = JSON.parse(callStringFunction(module, "qwq_analyze", [source]));
    } else if (action === "format") {
      result = callStringFunction(module, "qwq_format", [source]);
    } else if (action === "run") {
      result = JSON.parse(callStringFunction(module, "qwq_run", [source, input]));
    } else {
      throw new Error(`Unknown editor action: ${action}`);
    }
    self.postMessage({ type: "result", id, action, revision, result });
  } catch (error) {
    self.postMessage({
      type: "request-error",
      id,
      action,
      revision,
      message: String(error?.message ?? error),
    });
  }
});
