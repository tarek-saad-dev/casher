# Installs one logon task for the CURRENT Windows account (no admin rights needed).
# Run from a PowerShell session after stopping the manually started npm service.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$taskName = 'CUT Salon Print Agent'
$serviceDir = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-agent.ps1'
$node = Get-Command node.exe -ErrorAction Stop
if (-not (Test-Path -LiteralPath (Join-Path $serviceDir 'server.js'))) {
  throw 'The print service folder is incomplete.'
}
if (-not (Test-Path -LiteralPath (Join-Path $serviceDir 'node_modules\express'))) {
  throw 'First run npm ci inside print-service.'
}
$printer = Get-Printer -Name 'XP-80' -ErrorAction SilentlyContinue
if (-not $printer) {
  throw 'Printer XP-80 not found in Windows. Check the installed printer name.'
}
$account = "$env:USERDOMAIN\$env:USERNAME"
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '"'
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $serviceDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'CUT Salon ESC/POS local receipt printer; runs at cashier user sign-in' -Force | Out-Null
Write-Host "Task installed: $taskName (logon: $account)" -ForegroundColor Green
Write-Host "Engine=escpos, Printer=XP-80, AutoCut=1, Port=7788"
Write-Host 'Log: print-service\logs\print-agent.log'
$listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 7788 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Warning 'Port 7788 is already in use. Stop the old CMD/npm start session with Ctrl+C, then run:'
  Write-Host "Start-ScheduledTask -TaskName '$taskName'"
} else {
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
  Write-Host 'Agent startup requested. Verify http://127.0.0.1:7788/health in Chrome.' -ForegroundColor Green
}
