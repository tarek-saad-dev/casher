#!/usr/bin/env bash
# DRVO staging acceptance preflight. Read-only checks only.
set -Eeuo pipefail
WORKDIR=/home/casher/drvo-clinics-work
ENVFILE=/home/casher/.config/drvo-staging.env
SQLCMD=/opt/mssql-tools18/bin/sqlcmd
[[ "$(id -u)" -eq 0 ]] || { echo "Run as root on the staging VPS"; exit 2; }
[[ -f "$ENVFILE" && -f "$WORKDIR/docs/drvo/staging-tenant-operations-preflight.sql" ]] || exit 2
set -a
# shellcheck disable=SC1090
source "$ENVFILE"
set +a
[[ "${DRVO_STAGING_MODE:-}" == true && "${STAGING_SAFETY_ENFORCE:-}" == true &&
   "${STAGING_SAFETY_DB_NAME:-}" == last132_agent &&
   "${DB_NAME:-}" == last132_agent && "${DB_DATABASE:-}" == last132_agent &&
   "${DB_USER:-}" == drvo_agent ]] || { echo "FAIL: staging safety identity"; exit 3; }
[[ "${DRVO_STAGING_OUTBOUND_DISABLED:-}" == true &&
   "${DRVO_STAGING_WORKERS_DISABLED:-}" == true &&
   "${DRVO_STAGING_CRON_DISABLED:-}" == true ]] || { echo "FAIL: staging isolation"; exit 3; }
echo "PASS: staging environment safety"
systemctl is-active --quiet drvo-erp-staging.service || { echo "FAIL: staging service inactive"; exit 4; }
echo "PASS: staging service active"
cd "$WORKDIR"
echo "HEAD: $(git rev-parse --short HEAD)"
echo "BRANCH: $(git branch --show-current)"
[[ "$(git branch --show-current)" == feature/drvo-clinics-mvp ]] || exit 5
export SQLCMDPASSWORD="${DB_PASSWORD:?DB_PASSWORD missing}"
"$SQLCMD" -S "tcp:${DB_SERVER},${DB_PORT}" -U "$DB_USER" -d last132_agent -C -b \
  -i "$WORKDIR/docs/drvo/staging-tenant-operations-preflight.sql"
unset SQLCMDPASSWORD
echo "PASS: read-only SQL structural checks"
echo "NEXT: independently verify recoverable backup, then browser E2E using test accounts"
