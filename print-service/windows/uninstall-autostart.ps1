# Removes only the CUT Salon Print Agent scheduled task.
$ErrorActionPreference = 'Stop'
$taskName = 'CUT Salon Print Agent'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host 'CUT Salon Print Agent scheduled task is not installed.'
  exit 0
}
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host 'CUT Salon Print Agent autostart task removed.'
Write-Host 'No printer settings or Cashier database records were changed.'
