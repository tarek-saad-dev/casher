#Requires -Version 5.1
<#
CUT Salon: safe, local recovery checker.
No print jobs, downloads, driver changes, administrator access or spooler resets.
Attempts to start ONLY a stopped current-user CUT Salon Print Agent task.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$taskName = 'CUT Salon Print Agent'
$healthUrl = 'http://127.0.0.1:7788/health'

function Agent-Health {
  try { return Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 3 -ErrorAction Stop }
  catch { return $null }
}
function Explain([string]$message) { Write-Host ('CUT PRINT: ' + $message) -ForegroundColor Yellow }
Write-Host 'CUT SALON - Safe local printer check' -ForegroundColor Cyan
Write-Host 'No invoice is being printed or reprinted.' -ForegroundColor Cyan
try {
  $current = Agent-Health
  if ($current) {
    Write-Host ("Agent reachable. Version: " + $current.version + "; Windows printer: " + $current.printer) -ForegroundColor Green
    if ([string]$current.version -ne '2.0.0') {
      Explain 'Older Agent version: use the official V2 Repair installer after release.'
      exit 2
    }
    try {
      $diagnostics = Invoke-RestMethod -Uri 'http://127.0.0.1:7788/diagnostics' -TimeoutSec 8 -ErrorAction Stop
      Write-Host ("Printer found: " + $diagnostics.printerFound + "; Spooler: " + $diagnostics.spoolerStatus + "; Queue: " + $diagnostics.queuedJobs)
      Write-Host 'Windows status is not proof of paper output.'
    } catch {
      Explain 'Agent is running, but Windows diagnostic endpoint did not respond.'
    }
    exit 0
  }
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if (-not $task) {
    Explain 'CUT Salon scheduled task is missing. Use official Repair V2 after release.'
    exit 3
  }
  $principal = [string]$task.Principal.UserId
  $currentAccount = "$env:USERDOMAIN\$env:USERNAME"
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ($principal -and $principal -ne $currentAccount -and $principal -ne $env:USERNAME -and $principal -ne $currentSid) {
    Explain 'Task belongs to another Windows user. Sign into that cashier account. No action taken.'
    exit 4
  }
  if ($task.State -eq 'Running') {
    Explain 'Print Agent task is already running but health is unreachable. It might be hung or Chrome may be blocked. No forced restart to avoid losing in-flight jobs.'
    Write-Host 'Review logs and use official Repair V2 only after checking paper and pending print jobs.'
    exit 5
  }
  Write-Host 'Task is stopped. Trying a safe one-time start...' -ForegroundColor Cyan
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
  for ($n = 1; $n -le 8; $n++) {
    Start-Sleep -Seconds 1
    $current = Agent-Health
    if ($current) {
      Write-Host ("Agent started: " + $current.version) -ForegroundColor Green
      if ([string]$current.version -ne '2.0.0') {
        Explain 'Agent started but needs V2 update after release.'
        exit 2
      }
      Write-Host 'Return to Cashier and click Check connection. This checker did not print anything.' -ForegroundColor Green
      exit 0
    }
  }
  Explain 'Task start requested, but localhost health is still unreachable. Check logs and browser permission.'
  exit 6
} catch {
  Explain ('Unable to finish check: ' + $_.Exception.Message)
  exit 1
}
