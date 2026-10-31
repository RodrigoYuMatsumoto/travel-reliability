@echo off
setlocal
title Travel Reliability - demo
pushd "%~dp0"
if errorlevel 1 exit /b 1

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 24 is required. Install the official Node.js 24 package, then open this launcher again.
  echo https://nodejs.org/download/release/latest-v24.x/
  goto failed
)
node -e "if (parseInt(process.versions.node, 10) !== 24) { console.error('Node.js 24 is required. Current: ' + process.versions.node); process.exit(1); }"
if errorlevel 1 goto failed
echo Travel Reliability - synthetic, temporary demo
node "%~dp0scripts\bootstrap-demo.mjs" %*
set "TRAVEL_DEMO_EXIT=%ERRORLEVEL%"
if not "%TRAVEL_DEMO_EXIT%"=="0" goto failed
goto finish

:failed
set "TRAVEL_DEMO_EXIT=1"
echo The demo did not start. Read the error above or docs/INSTALLATION.md.
if not "%~1"=="--no-pause" pause

:finish
popd
exit /b %TRAVEL_DEMO_EXIT%
