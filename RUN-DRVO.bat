@echo off
chcp 65001 >nul
setlocal EnableExtensions

:: ═══════════════════════════════════════════════════════════════════════════
:: DRVO local launcher — fail-closed against production database tests
:: ═══════════════════════════════════════════════════════════════════════════
::
:: Safe defaults:
::   - Starts the app with npm run dev:app
::   - Never sets APPROVED_TEST_DB / INCLUDE_DB_INTEGRATION_TESTS
::   - Refuses known destructive npm scripts unless DRVO_ALLOW_DESTRUCTIVE=1
::     AND the operator confirms the target DB is last132_agent
::
:: Usage:
::   RUN-DRVO.bat              -> start local app (port 5500)
::   RUN-DRVO.bat test         -> unit tests only (integration suites excluded)
::   RUN-DRVO.bat tunnel       -> start VPS SQL tunnel (127.0.0.1:14330)
::   RUN-DRVO.bat help
::

cd /d "%~dp0"

if /i "%~1"=="help" goto help
if /i "%~1"=="tunnel" goto tunnel
if /i "%~1"=="test" goto unit_tests
if /i "%~1"=="integration" goto deny_integration
if /i "%~1"=="seed" goto deny_destructive
if /i "%~1"=="sync:test-data" goto deny_destructive

goto start_app

:start_app
echo [DRVO] Starting app (npm run dev:app). Integration DB tests are NOT enabled.
echo [DRVO] Ensure .env.local points at last132_agent (never last132) for local work.
call npm run dev:app
exit /b %ERRORLEVEL%

:unit_tests
echo [DRVO] Running unit tests only. *.integration.test.ts is excluded by default.
set INCLUDE_DB_INTEGRATION_TESTS=
set APPROVED_TEST_DB=
call npm test
exit /b %ERRORLEVEL%

:tunnel
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\vps-sql-tunnel.ps1" -Action start
exit /b %ERRORLEVEL%

:deny_integration
echo [DRVO] REFUSED: integration/destructive DB tests are not launched by RUN-DRVO.bat.
echo [DRVO] To run them manually you must:
echo          1) Point credentials at last132_agent only
echo          2) set APPROVED_TEST_DB=1
echo          3) set INCLUDE_DB_INTEGRATION_TESTS=1
echo          4) Verify SELECT DB_NAME() returns last132_agent before mutating
echo [DRVO] Production database last132 is hard-denied by assertApprovedTestDatabase.
exit /b 11

:deny_destructive
echo [DRVO] REFUSED: destructive seed/sync test-data commands are blocked here.
echo [DRVO] Use an explicit, reviewed staging workflow against last132_agent only.
exit /b 11

:help
echo RUN-DRVO.bat [app^|test^|tunnel^|help]
echo   (default) app   Start Next.js on port 5500
echo   test            Unit tests only (no DB integration suites)
echo   tunnel          Start 127.0.0.1:14330 SQL tunnel
echo   help            This message
exit /b 0
