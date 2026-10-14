#!/usr/bin/env bash
# Read-only fail-closed staging configuration preflight.
set -euo pipefail
envfile=/home/casher/.config/drvo-staging.env
[[ -f "$envfile" ]] || { echo "FAIL: staging env absent"; exit 1; }
[[ "$(stat -c %a "$envfile")" == 600 ]] || { echo "FAIL: staging env permissions"; exit 1; }
[[ "$(stat -c %U "$envfile")" == casher ]] || { echo "FAIL: staging env owner"; exit 1; }
# Do not source the file: values may be shell-escaped and sourcing can execute code.
required=(
  STAGING_SAFETY_ENFORCE=true
  STAGING_SAFETY_DB_NAME=last132_agent
  HAWAI_DB_CLASS=local
  DB_NAME=last132_agent
  DB_DATABASE=last132_agent
  LOCAL_DB_NAME=last132_agent
  CLOUD_DB_NAME=last132_agent
  DRVO_STAGING_MODE=true
  DRVO_STAGING_OUTBOUND_DISABLED=true
  DRVO_STAGING_WORKERS_DISABLED=true
  DRVO_STAGING_CRON_DISABLED=true
)
for entry in "${required[@]}"; do
  grep -Fxq "$entry" "$envfile" || { echo "FAIL: required staging setting missing: ${entry%%=*}"; exit 1; }
done
for key in DB_PASSWORD LOCAL_DB_PASSWORD CLOUD_DB_PASSWORD; do
  grep -Eq "^$key=." "$envfile" || { echo "FAIL: $key not configured"; exit 1; }
done
echo "STAGING_CONFIG_PREFLIGHT_PASS"
echo "WARNING: configuration preflight does NOT prove outbound side effects are disabled in application code."
