@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "WEB_DIR=%%~fI"
if defined QWQ_ROOT_DIR (
  for %%I in ("%QWQ_ROOT_DIR%") do set "ROOT_DIR=%%~fI"
) else (
  for %%I in ("%SCRIPT_DIR%..\..") do set "ROOT_DIR=%%~fI"
)
if not exist "%ROOT_DIR%\src\ast.cpp" (
  echo error: C++ sources were not found under "%ROOT_DIR%\src". 1>&2
  echo Set QWQ_ROOT_DIR to the qwqwq repository root if it is elsewhere. 1>&2
  exit /b 1
)

where em++ >nul 2>&1
if errorlevel 1 call :activate_emsdk
where em++ >nul 2>&1
if errorlevel 1 goto :missing_emscripten

if defined QWQ_WASM_OUTPUT_DIR (
  set "OUTPUT_DIR=%QWQ_WASM_OUTPUT_DIR%"
) else (
  set "OUTPUT_DIR=src\wasm"
)
pushd "%WEB_DIR%" || exit /b 1
for %%I in ("%OUTPUT_DIR%") do set "OUTPUT_DIR=%%~fI"
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"
if errorlevel 1 goto :build_failed

set "SOURCES="%WEB_DIR%\wasm\bridge.cpp" "%WEB_DIR%\wasm\provenance.cpp" "%ROOT_DIR%\src\ast.cpp" "%ROOT_DIR%\src\checker.cpp" "%ROOT_DIR%\src\fmt.cpp" "%ROOT_DIR%\src\lexer.cpp" "%ROOT_DIR%\src\parser.cpp" "%ROOT_DIR%\src\type.cpp" "%ROOT_DIR%\src\value.cpp""
set "MODE_FLAG="
if "%QWQ_ANALYZE_ONLY%"=="1" (
  set "MODE_FLAG=-DQWQ_ANALYZE_ONLY"
  set "EXPORTED_FUNCTIONS=['_qwq_version','_qwq_analyze','_qwq_format','_qwq_free']"
) else (
  set "SOURCES=%SOURCES% "%ROOT_DIR%\src\interpreter.cpp""
  set "EXPORTED_FUNCTIONS=['_qwq_version','_qwq_analyze','_qwq_format','_qwq_run','_qwq_free']"
)

em++ %SOURCES% %MODE_FLAG% ^
  -std=c++20 ^
  -O2 ^
  -fexceptions ^
  -I"%ROOT_DIR%\src\include" ^
  -o "%OUTPUT_DIR%\qwq.js" ^
  -s MODULARIZE=1 ^
  -s EXPORT_ES6=1 ^
  -s EXPORT_NAME=createQwqModule ^
  -s ENVIRONMENT=web,worker ^
  -s ALLOW_MEMORY_GROWTH=1 ^
  -s MAXIMUM_MEMORY=268435456 ^
  -s STACK_SIZE=4194304 ^
  -s "EXPORTED_FUNCTIONS=%EXPORTED_FUNCTIONS%" ^
  -s "EXPORTED_RUNTIME_METHODS=['ccall','UTF8ToString']" ^
  -s DISABLE_EXCEPTION_CATCHING=0 ^
  -s FILESYSTEM=0
if errorlevel 1 goto :build_failed

echo Built %OUTPUT_DIR%\qwq.js
node "%SCRIPT_DIR%wasm-version.cjs" --record "%ROOT_DIR%" "%OUTPUT_DIR%"
popd
exit /b 0

:activate_emsdk
set "EMSDK_ENV="
if defined EMSDK if exist "%EMSDK%\emsdk_env.bat" set "EMSDK_ENV=%EMSDK%\emsdk_env.bat"
if not defined EMSDK_ENV if defined USERPROFILE if exist "%USERPROFILE%\emsdk\emsdk_env.bat" set "EMSDK_ENV=%USERPROFILE%\emsdk\emsdk_env.bat"
if not defined EMSDK_ENV if defined USERPROFILE if exist "%USERPROFILE%\.emsdk\emsdk_env.bat" set "EMSDK_ENV=%USERPROFILE%\.emsdk\emsdk_env.bat"
if not defined EMSDK_ENV if defined USERPROFILE if exist "%USERPROFILE%\.cache\emsdk\emsdk_env.bat" set "EMSDK_ENV=%USERPROFILE%\.cache\emsdk\emsdk_env.bat"
if not defined EMSDK_ENV if defined HOME if exist "%HOME%\emsdk\emsdk_env.bat" set "EMSDK_ENV=%HOME%\emsdk\emsdk_env.bat"
if not defined EMSDK_ENV if defined HOME if exist "%HOME%\.emsdk\emsdk_env.bat" set "EMSDK_ENV=%HOME%\.emsdk\emsdk_env.bat"
if not defined EMSDK_ENV if defined HOME if exist "%HOME%\.cache\emsdk\emsdk_env.bat" set "EMSDK_ENV=%HOME%\.cache\emsdk\emsdk_env.bat"
if defined EMSDK_ENV call "%EMSDK_ENV%" >nul 2>&1
exit /b 0

:missing_emscripten
echo error: em++ was not found. Install Emscripten or add its emsdk directory to PATH. 1>&2
exit /b 1

:build_failed
set "BUILD_ERROR=%ERRORLEVEL%"
popd
echo error: Emscripten WASM build failed. 1>&2
exit /b %BUILD_ERROR%
