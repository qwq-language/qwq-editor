@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "WEB_DIR=%%~fI"
if defined QWQ_ROOT_DIR (
  for %%I in ("%QWQ_ROOT_DIR%") do set "ROOT_DIR=%%~fI"
) else (
  for %%I in ("%SCRIPT_DIR%..\..") do set "ROOT_DIR=%%~fI"
)

set "HAS_WASM=1"
if not exist "%WEB_DIR%\src\wasm\qwq.js" set "HAS_WASM="
if not exist "%WEB_DIR%\src\wasm\qwq.wasm" set "HAS_WASM="
if defined HAS_WASM for %%F in ("%WEB_DIR%\src\wasm\qwq.js" "%WEB_DIR%\src\wasm\qwq.wasm") do if %%~zF LEQ 0 set "HAS_WASM="

if not exist "%ROOT_DIR%\src\ast.cpp" (
  if defined HAS_WASM (
    echo The qwqwq C++ source tree is not present; reusing the editor's full WASM assets.
    exit /b 0
  )
  echo error: no qwqwq C++ source tree or prebuilt full WASM assets were found. 1>&2
  echo Set QWQ_ROOT_DIR to a source checkout or restore src\wasm\qwq.js and src\wasm\qwq.wasm. 1>&2
  exit /b 1
)

where em++ >nul 2>&1
if not errorlevel 1 goto :build_wasm
if defined EMSDK if exist "%EMSDK%\emsdk_env.bat" goto :build_wasm
if defined USERPROFILE if exist "%USERPROFILE%\emsdk\emsdk_env.bat" goto :build_wasm
if defined USERPROFILE if exist "%USERPROFILE%\.emsdk\emsdk_env.bat" goto :build_wasm
if defined USERPROFILE if exist "%USERPROFILE%\.cache\emsdk\emsdk_env.bat" goto :build_wasm
if defined HOME if exist "%HOME%\emsdk\emsdk_env.bat" goto :build_wasm
if defined HOME if exist "%HOME%\.emsdk\emsdk_env.bat" goto :build_wasm
if defined HOME if exist "%HOME%\.cache\emsdk\emsdk_env.bat" goto :build_wasm
if defined HAS_WASM (
  echo Emscripten is unavailable; reusing the existing WASM build.
  exit /b 0
)
echo error: Emscripten is required to build the WASM core, and no existing build was found. 1>&2
exit /b 1

:build_wasm
call "%SCRIPT_DIR%build-wasm.bat"
exit /b %ERRORLEVEL%
