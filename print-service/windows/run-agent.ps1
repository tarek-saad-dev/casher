# CUT Salon Print Agent V2 - supervised user-session launcher.
# Task Scheduler can restart this runner if PowerShell itself exits.
$ErrorActionPreference = 'Stop'
$serviceDir = Split-Path -Parent $PSScriptRoot
$serverFile = Join-Path $serviceDir 'server.js'
$logDir = Join-Path $serviceDir 'logs'
$logFile = Join-Path $logDir 'print-agent.log'
$configFile = Join-Path $env:LOCALAPPDATA 'CUT-Salon\print-agent.config.json'
if (-not (Test-Path -LiteralPath $serverFile -PathType Leaf)) { throw "Missing service: $serverFile" }
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$config = $null
if (Test-Path -LiteralPath $configFile) {
  $config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
}
$printerName = if ($config -and $config.printerName) { [string]$config.printerName } else { 'XP-80' }
$nodePath = if ($config -and $config.nodePath -and (Test-Path -LiteralPath $config.nodePath)) {
  [string]$config.nodePath
} else { (Get-Command node.exe -ErrorAction Stop).Source }
$env:PRINT_ENGINE = 'escpos'
$env:PRINTER_NAME = $printerName
$env:PRINTER_AUTO_CUT = '1'
$env:PRINTER_SERVICE_PORT = '7788'
$env:ALLOWED_ORIGINS = 'https://ops.cutsaloon.com,http://localhost:5500,http://127.0.0.1:5500'
Set-Location -LiteralPath $serviceDir
$restarts = 0
while ($true) {
  if (Test-Path -LiteralPath $logFile) {
    if ((Get-Item -LiteralPath $logFile).Length -gt 5MB) {
      Move-Item -LiteralPath $logFile -Destination (Join-Path $logDir 'print-agent.previous.log') -Force
    }
  }
  "[$(Get-Date -Format s)] Agent launch: printer=$printerName" | Add-Content -LiteralPath $logFile -Encoding UTF8
  $startTime = Get-Date
  $exitCode = 1
  try {
    $ErrorActionPreference = 'Continue'
    & $nodePath $serverFile *>> $logFile
    $exitCode = $LASTEXITCODE
  } catch {
    "[$(Get-Date -Format s)] Launch failed: $($_.Exception.Message)" | Add-Content -LiteralPath $logFile -Encoding UTF8
  } finally {
    $ErrorActionPreference = 'Stop'
  }
  $uptime = ((Get-Date) - $startTime).TotalSeconds
  if ($uptime -gt 60) { $restarts = 0 }
  $restarts += 1
  $delay = [Math]::Min(30, 5 * $restarts)
  "[$(Get-Date -Format s)] Agent exited ($exitCode); restarting in $delay s" | Add-Content -LiteralPath $logFile -Encoding UTF8
  Start-Sleep -Seconds $delay
}
