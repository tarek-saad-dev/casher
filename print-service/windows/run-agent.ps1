# CUT Salon print agent background launcher.
# Runs only after the user signs in; does not require administrator access.
$ErrorActionPreference = 'Stop'
$serviceDir = Split-Path -Parent $PSScriptRoot
$serverFile = Join-Path $serviceDir 'server.js'
$logDir = Join-Path $serviceDir 'logs'
$logFile = Join-Path $logDir 'print-agent.log'
if (-not (Test-Path -LiteralPath $serverFile -PathType Leaf)) {
  throw "Missing print service: $serverFile"
}
$node = (Get-Command node.exe -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 5MB) {
  Move-Item -LiteralPath $logFile -Destination (Join-Path $logDir 'print-agent.previous.log') -Force
}
$env:PRINT_ENGINE = 'escpos'
$env:PRINTER_NAME = 'XP-80'
$env:PRINTER_AUTO_CUT = '1'
$env:PRINTER_SERVICE_PORT = '7788'
$env:ALLOWED_ORIGINS = 'https://ops.cutsaloon.com,http://localhost:5500,http://127.0.0.1:5500'
Set-Location -LiteralPath $serviceDir
"[$(Get-Date -Format s)] CUT print agent starting (ESC/POS, auto-cut, XP-80)" | Add-Content -LiteralPath $logFile -Encoding UTF8
# Keep this script running so Task Scheduler can supervise the Node process.
$ErrorActionPreference = 'Continue'
& $node $serverFile *>> $logFile
$exitCode = $LASTEXITCODE
"[$(Get-Date -Format s)] CUT print agent exited ($exitCode)" | Add-Content -LiteralPath $logFile -Encoding UTF8
exit $exitCode
