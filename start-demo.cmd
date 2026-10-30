@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 24 is required. Install it, then open this launcher again.
  goto failed
)
node -e "if (Number(process.versions.node.split('.')[0]) !== 24) { console.error('Node.js 24 is required. Current: ' + process.versions.node); process.exit(1); }"
if errorlevel 1 goto failed

if not exist "node_modules\tsx\dist\cli.mjs" goto install
if not exist "node_modules\vite\bin\vite.js" goto install
goto run

:install
call npm.cmd ci
if errorlevel 1 goto failed

:run
echo Travel Reliability - synthetic, temporary demo
echo Open http://127.0.0.1:5173 after the server starts.
echo Keep this window open. Press Ctrl+C to stop.
call npm.cmd run demo
set "TRAVEL_DEMO_EXIT=%ERRORLEVEL%"
goto finish

:failed
set "TRAVEL_DEMO_EXIT=1"
echo The demo did not start. Read the error above.
if not "%~1"=="--no-pause" pause

:finish
popd
exit /b %TRAVEL_DEMO_EXIT%
