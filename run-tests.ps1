# Test Public APIs
$BASE = "http://localhost:5500"

function Test-Post {
    param($label, $url, $body)
    Write-Host "`n--- $label ---" -ForegroundColor Cyan
    try {
        $resp = Invoke-WebRequest -Uri $url -Method POST `
            -ContentType "application/json" `
            -Body ($body | ConvertTo-Json) `
            -UseBasicParsing
        Write-Host "Status: $($resp.StatusCode)"
        $resp.Content
    } catch {
        $code = $_.Exception.Response.StatusCode.Value__
        Write-Host "Status: $code" -ForegroundColor Red
        try { $_.ErrorDetails.Message } catch { $_.Exception.Message }
    }
}

# TEST 1: upcoming - no bookings phone
Test-Post "UPCOMING - empty phone" `
    "$BASE/api/public/booking/upcoming" `
    @{ phone = "01000000000" }

# TEST 2: upcoming - invalid phone
Test-Post "UPCOMING - invalid phone" `
    "$BASE/api/public/booking/upcoming" `
    @{ phone = "123" }

# TEST 3: client profile - not found
Test-Post "CLIENT PROFILE - not found" `
    "$BASE/api/public/client/profile" `
    @{ phone = "01000000000" }

# TEST 4: cancel - missing bookingId
Test-Post "CANCEL - missing bookingId" `
    "$BASE/api/public/booking/cancel" `
    @{ phone = "01000000000" }

Write-Host "`nDone." -ForegroundColor Green
