#Requires -Version 5.1
<#
CUT Salon Print Agent V2 - explicit installer/repair on the Windows cashier PC.
No driver changes, elevation, print jobs, firewall changes or production server changes.
Downloads the official casher main source; should be used after V2 is released on main.
#>
[CmdletBinding()]
param([string]$PrinterName = '')
$ErrorActionPreference = 'Stop'
$taskName = 'CUT Salon Print Agent'
$expectedVersion = '2.0.0'
$healthUrl = 'http://127.0.0.1:7788/health'
$installRoot = Join-Path $env:LOCALAPPDATA 'CUT-Salon\Print-Agent'
$serviceDir = Join-Path $installRoot 'print-service'
$configFile = Join-Path $env:LOCALAPPDATA 'CUT-Salon\print-agent.config.json'
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('cut-print-agent-' + [guid]::NewGuid().ToString('N'))
$archiveUrl = 'https://github.com/tarek-saad-dev/casher/archive/refs/heads/main.zip'
$backupDir = $null
$oldTaskXml = $null
$wasRunning = $false
$oldConfig = $null
$hadConfig = Test-Path -LiteralPath $configFile
$swapped = $false

function Step([string]$message) { Write-Host ("> " + $message) -ForegroundColor Cyan }
function Get-AgentHealth {
  try { return Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 3 -ErrorAction Stop }
  catch { return $null }
}
function Choose-Printer([string]$requested) {
  $all = @(Get-Printer -ErrorAction Stop)
  if ($requested) {
    $found = @($all | Where-Object { $_.Name -eq $requested })
    if ($found.Count -ne 1) { throw "Printer '$requested' not found. Windows printers: $($all.Name -join ', ')" }
    return [string]$found[0].Name
  }
  $exact = @($all | Where-Object { $_.Name -eq 'XP-80' })
  if ($exact.Count -eq 1) { return [string]$exact[0].Name }
  $candidates = @($all | Where-Object { $_.Name -match '(?i)(XP.?80|XPrinter|POS.?80|Thermal|Receipt)' })
  if ($candidates.Count -eq 1) { return [string]$candidates[0].Name }
  throw "Cannot choose a thermal printer safely. Windows printers: $($all.Name -join ', '). Run this installer with -PrinterName 'Exact Windows Printer Name'."
}
function Wait-Agent([string]$version) {
  for ($attempt = 1; $attempt -le 12; $attempt++) {
    Start-Sleep -Seconds 2
    $health = Get-AgentHealth
    if ($health -and [string]$health.version -eq $version) {
      try {
        $settings = Invoke-RestMethod -Uri 'http://127.0.0.1:7788/settings' -TimeoutSec 3
        if ($settings.ok -and [string]$settings.version -eq $version) { return $true }
      } catch {}
    }
  }
  return $false
}
function Stop-ExistingTask {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task -and $task.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
    for ($try = 1; $try -le 10; $try++) {
      Start-Sleep -Milliseconds 500
      if (-not (Get-AgentHealth)) { break }
    }
  }
  if (Get-AgentHealth) {
    throw 'A local print server is still active on port 7788. Stop the old manual CMD/npm process first. No unrelated Node processes were killed.'
  }
}

Write-Host 'CUT SALON - Print Agent V2 install / repair' -ForegroundColor Green
Write-Host 'This is a LOCAL Windows operation. No paper will be printed.'
try {
  if (-not $env:LOCALAPPDATA) { throw 'Sign into the Windows cashier account first.' }
  $node = Get-Command node.exe -ErrorAction Stop
  $npm = Get-Command npm.cmd -ErrorAction Stop
  $nodeVersion = & $node.Source -p 'process.versions.node'
  if ([int](($nodeVersion -split '\.')[0]) -lt 22) { throw 'Node.js 22+ required.' }
  $selectedPrinter = Choose-Printer $PrinterName
  Step "Windows printer: $selectedPrinter"

  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  $agent = Get-AgentHealth
  $managedTask = $false
  if ($task) {
    $managedTask = @($task.Actions | Where-Object { $_.Arguments -like "*$serviceDir*" }).Count -gt 0
  }
  if ($agent -and [string]$agent.version -eq $expectedVersion -and $managedTask -and
      [string]$agent.printer -eq $selectedPrinter) {
    Step 'V2 is already healthy and supervised; no reinstall needed.'
    exit 0
  }
  Step 'Agent is outdated, incorrectly configured, or not supervised. Preparing repair.'
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
  $archivePath = Join-Path $tempRoot 'source.zip'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing -MaximumRedirection 5
  if ((Get-Item -LiteralPath $archivePath).Length -lt 2000) { throw 'Invalid source archive.' }
  $expanded = Join-Path $tempRoot 'expanded'
  Expand-Archive -LiteralPath $archivePath -DestinationPath $expanded -Force
  $source = Get-ChildItem -LiteralPath $expanded -Directory |
    ForEach-Object { Join-Path $_.FullName 'print-service' } |
    Where-Object { Test-Path -LiteralPath (Join-Path $_ 'server.js') } |
    Select-Object -First 1
  if (-not $source) { throw 'Official print-service not found in archive.' }
  $package = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
  if ([string]$package.version -ne $expectedVersion) {
    throw "Downloaded source is version $($package.version), expected $expectedVersion. Install only after V2 is released."
  }
  $stage = Join-Path $tempRoot 'ready'
  Copy-Item -LiteralPath $source -Destination $stage -Recurse -Force
  Step 'Installing dependencies in isolated staging directory.'
  Push-Location $stage
  try {
    & $npm.Source ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed; existing Agent was not changed.' }
  } finally { Pop-Location }

  if ($task) {
    $oldTaskXml = Export-ScheduledTask -TaskName $taskName
    $wasRunning = $task.State -eq 'Running'
  }
  if ($hadConfig) { $oldConfig = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 }
  Step 'Stopping the old Agent only after staging succeeded.'
  Stop-ExistingTask
  if (Test-Path -LiteralPath $serviceDir) {
    $backupDir = $serviceDir + '.backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Move-Item -LiteralPath $serviceDir -Destination $backupDir
  }
  $swapped = $true
  try {
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    Move-Item -LiteralPath $stage -Destination $serviceDir
    New-Item -ItemType Directory -Path (Split-Path -Parent $configFile) -Force | Out-Null
    $configJson = @{ printerName = $selectedPrinter; nodePath = $node.Source } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($configFile, $configJson, (New-Object System.Text.UTF8Encoding($false)))
    Step 'Repairing user-logon task and starting Agent V2.'
    & (Join-Path $serviceDir 'windows\install-autostart.ps1')
    if (-not (Wait-Agent $expectedVersion)) { throw 'V2 did not answer /health and /settings after installation.' }
    Step "Repair successful: Agent $expectedVersion; printer $selectedPrinter."
    Write-Host 'Open Cashier > Printer Center and explicitly test one physical paper receipt.' -ForegroundColor Green
  } catch {
    $failure = $_.Exception.Message
    Write-Warning 'V2 repair failed; restoring previous files and task.'
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $serviceDir) {
      Move-Item -LiteralPath $serviceDir -Destination ($serviceDir + '.failed-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    }
    if ($backupDir -and (Test-Path -LiteralPath $backupDir)) {
      Move-Item -LiteralPath $backupDir -Destination $serviceDir
    }
    if ($hadConfig) {
      [IO.File]::WriteAllText($configFile, $oldConfig, (New-Object System.Text.UTF8Encoding($false)))
    } elseif (Test-Path -LiteralPath $configFile) { Remove-Item -LiteralPath $configFile -Force }
    if ($oldTaskXml) {
      Register-ScheduledTask -TaskName $taskName -Xml $oldTaskXml -Force | Out-Null
      if ($wasRunning) { Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
    } else {
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    }
    throw "Repair failed ($failure). Rollback attempted; verify old Agent before resuming printing."
  }
} catch {
  Write-Host ('Print Agent V2 setup stopped: ' + $_.Exception.Message) -ForegroundColor Yellow
  exit 1
} finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
