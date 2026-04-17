@echo off
setlocal enabledelayedexpansion

echo ╔═════════════════════════════════════════════════════════════════════════════╗
echo ║              CREATE DESKTOP SHORTCUT - POS SYSTEM                           ║
echo ╚═════════════════════════════════════════════════════════════════════════════╝
echo.

:: Get current directory
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

:: Create VBScript to make shortcut
set "VBSC=%TEMP%\CreateShortcut.vbs"

echo Set WshShell = CreateObject("WScript.Shell") > "%VBSC%"
echo strDesktop = WshShell.SpecialFolders("Desktop") >> "%VBSC%"
echo Set oShortcut = WshShell.CreateShortcut(strDesktop ^& "\POS System.lnk") >> "%VBSC%"
echo oShortcut.TargetPath = "%SCRIPT_DIR%\quick-start.bat" >> "%VBSC%"
echo oShortcut.WorkingDirectory = "%SCRIPT_DIR%" >> "%VBSC%"
echo oShortcut.IconLocation = "%SCRIPT_DIR%\icon.ico, 0" >> "%VBSC%"
echo oShortcut.Description = "POS System - Salon Management" >> "%VBSC%"
echo oShortcut.Save >> "%VBSC%"

:: Run the VBScript
cscript //nologo "%VBSC%"

:: Clean up
del "%VBSC%"

echo [SUCCESS] Desktop shortcut created!
echo Shortcut name: "POS System" on your desktop
echo.
echo You can now double-click the desktop shortcut to start the POS system.
echo.
pause
