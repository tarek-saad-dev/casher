# VPS SQL SSH Tunnel (Windows development)

Local development reaches the VPS SQL Server through a forwarded port:

```
127.0.0.1:14330  →  SSH (casher-vps)  →  127.0.0.1:1433
```

The tunnel is managed by `scripts/vps-sql-tunnel.ps1`. It uses your existing SSH config host **`casher-vps`** (no passwords or keys in the repo).

## One-time setup (logon auto-start)

```powershell
powershell -ExecutionPolicy Bypass -File scripts/vps-sql-tunnel.ps1 -Action install-task
```

This registers the Windows scheduled task **`CUT-VPS-SQL-Tunnel`** for the current user at logon.

## Daily commands

**Start** (detached supervisor — safe to close the terminal):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/vps-sql-tunnel.ps1 -Action start
```

**Status** (checks supervisor, ssh, and TCP on 14330):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/vps-sql-tunnel.ps1 -Action status
```

**Stop** (only stops this tunnel’s supervisor/ssh tree):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/vps-sql-tunnel.ps1 -Action stop
```

## Notes

- You do **not** need to keep a Cursor/terminal SSH session open.
- The supervisor auto-reconnects if SSH drops (bounded delay, no tight restart loop).
- A second `start` does not create duplicate tunnels.
- Runtime state and logs live under `%LOCALAPPDATA%\casher\vps-sql-tunnel\` (not committed to git).
- **Production on the VPS** still uses local SQL on port **1433** — only dev machines use **14330**.

## App configuration

`.env.local` should point at the tunnel:

```env
LOCAL_DB_SERVER=127.0.0.1
LOCAL_DB_PORT=14330
DB_SERVER=127.0.0.1
DB_PORT=14330
```
