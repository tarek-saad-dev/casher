#!/bin/bash
set -euo pipefail
cd /home/casher/app
echo "=== PRE ==="
git status -sb
git log -3 --oneline
git rev-parse HEAD
# Show dirty tracked files only
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "TRACKED_DIRTY"
  git diff --stat
  exit 2
fi
echo "TRACKED_CLEAN"
# Remove known untracked tmp scripts that are not in git (safe)
rm -f tmp-*.ts tmp-*.js tmp-*.sh 2>/dev/null || true
echo "=== DEPLOY ==="
sudo -n /usr/local/sbin/deploy-casher
echo "=== POST SHA ==="
git rev-parse HEAD
git log -1 --oneline
