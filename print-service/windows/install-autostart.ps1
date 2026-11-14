# Install / repair user-session startup. Doesn't print or require elevation.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$taskName = 'CUT Salon Print Agent'
$serviceDir = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-agent.ps1'
$configFile = Join-Path $env:LOCALAPPDATA 'CUT-Salon\print-agent.config.json'
if (-not (Test-Path -LiteralPath (Join-Path $serviceDir 'server.js'))) { throw 'Print service folder is incomplete.' }
if (-not (Test-Path -LiteralPath (Join-Path $serviceDir 'node_modules\express'))) { throw 'Run npm ci in print-service first.' }
$config = $null
if (Test-Path -LiteralPath $configFile) {
  $config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
}
$printerName = if ($config -and $config.printerName) { [string]$config.printerName } else { 'XP-80' }
$nodePath = if ($config -and $config.nodePath) { [string]$config.nodePath } else { (Get-Command node.exe -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'Configured Node.js path is missing.' }
if (-not (Get-Printer -Name $printerName -ErrorAction SilentlyContinue)) {
  throw "Printer '$printerName' not found in Windows."
}
$account = "$env:USERDOMAIN\$env:USERNAME"
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '"'
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $serviceDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'CUT Salon Print Agent V2 user-session supervisor; localhost only' -Force | Out-Null
Write-Host "Task repaired: $taskName; printer: $printerName; port: 7788" -ForegroundColor Green
$listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 7788 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  Write-Warning 'Port 7788 is already occupied. Stop the previous instance before starting this task.'
} else {
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
}
