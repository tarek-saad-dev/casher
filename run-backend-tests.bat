@echo off
echo ==========================================
echo Cut Salon Backend Tests
echo ==========================================
echo.

REM Check if server is running
echo Checking if server is running on port 3000...
curl -s -o nul -w "%%{http_code}" http://localhost:3000/api/public/booking/available-days?mode=specific&empId=12&serviceIds=1047&fromDate=2026-05-26 > temp_status.txt
set /p STATUS=<temp_status.txt
del temp_status.txt

if "%STATUS%"=="200" (
    echo [OK] Server is running
) else (
    echo [WARNING] Server may not be running. Starting server...
    start "NextJS Server" cmd /c "npm run dev -- --port 3000"
    timeout /t 10 /nobreak > nul
)

echo.
echo ==========================================
echo TEST 1: SQL Schedule Data
echo ==========================================
echo Run this SQL query in your database:
echo.
echo SELECT
echo     ws.EmpID,
echo     e.EmpName,
echo     ws.DayOfWeek,
echo     CASE ws.DayOfWeek
echo         WHEN 0 THEN 'Sunday'
echo         WHEN 1 THEN 'Monday'
echo         WHEN 2 THEN 'Tuesday'
echo         WHEN 3 THEN 'Wednesday'
echo         WHEN 4 THEN 'Thursday'
echo         WHEN 5 THEN 'Friday'
echo         WHEN 6 THEN 'Saturday'
echo     END AS DayName,
echo     ws.IsWorking,
echo     CONVERT(VARCHAR(5), ws.StartTime, 108) AS StartTime,
echo     CONVERT(VARCHAR(5), ws.EndTime, 108) AS EndTime
echo FROM TblEmpWorkSchedule ws
echo JOIN TblEmp e ON e.EmpID = ws.EmpID
echo WHERE e.EmpName IN (N'أحمد', N'ذياد', N'كريم', N'عمر')
echo ORDER BY e.EmpName, ws.DayOfWeek;
echo.
pause

echo.
echo ==========================================
echo TEST 2: available-days API
echo ==========================================

echo.
echo --- Test 2A: أحمد - Tuesday (2026-05-26) ---
curl -s "http://localhost:3000/api/public/booking/available-days?mode=specific&empId=12&serviceIds=1047&fromDate=2026-05-26" > test_ahmed.json
type test_ahmed.json
echo.

echo --- Test 2B: ذياد - Friday (2026-05-29) ---
curl -s "http://localhost:3000/api/public/booking/available-days?mode=specific&empId=13&serviceIds=1047&fromDate=2026-05-29" > test_zeyad.json
type test_zeyad.json
echo.

echo --- Test 2C: كريم - Sunday (2026-05-24) ---
curl -s "http://localhost:3000/api/public/booking/available-days?mode=specific&empId=14&serviceIds=1047&fromDate=2026-05-24" > test_karim.json
type test_karim.json
echo.

echo --- Test 2D: عمر - Monday (2026-05-25) ---
curl -s "http://localhost:3000/api/public/booking/available-days?mode=specific&empId=15&serviceIds=1047&fromDate=2026-05-25" > test_omar.json
type test_omar.json
echo.

echo.
echo ==========================================
echo TEST 3: available-slots API
echo ==========================================

echo --- Test 3A: Working Day (أحمد - Tuesday) ---
curl -s "http://localhost:3000/api/public/booking/available-slots?date=2026-05-26&mode=specific&empId=12&serviceIds=1047" > test_slots_working.json
echo Response saved to test_slots_working.json
type test_slots_working.json | findstr /C:"available" | head -5
echo.

echo --- Test 3B: Day Off (ذياد - Friday) ---
curl -s "http://localhost:3000/api/public/booking/available-slots?date=2026-05-29&mode=specific&empId=13&serviceIds=1047" > test_slots_dayoff.json
echo Response saved to test_slots_dayoff.json
type test_slots_dayoff.json
echo.

echo.
echo ==========================================
echo TEST 4: Validation (Date Format)
echo ==========================================

echo --- Test 4A: ISO Date (should be rejected) ---
curl -s -w "HTTP Status: %%{http_code}\n" "http://localhost:3000/api/public/booking/available-slots?date=2026-05-24T00:00:00.000Z&mode=specific&empId=12&serviceIds=1047"
echo Expected: 400 Bad Request
echo.

echo --- Test 4B: YYYY-MM-DD (should be accepted) ---
curl -s -w "HTTP Status: %%{http_code}\n" "http://localhost:3000/api/public/booking/available-slots?date=2026-05-24&mode=specific&empId=12&serviceIds=1047"
echo Expected: 200 OK
echo.

echo.
echo ==========================================
echo TEST 5: Bookings/Estimate
echo ==========================================

echo --- Test 5A: Valid date/time ---
curl -s -X POST "http://localhost:3000/api/bookings/estimate" ^
  -H "Content-Type: application/json" ^
  -d "{\"mode\":\"specific\",\"empId\":12,\"serviceIds\":[1047],\"bookingDate\":\"2026-05-26\",\"bookingTime\":\"14:00\"}"
echo.

echo --- Test 5B: Invalid ISO date (should be rejected) ---
curl -s -w "HTTP Status: %%{http_code}\n" -X POST "http://localhost:3000/api/bookings/estimate" ^
  -H "Content-Type: application/json" ^
  -d "{\"mode\":\"specific\",\"empId\":12,\"serviceIds\":[1047],\"bookingDate\":\"2026-05-26T00:00:00.000Z\",\"bookingTime\":\"14:00\"}"
echo Expected: 400 Bad Request
echo.

echo.
echo ==========================================
echo TEST 6: Check Server Logs
echo ==========================================
echo Look for these log entries in the server console:
echo - [available-days] DAY_VERIFICATION_LOG
echo - [buildScheduleMap] Emp X: DB Day Y = JS Day Y (no conversion)
echo.

echo.
echo ==========================================
echo Tests Complete!
echo ==========================================
echo.
echo Check the JSON files created:
echo - test_ahmed.json
echo - test_zeyad.json
echo - test_karim.json
echo - test_omar.json
echo - test_slots_working.json
echo - test_slots_dayoff.json
echo.
pause
