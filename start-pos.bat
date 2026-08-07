@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title POS System - Dev Server
color 0A

echo ==========================================
echo       POS System - Starting Dev Server
echo ==========================================
echo.

:: Navigate to project folder
cd /d "C:\Users\user\Desktop\pos-system"

:: Check if node_modules exists
if not exist "node_modules" (
    echo [!] node_modules not found! Running npm install...
    npm install
    if errorlevel 1 (
        echo [X] npm install failed!
        pause
        exit /b 1
    )
)

echo [OK] Project folder: C:\Users\user\Desktop\pos-system

:: If Turbopack cache ballooned (multi-GB), cold compiles become painfully slow.
powershell -NoProfile -Command "if (Test-Path '.next\dev\cache\turbopack') { $s=(Get-ChildItem -LiteralPath '.next\dev\cache\turbopack' -Recurse -File -EA SilentlyContinue | Measure-Object Length -Sum).Sum; if ($s -ge 2GB) { Write-Host '[!] Turbopack cache is large — clearing .next for faster compiles...'; Remove-Item -LiteralPath '.next' -Recurse -Force -EA SilentlyContinue; Write-Host '[OK] Cleared .next cache' } }"

:: Check if print-service node_modules exists
if not exist "print-service\node_modules" (
    echo [!] Print service dependencies not found! Installing...
    cd print-service
    npm install
    cd ..
    if errorlevel 1 (
        echo [X] Print service npm install failed!
        pause
        exit /b 1
    )
)

:: Start the print service in a new window
echo [OK] Starting Print Service on port 7788...
start "POS Print Service" cmd /k "cd /d C:\Users\user\Desktop\pos-system\print-service && npm start"
timeout /t 2 /nobreak >nul

echo [OK] Starting Next.js dev server on port 5500...
echo.
echo ------------------------------------------
echo  Local:    http://localhost:5500
echo  Network:  http://192.168.1.2:5500
echo ------------------------------------------
echo.

:: Start Edge in background (give server 2 seconds to start)
echo [OK] Opening Edge at http://localhost:5500/ ...
timeout /t 2 /nobreak >nul
start msedge "http://localhost:5500/"

echo.
echo Press Ctrl+C to stop the server
echo.

:: Start the dev server
npm run dev

:: Keep window open if server crashes
pause
