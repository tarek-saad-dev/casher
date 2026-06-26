@echo off
cd /d "d:\Under work now\2025\Programming\Projects\projects\casher"
npx tsc --noEmit > tsc_output.txt 2>&1
echo Exit code: %ERRORLEVEL%
type tsc_output.txt
