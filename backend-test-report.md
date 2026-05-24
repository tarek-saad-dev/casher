# Backend Test Report - Cut Salon Booking API

## Test Date: $(Get-Date)

---

## 1. SQL Data Verification

### Query to run in SQL Server:

```sql
SELECT
    ws.EmpID,
    e.EmpName,
    ws.DayOfWeek,
    CASE ws.DayOfWeek
        WHEN 0 THEN 'Sunday'
        WHEN 1 THEN 'Monday'
        WHEN 2 THEN 'Tuesday'
        WHEN 3 THEN 'Wednesday'
        WHEN 4 THEN 'Thursday'
        WHEN 5 THEN 'Friday'
        WHEN 6 THEN 'Saturday'
    END AS DayName,
    ws.IsWorking,
    CONVERT(VARCHAR(5), ws.StartTime, 108) AS StartTime,
    CONVERT(VARCHAR(5), ws.EndTime, 108) AS EndTime,
    ws.BreakStartTime,
    ws.BreakEndTime,
    ws.Notes
FROM TblEmpWorkSchedule ws
JOIN TblEmp e ON e.EmpID = ws.EmpID
WHERE e.EmpName IN (N'أحمد', N'ذياد', N'كريم', N'عمر')
ORDER BY e.EmpName, ws.DayOfWeek;
```

### Expected Results:

| EmpName | DayOfWeek | DayName  | IsWorking | StartTime | EndTime |
|---------|-----------|----------|-----------|-----------|---------|
| أحمد    | 2         | Tuesday  | 1         | ??:??     | ??:??   |
| ذياد    | 4         | Thursday | 1         | ??:??     | ??:??   |
| ذياد    | 5         | Friday   | 0         | -         | -       |
| كريم    | 0         | Sunday   | 0         | -         | -       |
| عمر     | 1         | Monday   | 0         | -         | -       |

---

## 2. API Tests

### 2.1 Available-Days Test Script (PowerShell)

```powershell
# Base URL
$baseUrl = "http://localhost:3000"

# Test for each barber
$barbers = @(
    @{ id = 12; name = "أحمد"; expectedWorkingDay = 2 },  # Tuesday
    @{ id = 13; name = "ذياد"; expectedDayOff = 5 },      # Friday
    @{ id = 14; name = "كريم"; expectedDayOff = 0 },      # Sunday
    @{ id = 15; name = "عمر"; expectedDayOff = 1 }        # Monday
)

foreach ($barber in $barbers) {
    Write-Host "`n=== Testing $($barber.name) (ID: $($barber.id)) ===" -ForegroundColor Cyan
    
    $url = "$baseUrl/api/public/booking/available-days?mode=specific&empId=$($barber.id)&serviceIds=1047&fromDate=2026-05-01"
    Write-Host "URL: $url" -ForegroundColor Gray
    
    try {
        $response = Invoke-RestMethod -Uri $url -Method GET
        Write-Host "Response:" -ForegroundColor Green
        $response | ConvertTo-Json -Depth 3
        
        # Verify days
        foreach ($day in $response.days) {
            $date = [datetime]$day.date
            $dayOfWeek = [int]$date.DayOfWeek  # 0=Sunday
            
            Write-Host "  Date: $($day.date) (DayOfWeek: $dayOfWeek) - Available: $($day.available)" -ForegroundColor $(if ($day.available) { "Green" } else { "Red" })
        }
    } catch {
        Write-Host "Error: $_" -ForegroundColor Red
    }
}
```

### 2.2 Available-Slots Tests

```powershell
# Test available-slots for working day (Tuesday 2026-05-26 for أحمد)
Write-Host "`n=== Test: أحمد on Tuesday (2026-05-26) - Should have slots ===" -ForegroundColor Cyan
$url = "$baseUrl/api/public/booking/available-slots?date=2026-05-26&mode=specific&empId=12&serviceIds=1047"
$response = Invoke-RestMethod -Uri $url -Method GET
Write-Host "Slots count: $($response.slots.Length)"
$availableSlots = $response.slots | Where-Object { $_.available -eq $true }
Write-Host "Available slots: $($availableSlots.Length)" -ForegroundColor Green

# Test available-slots for day off (Friday 2026-05-29 for ذياد)
Write-Host "`n=== Test: ذياد on Friday (2026-05-29) - Should be day off ===" -ForegroundColor Cyan
$url = "$baseUrl/api/public/booking/available-slots?date=2026-05-29&mode=specific&empId=13&serviceIds=1047"
$response = Invoke-RestMethod -Uri $url -Method GET
Write-Host "Response:" -ForegroundColor Yellow
$response | ConvertTo-Json -Depth 3
```

### 2.3 Overnight Shift Tests

```powershell
# Test overnight shift (if barber works 14:00-04:00)
Write-Host "`n=== Test: Overnight Shift ===" -ForegroundColor Cyan

# 23:30 should be inside overnight shift
$url = "$baseUrl/api/public/booking/available-slots?date=2026-05-26&mode=specific&empId=12&serviceIds=1047"
$response = Invoke-RestMethod -Uri $url -Method GET
$slot2330 = $response.slots | Where-Object { $_.time -eq "23:30" }
if ($slot2330) {
    Write-Host "23:30 - Available: $($slot2330.available)" -ForegroundColor $(if ($slot2330.available) { "Green" } else { "Red" })
}

# 00:30 should be inside overnight shift (post-midnight)
$slot0030 = $response.slots | Where-Object { $_.time -eq "00:30" }
if ($slot0030) {
    Write-Host "00:30 (day+1) - Available: $($slot0030.available), dayOffset: $($slot0030.dayOffset)" -ForegroundColor $(if ($slot0030.available) { "Green" } else { "Red" })
}

# 04:30 should be outside overnight shift
$slot0430 = $response.slots | Where-Object { $_.time -eq "04:30" }
if ($slot0430) {
    Write-Host "04:30 - Available: $($slot0430.available) (should be false if shift ends 04:00)" -ForegroundColor $(if (-not $slot0430.available) { "Green" } else { "Yellow" })
}
```

### 2.4 Validation Tests (Date Format)

```powershell
Write-Host "`n=== Test: Validation - Reject ISO Date Format ===" -ForegroundColor Cyan

# Should be REJECTED (400 Bad Request)
$invalidUrls = @(
    "$baseUrl/api/public/booking/available-slots?date=2026-05-24T00:00:00.000Z&mode=specific&empId=12&serviceIds=1047",
    "$baseUrl/api/public/booking/available-slots?date=2026-05-24Z&mode=specific&empId=12&serviceIds=1047",
    "$baseUrl/api/public/booking/available-slots?date=2026-05-24T12:00:00&mode=specific&empId=12&serviceIds=1047"
)

foreach ($url in $invalidUrls) {
    Write-Host "Testing: $url" -ForegroundColor Gray
    try {
        $response = Invoke-RestMethod -Uri $url -Method GET
        Write-Host "  ERROR: Should have been rejected!" -ForegroundColor Red
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 400) {
            Write-Host "  ✓ Correctly rejected with 400" -ForegroundColor Green
        } else {
            Write-Host "  ✗ Wrong status code: $statusCode" -ForegroundColor Yellow
        }
    }
}

# Should be ACCEPTED
Write-Host "`n=== Test: Validation - Accept YYYY-MM-DD Format ===" -ForegroundColor Cyan
$validUrl = "$baseUrl/api/public/booking/available-slots?date=2026-05-24&mode=specific&empId=12&serviceIds=1047"
try {
    $response = Invoke-RestMethod -Uri $validUrl -Method GET
    Write-Host "  ✓ Correctly accepted" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Should have been accepted! Error: $_" -ForegroundColor Red
}
```

---

## 3. Verification Checklist

### DayOfWeek Mapping Verification:

| Date | DayOfWeek (JS) | DayName | Expected Barber | Expected Available |
|------|----------------|---------|-----------------|------------------|
| 2026-05-24 | 0 | Sunday | كريم | ❌ Day Off |
| 2026-05-25 | 1 | Monday | عمر | ❌ Day Off |
| 2026-05-26 | 2 | Tuesday | أحمد | ✅ Working |
| 2026-05-27 | 3 | Wednesday | - | - |
| 2026-05-28 | 4 | Thursday | ذياد | ✅ Working |
| 2026-05-29 | 5 | Friday | ذياد | ❌ Day Off |
| 2026-05-30 | 6 | Saturday | - | - |

### Console Log Verification:

Look for logs like this in server console:
```
[available-days] DAY_VERIFICATION_LOG {
  empId: 12,
  empName: 'أحمد',
  date: '2026-05-26',
  computedDayOfWeek: 2,
  dayName: 'الثلاثاء',
  scheduleRowFound: true,
  dbDayOfWeek: 2,
  isWorking: true,
  startTime: '10:00',
  endTime: '22:00',
  available: true,
  ...
}
```

**Key verification points:**
- ✅ `computedDayOfWeek` equals `dbDayOfWeek`
- ✅ No conversion happening (both should be same value)
- ✅ `dayName` matches Arabic day name
- ✅ `available` matches `isWorking`

---

## 4. Expected API Response Format

### available-days (specific mode):
```json
{
  "ok": true,
  "mode": "specific",
  "empId": 12,
  "days": [
    {
      "date": "2026-05-26",
      "available": true,
      "label": "الثلاثاء"
    },
    {
      "date": "2026-05-27",
      "available": false,
      "label": "الأربعاء",
      "reason": "إجازة أسبوعية",
      "reasonCode": "NO_WORKING_SCHEDULE"
    }
  ]
}
```

### available-slots (specific mode, working day):
```json
{
  "ok": true,
  "mode": "specific",
  "empId": 12,
  "date": "2026-05-26",
  "slots": [
    {
      "time": "10:00",
      "label": "10:00 ص",
      "available": true,
      "dayOffset": 0,
      "empId": 12,
      "barberName": "أحمد"
    },
    {
      "time": "10:15",
      "label": "10:15 ص",
      "available": false,
      "dayOffset": 0,
      "reason": "الوقت محجوز"
    }
  ]
}
```

### available-slots (day off):
```json
{
  "ok": true,
  "mode": "specific",
  "empId": 13,
  "date": "2026-05-29",
  "slots": [],
  "barberAvailability": {
    "available": false,
    "reason": "إجازة أسبوعية",
    "conflictType": "day_off"
  }
}
```

---

## 5. Run Tests

### Option A: Run all tests at once
```powershell
# Save this as test-backend.ps1 and run:
.\test-backend.ps1
```

### Option B: Manual curl commands
```bash
# Test each barber
curl "http://localhost:3000/api/public/booking/available-days?mode=specific&empId=12&serviceIds=1047&fromDate=2026-05-01"

curl "http://localhost:3000/api/public/booking/available-days?mode=specific&empId=13&serviceIds=1047&fromDate=2026-05-01"

curl "http://localhost:3000/api/public/booking/available-days?mode=specific&empId=14&serviceIds=1047&fromDate=2026-05-01"

curl "http://localhost:3000/api/public/booking/available-days?mode=specific&empId=15&serviceIds=1047&fromDate=2026-05-01"
```

### Option C: Check server logs
Watch the server console for `[available-days] DAY_VERIFICATION_LOG` entries.

---

## 6. Success Criteria

✅ **PASS** if:
1. `computedDayOfWeek` equals `dbDayOfWeek` for ALL days
2. `available` matches `isWorking` for ALL days
3. أحمد has `available: true` on Tuesday (2026-05-26)
4. ذياد has `available: false` on Friday (2026-05-29)
5. كريم has `available: false` on Sunday (2026-05-24)
6. عمر has `available: false` on Monday (2026-05-25)
7. ISO date format (with T/Z) returns 400 Bad Request
8. YYYY-MM-DD format returns 200 OK
9. Overnight slots show correct `dayOffset` (0 for same day, 1 for next day)

❌ **FAIL** if:
1. Any `computedDayOfWeek` ≠ `dbDayOfWeek`
2. Working days show as unavailable
3. Day off days show as available
4. Wrong DayOfWeek values (e.g., Sunday showing as day 6 instead of 0)

---

**Report Generated:** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
