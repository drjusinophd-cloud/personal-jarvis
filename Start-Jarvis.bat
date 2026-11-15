@echo off
title J.A.R.V.I.S. Multi-Laptop Command Hub
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Jarvis.ps1" %*
if errorlevel 1 pause
