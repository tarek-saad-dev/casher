#!/usr/bin/env bash
# Phase 2.2 — inspect SQL listeners on the VPS SQL host (safe, no secrets).
set -euo pipefail

echo "[vps-inspect-sql-listeners] host=$(hostname) at=$(date -Is)"

if command -v ss >/dev/null 2>&1; then
  echo "--- TCP listeners (1433/14330) ---"
  ss -tlnp 2>/dev/null | grep -E ':1433|:14330' || echo "(no 1433/14330 listeners found via ss)"
fi

if command -v systemctl >/dev/null 2>&1; then
  echo "--- mssql-server.service ---"
  systemctl is-active mssql-server.service 2>/dev/null || true
  systemctl status mssql-server.service --no-pager -n 3 2>/dev/null || true
fi

if command -v sqlcmd >/dev/null 2>&1; then
  echo "--- local native sqlcmd SELECT 1 ---"
  /usr/bin/time -f 'elapsed_ms=%e' sqlcmd -S localhost,1433 -Q "SET NOCOUNT ON; SELECT 1 AS n;" -W -h-1 2>/dev/null || \
    echo "sqlcmd localhost,1433 failed (credentials/instance may differ)"
else
  echo "sqlcmd not installed — skip native client probe"
fi

echo "--- Node runtime ---"
node -v 2>/dev/null || true
echo "cwd=${PWD}"
