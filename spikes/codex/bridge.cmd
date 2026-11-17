@echo off
rem Spike (throwaway): run the HUD's own exe as Node to forward one Codex hook event to the spike receiver.
set ELECTRON_RUN_AS_NODE=1
"%LOCALAPPDATA%\Programs\Agent HUD\Agent HUD.exe" "%~dp0bridge.cjs" http://127.0.0.1:47997/agent-hud/hook spike
