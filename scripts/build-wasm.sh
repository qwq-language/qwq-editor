#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd -- "${QWQ_ROOT_DIR:-$WEB_DIR/..}" && pwd)"

if [[ ! -f "$ROOT_DIR/src/ast.cpp" ]]; then
  echo "error: C++ sources were not found under '$ROOT_DIR/src'; set QWQ_ROOT_DIR to the qwqwq repository root" >&2
  exit 1
fi

if ! command -v em++ >/dev/null 2>&1; then
  for sdk_root in "${EMSDK:-}" "$HOME/emsdk" "$HOME/.emsdk" "$HOME/.cache/emsdk"; do
    if [[ -n "$sdk_root" && -f "$sdk_root/emsdk_env.sh" ]]; then
      # shellcheck disable=SC1090
      source "$sdk_root/emsdk_env.sh" >/dev/null
      break
    fi
  done
fi

if ! command -v em++ >/dev/null 2>&1; then
  echo "error: em++ was not found; install Emscripten and source emsdk_env.sh" >&2
  exit 1
fi

OUTPUT_DIR="${QWQ_WASM_OUTPUT_DIR:-$WEB_DIR/src/wasm}"
if [[ "$OUTPUT_DIR" != /* ]]; then
  OUTPUT_DIR="$WEB_DIR/$OUTPUT_DIR"
fi
mkdir -p "$OUTPUT_DIR"

SOURCES=(
  "$WEB_DIR/wasm/bridge.cpp"
  "$WEB_DIR/wasm/provenance.cpp"
  "$ROOT_DIR/src/ast.cpp"
  "$ROOT_DIR/src/checker.cpp"
  "$ROOT_DIR/src/fmt.cpp"
  "$ROOT_DIR/src/lexer.cpp"
  "$ROOT_DIR/src/parser.cpp"
  "$ROOT_DIR/src/type.cpp"
  "$ROOT_DIR/src/value.cpp"
)
MODE_FLAGS=()
if [[ "${QWQ_ANALYZE_ONLY:-0}" == "1" ]]; then
  MODE_FLAGS+=(-DQWQ_ANALYZE_ONLY)
  EXPORTED_FUNCTIONS='["_qwq_version","_qwq_analyze","_qwq_format","_qwq_free"]'
else
  SOURCES+=("$ROOT_DIR/src/interpreter.cpp")
  EXPORTED_FUNCTIONS='["_qwq_version","_qwq_analyze","_qwq_format","_qwq_run","_qwq_free"]'
fi

em++ "${SOURCES[@]}" "${MODE_FLAGS[@]}" \
  -std=c++20 \
  -O2 \
  -fexceptions \
  -I"$ROOT_DIR/src/include" \
  -o "$OUTPUT_DIR/qwq.js" \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME=createQwqModule \
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MAXIMUM_MEMORY=268435456 \
  -s STACK_SIZE=4194304 \
  -s "EXPORTED_FUNCTIONS=$EXPORTED_FUNCTIONS" \
  -s 'EXPORTED_RUNTIME_METHODS=["ccall","UTF8ToString"]' \
  -s DISABLE_EXCEPTION_CATCHING=0 \
  -s FILESYSTEM=0

printf 'Built %s\n' "$OUTPUT_DIR/qwq.js"

if [[ -f "$SCRIPT_DIR/write-wasm-version.cjs" ]]; then
  node "$SCRIPT_DIR/write-wasm-version.cjs" "$ROOT_DIR" "$OUTPUT_DIR"
fi
