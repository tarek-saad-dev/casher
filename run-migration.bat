@echo off
title Run Treasury Migration
color 0B

echo ============================================================
echo     Treasury Database Migration
echo ============================================================
echo.
echo Creating TblTreasuryCloseRecon table...
echo.

sqlcmd -S DESKTOP-EUN2CV2 -d HawaiDB -U it -P 123 -i db\migrations\create-tbl-treasury-close-recon.sql

if errorlevel 1 (
    color 0C
    echo.
    echo [ERROR] Migration failed!
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo [SUCCESS] Migration completed successfully!
echo ============================================================
echo.
pause
