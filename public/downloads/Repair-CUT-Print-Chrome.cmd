@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title CUT SALON - Repair Chrome for Printing
color 1F
echo ================================================================
echo        CUT SALON - FIX MISSING CHROME FOR PRINTING
echo ================================================================
echo Installs the matching Chrome for Testing required by Puppeteer.
echo Does not print, delete queued jobs, or change printer drivers.
echo Run from the Windows account that installed CUT Agent V2.
echo.

set "CUT_AGENT_DIR=%LOCALAPPDATA%\CUT-Salon\Print-Agent\print-service"
if not exist "%CUT_AGENT_DIR%\node_modules\puppeteer\package.json" goto noagent
where node.exe >nul 2>&1
if errorlevel 1 goto nonode
where npx.cmd >nul 2>&1
if errorlevel 1 goto nonpx
cd /d "%CUT_AGENT_DIR%"
if errorlevel 1 goto noagent

echo [1/3] Checking the required Chromium/Chrome executable...
node.exe -e "const fs=require('node:fs');const p=require('puppeteer');const x=p.executablePath();console.log('Expected browser:',x);process.exit(fs.existsSync(x)?0:2)"
if not errorlevel 1 goto browser_ok
echo.
echo [2/3] Downloading Chrome for Testing (internet required)...
call npx.cmd --no-install puppeteer browsers install chrome
if errorlevel 1 goto download_failed

:browser_ok
echo.
echo [3/3] Checking Chromium is now installed...
node.exe -e "const fs=require('node:fs');const p=require('puppeteer');const x=p.executablePath();if(!fs.existsSync(x)){console.error('MISSING:',x);process.exit(2)}console.log('FOUND:',x)"
if errorlevel 1 goto verify_failed
echo.
echo ================================================================
echo [SUCCESS] Chrome for Testing found for CUT Print Agent.
echo Open Casher and print ONE test slip. Confirm the real paper.
echo ================================================================
goto good

:noagent
echo [ERROR] CUT Agent V2 installation not found for this Windows user:
echo %CUT_AGENT_DIR%
goto bad
:nonode
echo [ERROR] Node.js was not found in PATH.
goto bad
:nonpx
echo [ERROR] npx.cmd was not found. Repair your Node.js installation.
goto bad
:download_failed
echo [ERROR] Chrome download failed. Check internet, proxy and disk space.
goto bad
:verify_failed
echo [ERROR] Chrome installation did not match Puppeteer's required version.
echo Confirm you are using the same Windows account as CUT Agent.
goto bad

:bad
echo.
echo Please photograph this error and send it for support.
echo Press any key to close...
pause >nul
exit /b 1

:good
echo.
echo Press any key to close...
pause >nul
exit /b 0
