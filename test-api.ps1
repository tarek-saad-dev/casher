# Test API Script for Upcoming Bookings and Cancel
# Run this in PowerShell to test the endpoints

$BASE_URL = "https://casher-five.vercel.app"

function Test-UpcomingBookings {
    param($phone)
    
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "TEST: upcoming bookings for phone: $phone" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    $body = @{ phone = $phone } | ConvertTo-Json
    
    try {
        $response = Invoke-RestMethod -Uri "$BASE_URL/api/public/booking/upcoming" `
            -Method POST `
            -ContentType "application/json" `
            -Body $body
        
        Write-Host "Status: 200 OK" -ForegroundColor Green
        Write-Host "Response:" -ForegroundColor Green
        $response | ConvertTo-Json -Depth 3 | Write-Host
        
        if ($response.ok -eq $true) {
            Write-Host "Result: PASS" -ForegroundColor Green
            return $response.bookings
        } else {
            Write-Host "Result: FAIL - ok is false" -ForegroundColor Red
            return $null
        }
    } catch {
        Write-Host "Status: $($_.Exception.Response.StatusCode.Value__)" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Result: FAIL" -ForegroundColor Red
        return $null
    }
}

function Test-CancelBooking {
    param($bookingId, $phone)
    
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "TEST: cancel booking $bookingId with phone: $phone" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    $body = @{ 
        bookingId = $bookingId
        phone = $phone 
    } | ConvertTo-Json
    
    try {
        $response = Invoke-RestMethod -Uri "$BASE_URL/api/public/booking/cancel" `
            -Method POST `
            -ContentType "application/json" `
            -Body $body
        
        Write-Host "Status: 200 OK" -ForegroundColor Green
        Write-Host "Response:" -ForegroundColor Green
        $response | ConvertTo-Json | Write-Host
        
        if ($response.ok -eq $true) {
            Write-Host "Result: PASS" -ForegroundColor Green
            return $true
        } else {
            Write-Host "Result: Expected failure (ok is false)" -ForegroundColor Yellow
            return $false
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.Value__
        Write-Host "Status: $statusCode" -ForegroundColor Red
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        
        if ($statusCode -eq 403 -or $statusCode -eq 400) {
            Write-Host "Result: PASS (Expected rejection)" -ForegroundColor Green
        } else {
            Write-Host "Result: FAIL" -ForegroundColor Red
        }
        return $false
    }
}

# ========================================
# MAIN TEST SEQUENCE
# ========================================

Write-Host "`n########################################" -ForegroundColor Magenta
Write-Host "API TEST SUITE - Upcoming & Cancel" -ForegroundColor Magenta
Write-Host "########################################" -ForegroundColor Magenta

# TEST 1: Upcoming - phone with future booking
$bookings = Test-UpcomingBookings -phone "رقم_فعلي_عليه_حجز"

# TEST 2: Upcoming - phone without bookings
Test-UpcomingBookings -phone "01000000000"

# TEST 3: Cancel - correct phone (only if we have a booking)
if ($bookings -and $bookings.Count -gt 0) {
    $bookingId = $bookings[0].id
    $phone = $bookings[0].phone
    
    Test-CancelBooking -bookingId $bookingId -phone $phone
    
    # TEST 4: Cancel - wrong phone
    Test-CancelBooking -bookingId $bookingId -phone "01099999999"
    
    # TEST 5: After cancel, check upcoming again
    Write-Host "`nWaiting 2 seconds for DB update..." -ForegroundColor Yellow
    Start-Sleep -Seconds 2
    Test-UpcomingBookings -phone $phone
} else {
    Write-Host "`n⚠️  No bookings found. Skipping cancel tests." -ForegroundColor Yellow
}

Write-Host "`n########################################" -ForegroundColor Magenta
Write-Host "TEST SUITE COMPLETE" -ForegroundColor Magenta
Write-Host "########################################" -ForegroundColor Magenta
