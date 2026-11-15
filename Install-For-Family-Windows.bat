@echo off
title Personal J.A.R.V.I.S. Command Center — 1-Click Family & Friends Installer
color 0B
echo ============================================================================
echo   PERSONAL J.A.R.V.I.S. AI COMMAND CENTER — 1-CLICK WINDOWS INSTALLER
echo ============================================================================
echo.
echo   [1/3] Preparing clean private workspace and unblocking downloaded files...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '%~dp0' -Recurse | Unblock-File -ErrorAction SilentlyContinue"

echo   [2/3] Building native Windows AI Hub and Desktop Icon...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build-Icon-And-Exes.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Create-Desktop-Shortcut.ps1"

echo   [3/3] Launching your Personal AI Command Center...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Jarvis.ps1"

echo.
echo ============================================================================
echo   SUCCESS! Your Personal AI Command Center is now open and added to Desktop!
echo   - Step 1: Set your private Master Passcode (6+ characters).
echo   - Step 2: Click "Security & Settings" to rename your AI, pick a 3D
echo             Holographic Person or upload any photo, and paste your free
echo             Google Gemini API key from https://aistudio.google.com/apikey
echo ============================================================================
timeout /t 6 >nul
