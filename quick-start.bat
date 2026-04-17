@echo off
color 0A
title POS System - Quick Start

echo ╔═════════════════════════════════════════════════════════════════════════════╗
echo ║                    POS SYSTEM - QUICK START                               ║
echo ╚═════════════════════════════════════════════════════════════════════════════╝
echo.

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found! Please install Node.js first.
    echo Download from: https://nodejs.org/
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo [SETUP] Installing dependencies (first time only)...
    npm install
    echo.
)

:: Start development server
echo [START] Starting POS System...
echo Opening browser at: http://localhost:5500
echo Press Ctrl+C to stop the server
echo.

:: Wait a moment then open browser
timeout /t 3 /nobreak >nul
start http://localhost:5500

:: Start the server
set PORT=5500
npm run dev
