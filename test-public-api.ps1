# Smoke test for public booking endpoints
$base = "http://localhost:5500"
$results = @()

function Test-Endpoint {
    param($method, $url, $body = $null, $label = "")
    try {
        if ($method -eq "GET") {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -Method GET
        } else {
            $json = $body | ConvertTo-Json -Depth 5
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -Method POST -Body $json -ContentType "application/json"
        }
        $parsed = $r.Content | ConvertFrom-Json
        $status = if ($parsed.ok -eq $true) { "OK" } elseif ($parsed.ok -eq $false) { "OK(ok=false)" } else { "OK" }
        Write-Host "  PASS [$($r.StatusCode)] $label"
        return $r.Content
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        Write-Host "  FAIL [$code] $label - $($_.Exception.Message)"
        return $null
    }
}

Write-Host "`n--- GET endpoints ---"
Test-Endpoint GET "$base/api/public/booking/config" -label "config"
Test-Endpoint GET "$base/api/public/booking/services" -label "services"
Test-Endpoint GET "$base/api/public/booking/barbers" -label "barbers"
Test-Endpoint GET "$base/api/public/booking/available-days?serviceIds=9&mode=nearest" -label "available-days"
Test-Endpoint GET "$base/api/public/booking/available-slots?date=2026-05-18&serviceIds=9&mode=nearest" -label "available-slots (nearest)"

Write-Host "`n--- POST check-slot ---"
$checkBody = @{ date="2026-05-18"; time="23:00"; serviceIds=@(9); mode="nearest" }
Test-Endpoint POST "$base/api/public/booking/check-slot" $checkBody "check-slot nearest"

Write-Host "`n--- POST create ---"
$createBody = @{
    customer = @{ name="Test Client"; phone="01000000099" }
    serviceIds = @(9)
    mode = "nearest"
    date = "2026-05-19"
    time = "23:00"
    notes = "smoke test"
}
$createResult = Test-Endpoint POST "$base/api/public/booking/create" $createBody "create booking"

if ($createResult) {
    $booking = ($createResult | ConvertFrom-Json).booking
    if ($booking -and $booking.code) {
        $code = $booking.code
        Write-Host "`n--- GET /:code ---"
        Test-Endpoint GET "$base/api/public/booking/$code" -label "get booking by code"

        Write-Host "`n--- OPTIONS CORS ---"
        try {
            $r = Invoke-WebRequest -Uri "$base/api/public/booking/config" -UseBasicParsing -Method OPTIONS
            $cors = $r.Headers["Access-Control-Allow-Origin"]
            Write-Host "  PASS OPTIONS 204, CORS header: $cors"
        } catch {
            Write-Host "  FAIL OPTIONS: $($_.Exception.Message)"
        }

        Write-Host "`n--- POST cancel ---"
        $cancelBody = @{ phone="01000000099"; reason="smoke test cancel" }
        Test-Endpoint POST "$base/api/public/booking/$code/cancel" $cancelBody "cancel booking"
    }
}

Write-Host "`n--- Invalid input tests ---"
$badSlot = @{ date="2026-05-18"; time="23:00"; serviceIds=@(9); mode="specific" }
Test-Endpoint POST "$base/api/public/booking/check-slot" $badSlot "check-slot specific without empId (expect 400)"

Write-Host "`nDone."
