@echo off
npx tsc --noEmit > tsc_errors.txt 2>&1
type tsc_errors.txt
