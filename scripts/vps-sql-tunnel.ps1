#Requires -Version 5.1
<#
.SYNOPSIS
  Persistent SSH tunnel: local 127.0.0.1:14330 -> casher-vps -> 127.0.0.1:1433

.DESCRIPTION
  Manages a supervised, auto-reconnecting tunnel for local SQL development.
  Uses SSH config host "casher-vps" (no credentials in this script).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/vps-sql-tunnel.ps1 -Action start
  powershell -ExecutionPolicy Bypass -File scripts/vps-sql-tunnel.ps1 -Action status
  powershell -ExecutionPolicy Bypass -File scripts/vps-sql-tunnel.ps1 -Action stop
  powershell -ExecutionPolicy Bypass -File scripts/vps-sql-tunnel.ps1 -Action install-task
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'status', 'run', 'install-task', 'uninstall-task')]
    [string]$Action = 'status',

    [int]$ReconnectDelaySeconds = 4
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Constants (no secrets) ───────────────────────────────────────────────────
$Script:SshHost = 'casher-vps'
$Script:LocalBindHost = '127.0.0.1'
$Script:LocalPort = 14330
$Script:RemoteHost = '127.0.0.1'
$Script:RemotePort = 1433
$Script:TaskName = 'CUT-VPS-SQL-Tunnel'
$Script:MutexName = 'Local\CUT-VPS-SQL-Tunnel-Supervisor'

$Script:StateDir = Join-Path $env:LOCALAPPDATA 'casher\vps-sql-tunnel'
$Script:SupervisorPidFile = Join-Path $Script:StateDir 'supervisor.pid'
$Script:SshPidFile = Join-Path $Script:StateDir 'ssh.pid'
$Script:StopFlagFile = Join-Path $Script:StateDir 'stop.flag'
$Script:LogFile = Join-Path $Script:StateDir 'tunnel.log'

$Script:RepoRoot = Split-Path $PSScriptRoot -Parent
$Script:SelfPath = $PSScriptRoot + '\vps-sql-tunnel.ps1'

function Ensure-StateDir {
    if (-not (Test-Path $Script:StateDir)) {
        New-Item -ItemType Directory -Path $Script:StateDir -Force | Out-Null
    }
}

function Write-TunnelLog {
    param([string]$Message)
    Ensure-StateDir
    $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message
    Add-Content -Path $Script:LogFile -Value $line -Encoding UTF8
}

function Get-ProcessAlive {
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return $false }
    return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Read-PidFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return 0 }
    $raw = (Get-Content -Path $Path -Raw -ErrorAction SilentlyContinue)
    if ([string]::IsNullOrWhiteSpace($raw)) { return 0 }
    $parsedPid = 0
    if ([int]::TryParse($raw.Trim(), [ref]$parsedPid)) { return $parsedPid }
    return 0
}

function Write-PidFile {
    param([string]$Path, [int]$ProcessId)
    Ensure-StateDir
    Set-Content -Path $Path -Value $ProcessId -Encoding ASCII -NoNewline
}

function Remove-PidFile {
    param([string]$Path)
    if (Test-Path $Path) { Remove-Item -Path $Path -Force -ErrorAction SilentlyContinue }
}

function Test-PortListening {
    param(
        [string]$HostName = '127.0.0.1',
        [int]$Port = $Script:LocalPort
    )
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect($HostName, $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(2000, $false)
        if ($ok -and $client.Connected) {
            $client.EndConnect($iar)
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    }
    catch {
        return $false
    }
}

function Get-PortListenerPids {
    param([int]$Port = $Script:LocalPort)
    $pids = @()
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            if ($c.OwningProcess -gt 0) { $pids += [int]$c.OwningProcess }
        }
    }
    catch {
        # fallback
    }
    return @($pids | Sort-Object -Unique)
}

function Get-SshTunnelCommandLine {
    param([int]$ProcessId)
    if (-not (Get-ProcessAlive $ProcessId)) { return $null }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
    return $proc.CommandLine
}

function Test-IsOurSshTunnel {
    param([int]$ProcessId)
    $cmd = Get-SshTunnelCommandLine $ProcessId
    if ([string]::IsNullOrWhiteSpace($cmd)) { return $false }
    return ($cmd -match 'ssh\.exe' -and $cmd -match $Script:SshHost -and $cmd -match ":$($Script:LocalPort):")
}

function Get-ManagedPids {
    $supervisorPid = Read-PidFile $Script:SupervisorPidFile
    $sshPid = Read-PidFile $Script:SshPidFile
    return @{
        SupervisorPid = $supervisorPid
        SshPid        = $sshPid
    }
}

function Get-TunnelHealth {
    $pids = Get-ManagedPids
    $supervisorAlive = Get-ProcessAlive $pids.SupervisorPid
    $sshAlive = (Get-ProcessAlive $pids.SshPid) -and (Test-IsOurSshTunnel $pids.SshPid)
    $portOk = Test-PortListening -HostName $Script:LocalBindHost -Port $Script:LocalPort
    $listenerPids = @(Get-PortListenerPids -Port $Script:LocalPort)

    $foreignListener = $false
    foreach ($lp in $listenerPids) {
        if ($lp -ne $pids.SshPid) {
            $foreignListener = $true
            break
        }
    }

    $healthy = $supervisorAlive -and $sshAlive -and $portOk -and (-not $foreignListener)

    return [PSCustomObject]@{
        Healthy         = $healthy
        SupervisorPid   = $pids.SupervisorPid
        SupervisorAlive = $supervisorAlive
        SshPid          = $pids.SshPid
        SshAlive        = $sshAlive
        PortListening   = $portOk
        ForeignListener = $foreignListener
        ListenerPids    = $listenerPids
    }
}

function Stop-ProcessTree {
    param([int]$RootPid)
    if (-not (Get-ProcessAlive $RootPid)) { return }

    try {
        $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$RootPid" -ErrorAction SilentlyContinue
        foreach ($child in $children) {
            Stop-ProcessTree -RootPid $child.ProcessId
        }
    }
    catch {
        Write-TunnelLog "WARN: could not enumerate children of PID $RootPid : $($_.Exception.Message)"
    }

    try {
        Stop-Process -Id $RootPid -Force -ErrorAction Stop
        Write-TunnelLog "Stopped PID $RootPid"
    }
    catch {
        Write-TunnelLog "WARN: failed to stop PID $RootPid : $($_.Exception.Message)"
    }
}

function Start-SshTunnelProcess {
  $forward = '{0}:{1}:{2}:{3}' -f $Script:LocalBindHost, $Script:LocalPort, $Script:RemoteHost, $Script:RemotePort
  $sshArgs = @(
        '-L', $forward,
        $Script:SshHost,
        '-N',
        '-o', 'ExitOnForwardFailure=yes',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'TCPKeepAlive=yes',
        '-o', 'ConnectTimeout=10'
    )

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $sshExe = (Get-Command ssh.exe -ErrorAction Stop).Source
    $psi.FileName = $sshExe
    $psi.Arguments = ($sshArgs | ForEach-Object {
            if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
        }) -join ' '
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden

    $proc = [System.Diagnostics.Process]::Start($psi)
    if ($null -eq $proc) {
        throw 'Failed to start ssh.exe'
    }
    Write-PidFile -Path $Script:SshPidFile -ProcessId $proc.Id
    Write-TunnelLog "Started ssh PID $($proc.Id) forward $forward"
    return $proc
}

function Invoke-RunSupervisor {
    Ensure-StateDir
    if (Test-Path $Script:StopFlagFile) {
        Remove-Item -Path $Script:StopFlagFile -Force -ErrorAction SilentlyContinue
    }

    $mutex = $null
    $hasHandle = $false
    try {
        $mutex = New-Object System.Threading.Mutex($false, $Script:MutexName)
        try {
            $hasHandle = $mutex.WaitOne(0, $false)
        }
        catch [System.Threading.AbandonedMutexException] {
            $hasHandle = $true
        }

        if (-not $hasHandle) {
            Write-TunnelLog 'Supervisor already running (mutex held). Exiting.'
            exit 0
        }

        Write-PidFile -Path $Script:SupervisorPidFile -ProcessId $PID
        Write-TunnelLog "Supervisor started PID $PID"

        $consecutiveFailures = 0
        while (-not (Test-Path $Script:StopFlagFile)) {
            $listenerPids = @(Get-PortListenerPids -Port $Script:LocalPort)
            $ourSshPid = Read-PidFile $Script:SshPidFile
            $portFree = ($listenerPids.Count -eq 0) -or (
                $listenerPids.Count -eq 1 -and $listenerPids[0] -eq $ourSshPid -and (Get-ProcessAlive $ourSshPid)
            )

            if (-not $portFree) {
                foreach ($lp in $listenerPids) {
                    if ($lp -ne $ourSshPid) {
                        Write-TunnelLog "ERROR: port $($Script:LocalPort) in use by foreign PID $lp"
                        Start-Sleep -Seconds $ReconnectDelaySeconds
                        continue
                    }
                }
            }

            $sshProc = $null
            try {
                if (Get-ProcessAlive $ourSshPid) {
                    if (Test-IsOurSshTunnel $ourSshPid) {
                        $sshProc = Get-Process -Id $ourSshPid
                    }
                    else {
                        Write-TunnelLog "Stale ssh PID $ourSshPid is not our tunnel; clearing"
                        Remove-PidFile $Script:SshPidFile
                    }
                }

                if ($null -eq $sshProc) {
                    $sshProc = Start-SshTunnelProcess
                    Start-Sleep -Seconds 1
                    if (-not (Test-PortListening)) {
                        throw 'Port not listening after ssh start'
                    }
                    $consecutiveFailures = 0
                }

                $sshProc.WaitForExit()
                $exitCode = $sshProc.ExitCode
                Write-TunnelLog "ssh exited with code $exitCode"
                Remove-PidFile $Script:SshPidFile
                $consecutiveFailures++
            }
            catch {
                Write-TunnelLog "Tunnel error: $($_.Exception.Message)"
                $consecutiveFailures++
                Remove-PidFile $Script:SshPidFile
            }

            if (Test-Path $Script:StopFlagFile) { break }

            $delay = [Math]::Min(30, $ReconnectDelaySeconds * [Math]::Max(1, $consecutiveFailures))
            Write-TunnelLog "Reconnecting in ${delay}s (failures=$consecutiveFailures)"
            Start-Sleep -Seconds $delay
        }

        Write-TunnelLog 'Supervisor stopping (stop flag set)'
    }
    finally {
        $sshPid = Read-PidFile $Script:SshPidFile
        if ($sshPid -gt 0 -and (Test-IsOurSshTunnel $sshPid)) {
            Stop-ProcessTree -RootPid $sshPid
        }
        Remove-PidFile $Script:SshPidFile
        Remove-PidFile $Script:SupervisorPidFile
        if ($null -ne $mutex -and $hasHandle) {
            try { $mutex.ReleaseMutex() } catch { }
            $mutex.Dispose()
        }
    }
}

function Invoke-StartTunnel {
    Ensure-StateDir

    $health = Get-TunnelHealth
    if ($health.Healthy) {
        Write-Host 'VPS SQL tunnel already running.'
        Write-Host "PID: $($health.SupervisorPid) (supervisor), $($health.SshPid) (ssh)"
        Write-Host "Local endpoint: ${Script:LocalBindHost}:$($Script:LocalPort)"
        return
    }

    if ($health.ForeignListener) {
        $foreign = $health.ListenerPids -join ', '
        Write-Host "BLOCKED: port $($Script:LocalPort) is in use by foreign process(es): $foreign"
        Write-Host 'Stop the foreign tunnel manually, then run -Action start again.'
        exit 1
    }

    # Prefer scheduled task if installed
    $task = Get-ScheduledTask -TaskName $Script:TaskName -ErrorAction SilentlyContinue
    if ($null -ne $task) {
        Start-ScheduledTask -TaskName $Script:TaskName
        Write-TunnelLog 'Triggered scheduled task'
        Start-Sleep -Seconds 2
    }
    else {
        $argList = @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', $Script:SelfPath,
            '-Action', 'run'
        )
        $proc = Start-Process -FilePath 'powershell.exe' `
            -ArgumentList $argList `
            -WindowStyle Hidden `
            -PassThru
        Write-TunnelLog "Started detached supervisor PID $($proc.Id)"
        Start-Sleep -Seconds 2
    }

    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        $h = Get-TunnelHealth
        if ($h.PortListening -and $h.SshAlive) { break }
        Start-Sleep -Milliseconds 500
    }

    Invoke-StatusTunnel
    if (-not (Get-TunnelHealth).Healthy) {
        exit 1
    }
}

function Invoke-StopTunnel {
    Ensure-StateDir
    Set-Content -Path $Script:StopFlagFile -Value (Get-Date).ToString('o') -Encoding ASCII

    $pids = Get-ManagedPids

    $sshPid = $pids.SshPid
    if ($sshPid -le 0) { $sshPid = Read-PidFile $Script:SshPidFile }
    if ($sshPid -gt 0 -and (Test-IsOurSshTunnel $sshPid)) {
        try {
            Stop-Process -Id $sshPid -Force -ErrorAction Stop
            Write-TunnelLog "Stopped ssh PID $sshPid"
        }
        catch {
            Write-TunnelLog "WARN: failed to stop ssh PID ${sshPid}: $($_.Exception.Message)"
        }
    }

    $supervisorPid = $pids.SupervisorPid
    if ($supervisorPid -le 0) { $supervisorPid = Read-PidFile $Script:SupervisorPidFile }
    if ($supervisorPid -gt 0 -and (Get-ProcessAlive $supervisorPid)) {
        try {
            Stop-Process -Id $supervisorPid -Force -ErrorAction Stop
            Write-TunnelLog "Stopped supervisor PID $supervisorPid"
        }
        catch {
            Write-TunnelLog "WARN: failed to stop supervisor PID ${supervisorPid}: $($_.Exception.Message)"
        }
    }

    Remove-PidFile $Script:SupervisorPidFile
    Remove-PidFile $Script:SshPidFile

    Start-Sleep -Seconds 1

    if (Test-PortListening) {
        Write-Host "WARN: port $($Script:LocalPort) still listening after stop"
        $listeners = @(Get-PortListenerPids)
        Write-Host "Listener PIDs: $($listeners -join ', ')"
        exit 1
    }

    Write-Host 'VPS SQL tunnel stopped.'
    Write-Host "Port $($Script:LocalPort) is closed."
}

function Invoke-StatusTunnel {
    $health = Get-TunnelHealth
    $tcpOk = Test-PortListening

    if ($health.Healthy) {
        Write-Host 'VPS SQL Tunnel: HEALTHY'
    }
    elseif ($health.SupervisorAlive -or $health.SshAlive -or $health.PortListening) {
        Write-Host 'VPS SQL Tunnel: UNHEALTHY'
    }
    else {
        Write-Host 'VPS SQL Tunnel: STOPPED'
    }

    Write-Host "Local: ${Script:LocalBindHost}:$($Script:LocalPort)"
    Write-Host "Remote: $($Script:SshHost) -> ${Script:RemoteHost}:$($Script:RemotePort)"
    Write-Host "Supervisor PID: $(if ($health.SupervisorAlive) { $health.SupervisorPid } else { '-' })"
    Write-Host "SSH PID: $(if ($health.SshAlive) { $health.SshPid } else { '-' })"
    Write-Host "TCP: $(if ($tcpOk) { 'OK' } else { 'FAIL' })"

    if ($health.ForeignListener) {
        Write-Host "WARN: Foreign listener on port $($Script:LocalPort): $($health.ListenerPids -join ', ')"
    }

    $task = Get-ScheduledTask -TaskName $Script:TaskName -ErrorAction SilentlyContinue
    if ($null -ne $task) {
        $info = Get-ScheduledTaskInfo -TaskName $Script:TaskName
        Write-Host "Scheduled task: $($Script:TaskName) [$($task.State)] lastRun=$($info.LastRunTime)"
    }
    else {
        Write-Host 'Scheduled task: not installed (run -Action install-task)'
    }

    if (Test-Path $Script:LogFile) {
        Write-Host "Log: $Script:LogFile"
    }
}

function Invoke-InstallTask {
    $action = New-ScheduledTaskAction `
        -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$($Script:SelfPath)`" -Action run" `
        -WorkingDirectory $Script:RepoRoot

    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero)

    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask `
        -TaskName $Script:TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description 'Supervised SSH tunnel for local dev SQL (127.0.0.1:14330 -> casher-vps:1433)' `
        -Force | Out-Null

    Write-Host "Installed scheduled task: $($Script:TaskName) (trigger: at logon for $env:USERNAME)"
}

function Invoke-UninstallTask {
    Unregister-ScheduledTask -TaskName $Script:TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled task: $($Script:TaskName)"
}

# ── Dispatch ─────────────────────────────────────────────────────────────────
Ensure-StateDir

switch ($Action) {
    'start'          { Invoke-StartTunnel }
    'stop'           { Invoke-StopTunnel }
    'status'         { Invoke-StatusTunnel }
    'run'            { Invoke-RunSupervisor }
    'install-task'   { Invoke-InstallTask }
    'uninstall-task' { Invoke-UninstallTask }
    default          { Invoke-StatusTunnel }
}
