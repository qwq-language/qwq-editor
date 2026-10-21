#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="${QWQ_ROOT_DIR:-$WEB_DIR/..}"
if [[ -d "$ROOT_DIR" ]]; then
  ROOT_DIR="$(cd -- "$ROOT_DIR" && pwd)"
fi

has_wasm=false
if [[ -s "$WEB_DIR/src/wasm/qwq.js" && -s "$WEB_DIR/src/wasm/qwq.wasm" ]]; then
  has_wasm=true
fi

if [[ ! -f "$ROOT_DIR/src/ast.cpp" ]]; then
  if [[ "$has_wasm" == true ]]; then
    echo "The qwqwq C++ source tree is not present; reusing the editor's full WASM assets."
    exit 0
  fi
  echo "error: no qwqwq C++ source tree or prebuilt full WASM assets were found." >&2
  echo "Set QWQ_ROOT_DIR to a source checkout or restore src/wasm/qwq.js and src/wasm/qwq.wasm." >&2
  exit 1
fi

has_emscripten=false
if command -v em++ >/dev/null 2>&1; then
  has_emscripten=true
else
  for sdk_root in "${EMSDK:-}" "$HOME/emsdk" "$HOME/.emsdk" "$HOME/.cache/emsdk"; do
    if [[ -n "$sdk_root" && -f "$sdk_root/emsdk_env.sh" ]]; then
      has_emscripten=true
      break
    fi
  done
fi

if [[ "$has_emscripten" == true ]]; then
  bash "$SCRIPT_DIR/build-wasm.sh"
elif [[ "$has_wasm" == true ]]; then
  echo "Emscripten is unavailable; reusing the existing WASM build."
else
  echo "error: Emscripten is required to build the WASM core, and no existing build was found." >&2
  exit 1
fi
