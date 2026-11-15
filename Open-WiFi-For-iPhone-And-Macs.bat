@echo off
title J.A.R.V.I.S. // Unlock Home Wi-Fi Firewall for iPhone & MacBooks
echo =====================================================================
echo   J.A.R.V.I.S. // UNLOCKING WINDOWS FIREWALL FOR IPHONE ^& MACBOOKS
echo =====================================================================
echo.
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting Windows Administrator permission to allow Port 7777 on Home Wi-Fi...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

netsh advfirewall firewall delete rule name="JARVIS Command Hub (TCP 7777)" >nul 2>&1
netsh advfirewall firewall add rule name="JARVIS Command Hub (TCP 7777)" dir=in action=allow protocol=TCP localport=7777 profile=any
netsh advfirewall firewall add rule name="JARVIS Command Hub App" dir=in action=allow program="%~dp0bin\JarvisHub.exe" profile=any

echo.
echo =====================================================================
echo   SUCCESS! Port 7777 is now open on Private + Public Home Wi-Fi!
echo   Your iPhone and MacBooks can now connect to http://10.0.0.85:7777
echo =====================================================================
timeout /t 5
