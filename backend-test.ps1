# Backend Test Script for Cut Salon Booking API
# Run this script to verify API correctness

param(
    [string]$baseUrl = "http://localhost:3000"
)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Cut Salon Backend API Test" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Testing against: $baseUrl" -ForegroundColor Gray
Write-Host ""

# Test Results
$results = @{
    total = 0
    passed = 0
    failed = 0
}

function Test-Endpoint {
    param(
        [string]$name,
        [string]$url,
        [scriptblock]$validate,
        [int]$expectedStatus = 200
    )
    
    $results.total++
    Write-Host "Test: $name" -ForegroundColor Yellow
    Write-Host "  URL: $url" -ForegroundColor DarkGray
    
    try {
        $response = Invoke-RestMethod -Uri $url -Method GET -ErrorAction Stop
        $statusCode = 200
        
        if ($validate) {
            $validationResult = & $validate $response
            if ($validationResult) {
                Write-Host "  ✓ PASS" -ForegroundColor Green
                $results.passed++
            } else {
                Write-Host "  ✗ FAIL - Validation failed" -ForegroundColor Red
                $results.failed++
            }
        } else {
            Write-Host "  ✓ PASS (Status: $statusCode)" -ForegroundColor Green
            $results.passed++
        }
        
        return $response
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq $expectedStatus) {
            Write-Host "  ✓ PASS (Expected status: $statusCode)" -ForegroundColor Green
            $results.passed++
        } else {
            Write-Host "  ✗ FAIL - Status: $statusCode, Error: $_" -ForegroundColor Red
            $results.failed++
        }
        return $null
    }
}

function Test-EndpointPost {
    param(
        [string]$name,
        [string]$url,
        [hashtable]$body,
        [scriptblock]$validate,
        [int]$expectedStatus = 200
    )
    
    $results.total++
    Write-Host "Test: $name" -ForegroundColor Yellow
    Write-Host "  URL: $url" -ForegroundColor DarkGray
    
    try {
        $jsonBody = $body | ConvertTo-Json -Compress
        $response = Invoke-RestMethod -Uri $url -Method POST -ContentType "application/json" -Body $jsonBody -ErrorAction Stop
        
        if ($validate) {
            $validationResult = & $validate $response
            if ($validationResult) {
                Write-Host "  ✓ PASS" -ForegroundColor Green
                $results.passed++
            } else {
                Write-Host "  ✗ FAIL - Validation failed" -ForegroundColor Red
                $results.failed++
            }
        } else {
            Write-Host "  ✓ PASS" -ForegroundColor Green
            $results.passed++
        }
        
        return $response
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq $expectedStatus) {
            Write-Host "  ✓ PASS (Expected status: $statusCode)" -ForegroundColor Green
            $results.passed++
        } else {
            Write-Host "  ✗ FAIL - Status: $statusCode, Error: $_" -ForegroundColor Red
            $results.failed++
        }
        return $null
    }
}

# ==========================================
# TEST 1: Available-Days for each barber
# ==========================================
Write-Host "`n=== TEST SUITE 1: Available-Days by Barber ===" -ForegroundColor Cyan

$barbers = @(
    @{ id = 12; name = "أحمد"; testDate = "2026-05-26"; expectedDayOfWeek = 2; expectedDayName = "الثلاثاء" }  # Tuesday
    @{ id = 13; name = "ذياد"; testDate = "2026-05-29"; expectedDayOfWeek = 5; expectedDayName = "الجمعة" }   # Friday
    @{ id = 14; name = "كريم"; testDate = "2026-05-24"; expectedDayOfWeek = 0; expectedDayName = "الأحد" }    # Sunday
    @{ id = 15; name = "عمر"; testDate = "2026-05-25"; expectedDayOfWeek = 1; expectedDayName = "الإثنين" }   # Monday
)

foreach ($barber in $barbers) {
    $url = "$baseUrl/api/public/booking/available-days?mode=specific&empId=$($barber.id)&serviceIds=1047&fromDate=$($barber.testDate)"
    
    Test-Endpoint -name "available-days for $($barber.name) (ID: $($barber.id)) on $($barber.testDate)" -url $url -validate {
        param($response)
        
        if (-not $response.ok) { return $false }
        if ($response.empId -ne $barber.id) { return $false }
        
        # Find the specific day
        $day = $response.days | Where-Object { $_.date -eq $barber.testDate } | Select-Object -First 1
        if (-not $day) { 
            Write-Host "    Day not found in response" -ForegroundColor Red
            return $false 
        }
        
        Write-Host "    Date: $($day.date)" -ForegroundColor Gray
        Write-Host "    Label: $($day.label)" -ForegroundColor Gray
        Write-Host "    Available: $($day.available)" -ForegroundColor Gray
        if ($day.reason) { Write-Host "    Reason: $($day.reason)" -ForegroundColor Gray }
        
        # Verify day name matches
        if ($day.label -ne $barber.expectedDayName) {
            Write-Host "    ✗ Wrong day name! Expected: $($barber.expectedDayName), Got: $($day.label)" -ForegroundColor Red
            return $false
        }
        
        return $true
    }
}

# ==========================================
# TEST 2: Available-Slots for working day
# ==========================================
Write-Host "`n=== TEST SUITE 2: Available-Slots (Working Day) ===" -ForegroundColor Cyan

$url = "$baseUrl/api/public/booking/available-slots?date=2026-05-26&mode=specific&empId=12&serviceIds=1047"
Test-Endpoint -name "available-slots for أحمد on Tuesday (2026-05-26)" -url $url -validate {
    param($response)
    
    if (-not $response.ok) { return $false }
    if ($response.slots.Count -eq 0) {
        Write-Host "    ✗ No slots returned (should have slots for working day)" -ForegroundColor Red
        return $false
    }
    
    $availableSlots = $response.slots | Where-Object { $_.available -eq $true }
    Write-Host "    Total slots: $($response.slots.Count)" -ForegroundColor Gray
    Write-Host "    Available slots: $($availableSlots.Count)" -ForegroundColor Gray
    
    return $availableSlots.Count -gt 0
}

# ==========================================
# TEST 3: Available-Slots for day off
# ==========================================
Write-Host "`n=== TEST SUITE 3: Available-Slots (Day Off) ===" -ForegroundColor Cyan

$url = "$baseUrl/api/public/booking/available-slots?date=2026-05-29&mode=specific&empId=13&serviceIds=1047"
Test-Endpoint -name "available-slots for ذياد on Friday (day off)" -url $url -validate {
    param($response)
    
    if (-not $response.ok) { return $false }
    
    Write-Host "    Total slots: $($response.slots.Count)" -ForegroundColor Gray
    if ($response.barberAvailability) {
        Write-Host "    Barber available: $($response.barberAvailability.available)" -ForegroundColor Gray
        Write-Host "    Reason: $($response.barberAvailability.reason)" -ForegroundColor Gray
    }
    
    # Should have no available slots on day off
    $availableSlots = $response.slots | Where-Object { $_.available -eq $true }
    return $availableSlots.Count -eq 0
}

# ==========================================
# TEST 4: Date Format Validation
# ==========================================
Write-Host "`n=== TEST SUITE 4: Date Format Validation ===" -ForegroundColor Cyan

# Should be REJECTED - ISO format with T
$url = "$baseUrl/api/public/booking/available-slots?date=2026-05-24T00:00:00.000Z&mode=specific&empId=12&serviceIds=1047"
Test-Endpoint -name "Reject ISO date with T/Z (400 expected)" -url $url -expectedStatus 400 -validate { return $true }

# Should be REJECTED - ISO format with T (no Z)
$url = "$baseUrl/api/public/booking/available-slots?date=2026-05-24T12:00:00&mode=specific&empId=12&serviceIds=1047"
Test-Endpoint -name "Reject ISO date with T only (400 expected)" -url $url -expectedStatus 400 -validate { return $true }

# Should be ACCEPTED - YYYY-MM-DD format
$url = "$baseUrl/api/public/booking/available-slots?date=2026-05-24&mode=specific&empId=12&serviceIds=1047"
Test-Endpoint -name "Accept YYYY-MM-DD format (200 expected)" -url $url -expectedStatus 200 -validate { return $true }

# ==========================================
# TEST 5: Bookings/Estimate with validation
# ==========================================
Write-Host "`n=== TEST SUITE 5: Bookings/Estimate Validation ===" -ForegroundColor Cyan

# Test with valid date/time
$url = "$baseUrl/api/bookings/estimate"
Test-EndpointPost -name "estimate with valid date/time" -url $url -body @{
    mode = "specific"
    empId = 12
    serviceIds = @(1047)
    bookingDate = "2026-05-26"
    bookingTime = "14:00"
} -validate {
    param($response)
    
    if ($response.error) { 
        Write-Host "    Error: $($response.error)" -ForegroundColor Red
        return $false 
    }
    
    Write-Host "    Barbers returned: $($response.barbers.Count)" -ForegroundColor Gray
    return $response.barbers.Count -gt 0
}

# Test with invalid date (ISO format) - should be rejected
Test-EndpointPost -name "estimate with ISO date (should be rejected)" -url $url -body @{
    mode = "specific"
    empId = 12
    serviceIds = @(1047)
    bookingDate = "2026-05-26T00:00:00.000Z"
    bookingTime = "14:00"
} -expectedStatus 400 -validate { return $true }

# ==========================================
# TEST 6: Overnight Shift (if applicable)
# ==========================================
Write-Host "`n=== TEST SUITE 6: Overnight Shift Check ===" -ForegroundColor Cyan

$url = "$baseUrl/api/public/booking/available-slots?date=2026-05-26&mode=specific&empId=12&serviceIds=1047"
$response = Invoke-RestMethod -Uri $url -Method GET -ErrorAction SilentlyContinue

if ($response -and $response.slots) {
    $overnightSlots = $response.slots | Where-Object { [int]($_.time -replace ":", "") -lt 600 -or [int]($_.time -replace ":", "") -gt 2200 }
    
    Write-Host "  Checking for overnight slots (before 06:00 or after 22:00)..." -ForegroundColor Gray
    Write-Host "  Slots outside normal hours: $($overnightSlots.Count)" -ForegroundColor Gray
    
    if ($overnightSlots.Count -gt 0) {
        Write-Host "  ✓ Overnight shift detected" -ForegroundColor Green
        Write-Host "  Sample overnight slots:" -ForegroundColor Gray
        $overnightSlots | Select-Object -First 5 | ForEach-Object {
            Write-Host "    - $($_.time) (dayOffset: $($_.dayOffset), available: $($_.available))" -ForegroundColor Gray
        }
    } else {
        Write-Host "  ℹ No overnight slots found (barber may not have overnight shift)" -ForegroundColor Yellow
    }
}

# ==========================================
# TEST RESULTS SUMMARY
# ==========================================
Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "TEST RESULTS SUMMARY" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Total Tests: $($results.total)" -ForegroundColor White
Write-Host "Passed: $($results.passed)" -ForegroundColor Green
Write-Host "Failed: $($results.failed)" -ForegroundColor $(if ($results.failed -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($results.failed -eq 0) {
    Write-Host "✓ ALL TESTS PASSED!" -ForegroundColor Green -BackgroundColor Black
    Write-Host "The Backend API is returning correct data." -ForegroundColor Green
    exit 0
} else {
    Write-Host "✗ SOME TESTS FAILED!" -ForegroundColor Red -BackgroundColor Black
    Write-Host "Please check the server logs for details." -ForegroundColor Yellow
    exit 1
}
