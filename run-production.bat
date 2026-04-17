@echo off
color 0B
title POS System - Production Server

echo ╔═════════════════════════════════════════════════════════════════════════════╗
echo ║                  POS SYSTEM - PRODUCTION SERVER                            ║
echo ╚═════════════════════════════════════════════════════════════════════════════╝
echo.

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found!
    pause
    exit /b 1
)

:: Check if build exists
if not exist ".next" (
    echo [BUILD] Production build not found. Building now...
    echo This may take a few minutes...
    echo.
    npm run build
    if errorlevel 1 (
        echo [ERROR] Build failed!
        pause
        exit /b 1
    )
    echo.
    echo [BUILD] Production build completed!
    echo.
)

:: Start production server
echo [START] Starting production server...
echo Server will be available at: http://localhost:5500
echo Press Ctrl+C to stop the server
echo.

:: Wait a moment then open browser
timeout /t 2 /nobreak >nul
start http://localhost:5500

:: Start production server
set PORT=5500
npm start
