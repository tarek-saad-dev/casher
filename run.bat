@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ═════════════════════════════════════════════════════════════════════════════
:: POS SYSTEM RUNNER - WINDOWS BATCH SCRIPT
:: ═════════════════════════════════════════════════════════════════════════════
:: This script runs the POS system website with proper setup
:: Supports multiple modes: dev, build, start, clean, check
:: ═════════════════════════════════════════════════════════════════════════════

title POS System - Salon Management

:: Set colors
color 0A

:: Display header
echo.
echo ╔═════════════════════════════════════════════════════════════════════════════╗
echo ║                    POS SYSTEM - SALON MANAGEMENT                          ║
echo ║                         Windows Runner Script                              ║
echo ╚═════════════════════════════════════════════════════════════════════════════╝
echo.

:: Check if we're in the right directory
if not exist "package.json" (
    echo [ERROR] package.json not found!
    echo Please run this script from the pos-system directory
    echo.
    pause
    exit /b 1
)

:: Check Node.js installation
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Display Node.js version
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [INFO] Node.js version: %NODE_VERSION%

:: Check npm installation
npm --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not installed!
    echo.
    pause
    exit /b 1
)

:: Display npm version
for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo [INFO] npm version: %NPM_VERSION%
echo.

:: Parse command line arguments
set MODE=dev
set PORT=5500
set CLEAN=false
set CHECK=false

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="dev" set MODE=dev& shift & goto parse_args
if /i "%~1"=="build" set MODE=build& shift & goto parse_args
if /i "%~1"=="start" set MODE=start& shift & goto parse_args
if /i "%~1"=="clean" set CLEAN=true& shift & goto parse_args
if /i "%~1"=="check" set CHECK=true& shift & goto parse_args
if /i "%~1"=="port" set PORT=%~2& shift & shift & goto parse_args
if /i "%~1"=="--help" goto help
if /i "%~1"=="/?" goto help
echo [WARNING] Unknown argument: %~1
shift
goto parse_args

:args_done

:: Show current mode
echo [INFO] Running mode: %MODE%
if not "%PORT%"=="5500" echo [INFO] Port: %PORT%
echo.

:: Clean mode
if "%CLEAN%"=="true" (
    echo [CLEAN] Cleaning up...
    if exist ".next" (
        echo   - Removing .next directory...
        rmdir /s /q .next
    )
    if exist "node_modules\.cache" (
        echo   - Clearing npm cache...
        rmdir /s /q node_modules\.cache
    )
    echo   - Running npm cache clean...
    npm cache clean --force >nul 2>&1
    echo [CLEAN] Cleanup completed!
    echo.
)

:: Check mode
if "%CHECK%"=="true" (
    echo [CHECK] Checking system requirements...
    
    :: Check if dependencies are installed
    if not exist "node_modules" (
        echo [CHECK] Dependencies not found. Installing...
        npm install
    )
    
    :: Check TypeScript compilation
    echo [CHECK] Testing TypeScript compilation...
    npx tsc --noEmit
    if errorlevel 1 (
        echo [ERROR] TypeScript compilation failed!
        pause
        exit /b 1
    )
    
    :: Check if build works
    echo [CHECK] Testing build process...
    npm run build
    if errorlevel 1 (
        echo [ERROR] Build failed!
        pause
        exit /b 1
    )
    
    echo [CHECK] All checks passed! System is ready to run.
    echo.
    pause
    exit /b 0
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo [SETUP] Installing dependencies...
    echo This may take a few minutes on first run...
    echo.
    npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies!
        pause
        exit /b 1
    )
    echo.
    echo [SETUP] Dependencies installed successfully!
    echo.
)

:: Execute based on mode
if /i "%MODE%"=="dev" goto dev_mode
if /i "%MODE%"=="build" goto build_mode
if /i "%MODE%"=="start" goto start_mode

echo [ERROR] Unknown mode: %MODE%
goto help

:dev_mode
echo [DEV] Starting development server...
echo [DEV] Server will be available at: http://localhost:%PORT%
echo [DEV] Press Ctrl+C to stop the server
echo.
set PORT=%PORT% npm run dev
goto end

:build_mode
echo [BUILD] Building for production...
echo.
npm run build
if errorlevel 1 (
    echo [ERROR] Build failed!
    pause
    exit /b 1
)
echo.
echo [BUILD] Build completed successfully!
echo Output is in the .next directory
echo.
pause
goto end

:start_mode
echo [START] Starting production server...
echo.
if not exist ".next" (
    echo [ERROR] Production build not found!
    echo Please run: run.bat build
    echo.
    pause
    exit /b 1
)
echo [START] Server will be available at: http://localhost:%PORT%
echo [START] Press Ctrl+C to stop the server
echo.
set PORT=%PORT% npm start
goto end

:help
echo.
echo ╔═════════════════════════════════════════════════════════════════════════════╗
echo ║                              USAGE                                         ║
echo ╚═════════════════════════════════════════════════════════════════════════════╝
echo.
echo run.bat [MODE] [OPTIONS]
echo.
echo MODES:
echo   dev     - Start development server (default)
echo   build   - Build for production
echo   start   - Start production server
echo   clean   - Clean cache and temporary files
echo   check   - Check system requirements and test build
echo.
echo OPTIONS:
echo   port N  - Set port number (default: 5500)
echo.
echo EXAMPLES:
echo   run.bat                 - Start development server on port 5500
echo   run.bat dev port 8080   - Start development server on port 8080
echo   run.bat build           - Build for production
echo   run.bat start           - Start production server
echo   run.bat clean           - Clean temporary files
echo   run.bat check           - Check system and test build
echo.
echo REQUIREMENTS:
echo   - Node.js (v14 or higher)
echo   - npm (comes with Node.js)
echo   - Windows 10 or higher
echo.
echo DATABASE SETUP:
echo   - Make sure SQL Server is running
echo   - Update .env.local with your database credentials
echo   - Default database: HawaiDB
echo.
goto end

:end
echo.
echo [DONE] Operation completed.
pause
