@echo off
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\Agent HUD.exe" "%~dp0codex-bridge.cjs"
