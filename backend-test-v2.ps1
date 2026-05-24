# Backend Test Script v2 - Cut Salon API
# Generates: backend-test-results.md
# Encoding: UTF-8 without BOM (English only to avoid encoding issues)

param(
    [string]$BaseUrl = ""
)

# Try multiple ports if not specified
$portsToTry = @(5500, 3000, 3001, 8080)
$testResults = @()
$scheduleData = $null

function Test-Port {
    param([string]$url)
    try {
        $response = Invoke-RestMethod -Uri "$url/api/debug/booking-schedule-check" -Method GET -TimeoutSec 5 -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Write-Log {
    param([string]$message, [string]$level = "INFO")
    $timestamp = Get-Date -Format "HH:mm:ss"
    $logLine = "[$timestamp] [$level] $message"
    Write-Host $logLine
    return $logLine
}

function Write-Result {
    param([string]$test, [string]$status, [string]$details = "")
    $result = [PSCustomObject]@{
        Test = $test
        Status = $status
        Details = $details
        Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    }
    return $result
}

# ============================================================
# STEP 1: Find working server
# ============================================================
Write-Log "Finding available server..."

$workingUrl = $null
if ($BaseUrl -ne "") {
    if (Test-Port -url $BaseUrl) {
        $workingUrl = $BaseUrl
    }
}

if (-not $workingUrl) {
    foreach ($port in $portsToTry) {
        $url = "http://localhost:$port"
        Write-Log "Trying port $port..."
        if (Test-Port -url $url) {
            $workingUrl = $url
            Write-Log "Found working server at $workingUrl" "SUCCESS"
            break
        }
    }
}

if (-not $workingUrl) {
    Write-Log "ERROR: No working server found on any port!" "ERROR"
    Write-Log "Please run: npm run dev" "INFO"
    exit 1
}

# ============================================================
# STEP 2: Get Schedule Data from Debug Endpoint
# ============================================================
Write-Log "Fetching schedule data from debug endpoint..."

try {
    $scheduleResponse = Invoke-RestMethod -Uri "$workingUrl/api/debug/booking-schedule-check" -Method GET -ErrorAction Stop
    if ($scheduleResponse.ok) {
        $scheduleData = $scheduleResponse.data
        Write-Log "Schedule data loaded for $($scheduleData.Count) barbers" "SUCCESS"
    } else {
        Write-Log "Debug endpoint returned error: $($scheduleResponse.error)" "WARNING"
    }
} catch {
    Write-Log "Failed to get schedule data: $_" "WARNING"
}

# ============================================================
# STEP 3: Test available-days endpoint
# ============================================================
Write-Log "Testing available-days endpoint..."

$testCases = @(
    @{ 
        Name = "Ahmed - Tuesday (Working Day)"
        EmpId = 12
        EmpName = "Ahmed"
        Date = "2026-05-26"
        ExpectedDayOfWeek = 2
        ExpectedAvailable = $true
    }
    @{
        Name = "Zeyad - Friday (Day Off)"
        EmpId = 13
        EmpName = "Zeyad"
        Date = "2026-05-29"
        ExpectedDayOfWeek = 5
        ExpectedAvailable = $false
    }
    @{
        Name = "Karim - Sunday (Day Off)"
        EmpId = 14
        EmpName = "Karim"
        Date = "2026-05-24"
        ExpectedDayOfWeek = 0
        ExpectedAvailable = $false
    }
    @{
        Name = "Omar - Monday (Day Off)"
        EmpId = 15
        EmpName = "Omar"
        Date = "2026-05-25"
        ExpectedDayOfWeek = 1
        ExpectedAvailable = $false
    }
)

$availableDaysResults = @()

foreach ($test in $testCases) {
    Write-Log "Testing: $($test.Name)..."
    
    try {
        $url = "$workingUrl/api/public/booking/available-days?mode=specific&empId=$($test.EmpId)&serviceIds=1047&fromDate=$($test.Date)"
        $response = Invoke-RestMethod -Uri $url -Method GET -ErrorAction Stop
        
        if (-not $response.ok) {
            $result = Write-Result -test $test.Name -status "FAIL" -details "API returned ok=false"
            $availableDaysResults += $result
            continue
        }
        
        # Find the specific day
        $dayData = $response.days | Where-Object { $_.date -eq $test.Date } | Select-Object -First 1
        
        if (-not $dayData) {
            $result = Write-Result -test $test.Name -status "FAIL" -details "Date $($test.Date) not found in response"
            $availableDaysResults += $result
            continue
        }
        
        # Calculate actual day of week
        $actualDate = [datetime]::ParseExact($test.Date, "yyyy-MM-dd", $null)
        $actualDayOfWeek = [int]$actualDate.DayOfWeek
        
        $details = @"
Date: $($test.Date)
Computed DayOfWeek: $actualDayOfWeek (Expected: $($test.ExpectedDayOfWeek))
API Available: $($dayData.available) (Expected: $($test.ExpectedAvailable))
API Label: $($dayData.label)
API Reason: $($dayData.reason)
"@
        
        # Check if day of week matches
        $dayOfWeekMatch = ($actualDayOfWeek -eq $test.ExpectedDayOfWeek)
        $availabilityMatch = ($dayData.available -eq $test.ExpectedAvailable)
        
        if ($dayOfWeekMatch -and $availabilityMatch) {
            $result = Write-Result -test $test.Name -status "PASS" -details $details
        } else {
            $failReason = ""
            if (-not $dayOfWeekMatch) {
                $failReason += "DayOfWeek mismatch. "
            }
            if (-not $availabilityMatch) {
                $failReason += "Availability mismatch (got: $($dayData.available), expected: $($test.ExpectedAvailable)). "
            }
            $result = Write-Result -test $test.Name -status "FAIL" -details "$failReason`n$details"
        }
        
        $availableDaysResults += $result
        
    } catch {
        $result = Write-Result -test $test.Name -status "FAIL" -details "Error: $_"
        $availableDaysResults += $result
    }
}

# ============================================================
# STEP 4: Test available-slots endpoint
# ============================================================
Write-Log "Testing available-slots endpoint..."

$slotsResults = @()

# Test 4A: Working day should have slots
try {
    Write-Log "Testing available-slots for working day (Ahmed Tuesday)..."
    $url = "$workingUrl/api/public/booking/available-slots?date=2026-05-26&mode=specific&empId=12&serviceIds=1047"
    $response = Invoke-RestMethod -Uri $url -Method GET -ErrorAction Stop
    
    if ($response.ok -and $response.slots.Count -gt 0) {
        $availableSlots = ($response.slots | Where-Object { $_.available -eq $true }).Count
        $details = "Total slots: $($response.slots.Count), Available: $availableSlots"
        $result = Write-Result -test "available-slots Working Day" -status "PASS" -details $details
    } else {
        $result = Write-Result -test "available-slots Working Day" -status "FAIL" -details "No slots returned or API error"
    }
} catch {
    $result = Write-Result -test "available-slots Working Day" -status "FAIL" -details "Error: $_"
}
$slotsResults += $result

# Test 4B: Day off should have no available slots
try {
    Write-Log "Testing available-slots for day off (Zeyad Friday)..."
    $url = "$workingUrl/api/public/booking/available-slots?date=2026-05-29&mode=specific&empId=13&serviceIds=1047"
    $response = Invoke-RestMethod -Uri $url -Method GET -ErrorAction Stop
    
    $availableSlots = ($response.slots | Where-Object { $_.available -eq $true }).Count
    
    if ($availableSlots -eq 0) {
        $details = "No available slots (correct for day off). Barber availability: $($response.barberAvailability.available)"
        $result = Write-Result -test "available-slots Day Off" -status "PASS" -details $details
    } else {
        $result = Write-Result -test "available-slots Day Off" -status "FAIL" -details "Found $availableSlots available slots on day off!"
    }
} catch {
    $result = Write-Result -test "available-slots Day Off" -status "FAIL" -details "Error: $_"
}
$slotsResults += $result

# ============================================================
# STEP 5: Test Date Format Validation
# ============================================================
Write-Log "Testing date format validation..."

$validationResults = @()

# Test 5A: ISO date with T/Z should be rejected
try {
    Write-Log "Testing: ISO date format (should be rejected)..."
    $url = "$workingUrl/api/public/booking/available-slots?date=2026-05-24T00:00:00.000Z&mode=specific&empId=12&serviceIds=1047"
    
    try {
        $response = Invoke-RestMethod -Uri $url -Method GET -ErrorAction Stop
        $result = Write-Result -test "Validation: ISO date rejected" -status "FAIL" -details "Should return 400 but got success"
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 400) {
            $result = Write-Result -test "Validation: ISO date rejected" -status "PASS" -details "Correctly rejected with 400"
        } else {
            $result = Write-Result -test "Validation: ISO date rejected" -status "FAIL" -details "Wrong status code: $statusCode"
        }
    }
} catch {
    $result = Write-Result -test "Validation: ISO date rejected" -status "ERROR" -details "Unexpected error: $_"
}
$validationResults += $result

# Test 5B: YYYY-MM-DD should be accepted
try {
    Write-Log "Testing: YYYY-MM-DD format (should be accepted)..."
    $url = "$workingUrl/api/public/booking/available-slots?date=2026-05-24&mode=specific&empId=12&serviceIds=1047"
    
    try {
        $response = Invoke-RestMethod -Uri $url -Method GET -ErrorAction Stop
        if ($response.ok) {
            $result = Write-Result -test "Validation: YYYY-MM-DD accepted" -status "PASS" -details "Correctly accepted with 200"
        } else {
            $result = Write-Result -test "Validation: YYYY-MM-DD accepted" -status "FAIL" -details "API returned ok=false"
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        $result = Write-Result -test "Validation: YYYY-MM-DD accepted" -status "FAIL" -details "Should return 200 but got $statusCode"
    }
} catch {
    $result = Write-Result -test "Validation: YYYY-MM-DD accepted" -status "ERROR" -details "Unexpected error: $_"
}
$validationResults += $result

# ============================================================
# STEP 6: Generate Report
# ============================================================
Write-Log "Generating report..."

$report = @"
# Backend Test Results - Cut Salon API

**Test Date:** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")  
**Server URL:** $workingUrl  
**Environment:** $(if ($scheduleData) { $scheduleData[0].environment } else { "Unknown" })

---

## SCHEDULE DB RESULT

"@

# Add schedule data if available
if ($scheduleData) {
    foreach ($emp in $scheduleData) {
        $report += "`n### $($emp.empName) (ID: $($emp.empId))`n`n"
        $report += "| DayOfWeek | DayName | IsWorking | StartTime | EndTime |`n"
        $report += "|-----------|---------|-----------|-----------|---------|`n"
        
        foreach ($day in $emp.schedule) {
            $report += "| $($day.dayOfWeek) | $($day.dayName) | $($day.isWorking) | $($day.startTime) | $($day.endTime) |`n"
        }
    }
} else {
    $report += "`n**Schedule data unavailable** - Debug endpoint not accessible`n"
}

$report += @"

---

## AVAILABLE-DAYS TEST

| Test | Status | Details |
|------|--------|---------|
"@

foreach ($result in $availableDaysResults) {
    $statusEmoji = if ($result.Status -eq "PASS") { "✅" } else { "❌" }
    $detailsEscaped = ($result.Details -replace "`n", "<br>" -replace "\|", "\|")
    $report += "| $($result.Test) | $statusEmoji $($result.Status) | $detailsEscaped |`n"
}

$report += @"

---

## AVAILABLE-SLOTS TEST

| Test | Status | Details |
|------|--------|---------|
"@

foreach ($result in $slotsResults) {
    $statusEmoji = if ($result.Status -eq "PASS") { "✅" } else { "❌" }
    $report += "| $($result.Test) | $statusEmoji $($result.Status) | $($result.Details) |`n"
}

$report += @"

---

## VALIDATION TEST

| Test | Status | Details |
|------|--------|---------|
"@

foreach ($result in $validationResults) {
    $statusEmoji = if ($result.Status -eq "PASS") { "✅" } else { "❌" }
    $report += "| $($result.Test) | $statusEmoji $($result.Status) | $($result.Details) |`n"
}

# Calculate final result
$allResults = $availableDaysResults + $slotsResults + $validationResults
$passedCount = ($allResults | Where-Object { $_.Status -eq "PASS" }).Count
$totalCount = $allResults.Count

$finalStatus = if ($passedCount -eq $totalCount) { 
    "Backend OK 100%" 
} else { 
    "Backend has issues - $passedCount/$totalCount tests passed" 
}

$report += @"

---

## SUMMARY

**Total Tests:** $totalCount  
**Passed:** $passedCount  
**Failed:** $($totalCount - $passedCount)

---

## FINAL RESULT

### $finalStatus

"@

# Add failure analysis if any tests failed
$failedTests = $allResults | Where-Object { $_.Status -ne "PASS" }
if ($failedTests) {
    $report += "`n### Failed Tests Analysis:`n`n"
    foreach ($fail in $failedTests) {
        $report += "- **$($fail.Test)**: $($fail.Details)`n"
    }
    
    $report += "`n### Possible Issues:`n`n"
    
    # Check for specific patterns
    $dayOfWeekFailures = $failedTests | Where-Object { $_.Details -like "*DayOfWeek*" }
    if ($dayOfWeekFailures) {
        $report += "- **DayOfWeek Mapping**: Computed DayOfWeek does not match expected value. Check buildScheduleMap function.`n"
    }
    
    $availabilityFailures = $failedTests | Where-Object { $_.Details -like "*Availability*" }
    if ($availabilityFailures) {
        $report += "- **Availability Logic**: Days showing wrong availability. Check TblEmpWorkSchedule data and IsWorkingDay logic.`n"
    }
    
    $validationFailures = $failedTests | Where-Object { $_.Test -like "*Validation*" }
    if ($validationFailures) {
        $report += "- **Date Validation**: Date format validation not working correctly. Check isValidDate function.`n"
    }
}

# Save report
$reportPath = Join-Path $PSScriptRoot "backend-test-results.md"
$report | Out-File -FilePath $reportPath -Encoding UTF8

Write-Log "Report saved to: $reportPath" "SUCCESS"
Write-Log ""
Write-Log "========================================" "INFO"
Write-Log "TEST COMPLETE" "SUCCESS"
Write-Log "========================================" "INFO"
Write-Log "Results: $passedCount/$totalCount passed" $(if ($passedCount -eq $totalCount) { "SUCCESS" } else { "WARNING" })
Write-Log ""
Write-Log "Open backend-test-results.md to view full report" "INFO"

# Print summary to console
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "BACKEND TEST SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Server: $workingUrl" -ForegroundColor Gray
Write-Host "Tests Run: $totalCount" -ForegroundColor White
Write-Host "Passed: $passedCount" -ForegroundColor Green
Write-Host "Failed: $($totalCount - $passedCount)" $(if ($failedTests) { "-ForegroundColor Red" } else { "-ForegroundColor Green" })
Write-Host ""
Write-Host "Final Result: $finalStatus" $(if ($passedCount -eq $totalCount) { "-ForegroundColor Green" } else { "-ForegroundColor Red" })
Write-Host ""
Write-Host "Full report saved to: backend-test-results.md" -ForegroundColor Cyan
Write-Host ""
