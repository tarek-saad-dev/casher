# Read-only Windows printer/spooler diagnostic, never prints.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$PrinterName)
$ErrorActionPreference = 'Stop'
$spool = Get-Service -Name Spooler -ErrorAction SilentlyContinue
$printer = Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue
$count = $null
if ($printer) {
  try { $count = @(Get-PrintJob -PrinterName $PrinterName -ErrorAction Stop).Count }
  catch { $count = $null }
}
[pscustomobject]@{
  found = [bool]$printer
  status = if ($printer) { [string]$printer.PrinterStatus } else { 'not-found' }
  spooler = if ($spool) { [string]$spool.Status } else { 'unknown' }
  queuedJobs = $count
} | ConvertTo-Json -Compress
