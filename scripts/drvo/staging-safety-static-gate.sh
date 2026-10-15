#!/usr/bin/env bash
# Fail closed if the staging guard is removed or its required environment flags drift.
# Static check only: NOT proof of outbound isolation.
set -euo pipefail
proxy=src/proxy.ts
preflight=scripts/drvo/staging-config-preflight.sh
test -f "$proxy" && test -f "$preflight"
for token in DRVO_STAGING_MODE DRVO_STAGING_OUTBOUND_DISABLED DRVO_STAGING_WORKERS_DISABLED DRVO_STAGING_CRON_DISABLED STAGING_SAFETY_ENFORCE; do
  grep -Fq "$token" "$proxy" || { echo "FAIL: proxy missing $token"; exit 1; }
  grep -Fq "$token" "$preflight" || { echo "FAIL: preflight missing $token"; exit 1; }
done
grep -Fq "pathname.startsWith('/api/')" "$proxy" || { echo "FAIL: staging API gate missing"; exit 1; }
grep -Fq "Staging preview API disabled until isolation is verified" "$proxy" || { echo "FAIL: fail-closed staging gate missing"; exit 1; }
echo "STAGING_STATIC_SAFETY_GATE_PASS"
echo "NOTICE: runtime outbound isolation and background workers still require independent testing."
