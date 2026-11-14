@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
color 1F
title CUT SALON - Print Agent V2 Install / Repair

echo ============================================================
echo       CUT SALON - PRINT AGENT V2 - INSTALL / REPAIR
echo ============================================================
echo.
echo This installs or repairs the local printer service.
echo It will NOT print an invoice or change Windows security settings.
echo Run from the Windows user account used for the cashier.
echo.

set "CUT_INSTALL_SCRIPT=%TEMP%\CUT_Salon_Print_Agent_V2_Official_Installer.ps1"
set "CUT_INSTALL_URL=https://raw.githubusercontent.com/tarek-saad-dev/casher/19e77fc4041fca67434bc57bd5886a6873e0a753/public/downloads/Install-CUT-Print-Agent.ps1"

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Windows PowerShell is not available.
  goto :finish_error
)

echo [1/3] Downloading the official V2 installer from CUT Salon GitHub...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $env:CUT_INSTALL_URL -OutFile $env:CUT_INSTALL_SCRIPT; if ((Get-Item -LiteralPath $env:CUT_INSTALL_SCRIPT).Length -lt 5000) { throw 'Installer download was incomplete.' }; if (-not (Select-String -LiteralPath $env:CUT_INSTALL_SCRIPT -Pattern 'CUT Salon Print Agent V2' -SimpleMatch -Quiet)) { throw 'Unexpected installer content.' }; Write-Host 'Download successful.' -ForegroundColor Green"
if errorlevel 1 (
  echo.
  echo [ERROR] Unable to download the official installer.
  echo Check the internet connection and try again.
  goto :finish_error
)

echo.
echo [2/3] Running installer / repair...
echo This may install Node dependencies and register the Windows startup task.
echo Please read any message displayed below.
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%CUT_INSTALL_SCRIPT%"
if errorlevel 1 (
  echo.
  echo [ERROR] Installation did not complete.
  echo The details above show what needs attention, such as Node.js,
  echo Windows printer name, or an existing printer service.
  echo Do not repeatedly print existing invoices while diagnosing.
  goto :finish_error
)

echo.
echo [3/3] Checking the new local agent version...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $health=Invoke-RestMethod -Uri 'http://127.0.0.1:7788/health' -TimeoutSec 5; if ([string]$health.version -ne '2.0.0') { throw ('Agent responded, but version is ' + $health.version + ' instead of 2.0.0') }; Write-Host ('Agent V' + $health.version + ' is running. Printer: ' + $health.printer) -ForegroundColor Green"
if errorlevel 1 (
  echo.
  echo [ERROR] Could not verify Agent V2 on this PC.
  echo Please capture the messages above for support.
  goto :finish_error
)

echo.
echo ============================================================
echo [SUCCESS] CUT Print Agent V2 is responding on this Windows PC.
echo Open https://ops.cutsaloon.com/admin/settings/printing
echo Then run ONE test print and confirm that the paper actually comes out.
echo ============================================================
goto :finish_ok

:finish_error
echo.
echo The window will remain open so you can photograph the error.
echo Take a photo of the full messages above and send it to support.
echo.
echo Press any key to close...
pause >nul
exit /b 1

:finish_ok
echo.
echo Press any key to close...
pause >nul
exit /b 0
