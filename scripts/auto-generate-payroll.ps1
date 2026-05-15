# ============================================================
# Auto-Generate Daily Payroll — Windows Task Scheduler Script
# Schedule: Daily at 01:00 AM
#
# How to register this task:
#   Open Task Scheduler → Create Basic Task
#   Trigger: Daily at 01:00 AM
#   Action:  PowerShell -File "C:\path\to\auto-generate-payroll.ps1"
#
# Or via command line (run as Administrator):
#   schtasks /create /tn "POS Auto-Generate Payroll" /tr "powershell -NonInteractive -File \"H:\whatsapp-bot-node\pos-system\scripts\auto-generate-payroll.ps1\"" /sc DAILY /st 01:00 /ru SYSTEM
# ============================================================

$APP_URL    = "http://localhost:5500"   # Change to your app URL
$CRON_SECRET = $env:CRON_SECRET         # Set as Windows environment variable
$LOG_FILE   = "$PSScriptRoot\auto-generate-payroll.log"

$headers = @{
  "Content-Type"  = "application/json"
  "Authorization" = "Bearer $CRON_SECRET"
}

# Business-day logic: if it's before 06:00, use yesterday's date
$now = Get-Date
if ($now.Hour -lt 6) {
  $workDate = $now.AddDays(-1).ToString("yyyy-MM-dd")
} else {
  $workDate = $now.ToString("yyyy-MM-dd")
}

$body = @{ workDate = $workDate } | ConvertTo-Json

Write-Host "[$($now.ToString('yyyy-MM-dd HH:mm:ss'))] Triggering auto-generate for $workDate ..."

try {
  $response = Invoke-RestMethod `
    -Uri "$APP_URL/api/payroll/daily/auto-generate" `
    -Method POST `
    -Headers $headers `
    -Body $body `
    -TimeoutSec 60

  $logEntry = "[$($now.ToString('yyyy-MM-dd HH:mm:ss'))] workDate=$workDate ok=$($response.ok) status=$($response.status) employees=$($response.employeesCount) hours=$($response.totalHours) wages=$($response.totalWages)"

  if (-not $response.ok) {
    $missing = ($response.missing | ForEach-Object { "$($_.empName): $($_.reason)" }) -join ", "
    $logEntry += " | missing=[$missing]"
    Write-Warning $logEntry
  } else {
    Write-Host $logEntry
  }

  Add-Content -Path $LOG_FILE -Value $logEntry

} catch {
  $errMsg = "[$($now.ToString('yyyy-MM-dd HH:mm:ss'))] ERROR: $_"
  Write-Error $errMsg
  Add-Content -Path $LOG_FILE -Value $errMsg
}
