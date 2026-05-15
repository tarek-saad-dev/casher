@echo off
chcp 65001 >nul
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
echo [OK] Starting Next.js dev server on port 5500...
echo.
echo ------------------------------------------
echo  Local:    http://localhost:5500
echo  Network:  http://192.168.1.2:5500
echo ------------------------------------------
echo.

:: Start Chrome in background (give server 2 seconds to start)
echo [OK] Opening Chrome at http://localhost:5500/ ...
timeout /t 2 /nobreak >nul
start chrome "http://localhost:5500/"

echo.
echo Press Ctrl+C to stop the server
echo.

:: Start the dev server
npm run dev

:: Keep window open if server crashes
pause
