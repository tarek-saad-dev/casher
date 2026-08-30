#!/bin/bash
set -euo pipefail
echo "=== CLP COMMANDS ==="
sudo -n /usr/bin/clpctlWrapper list 2>&1 | head -80 || true
sudo -n /usr/bin/clpctlWrapper 2>&1 | head -80 || true
echo "=== BOT GIT ==="
cd /home/whatsapp/whatsapp-bot
git remote -v
git log -1 --oneline
git rev-parse HEAD
echo "=== TRY READ SPOOL VIA FIND WORLD ==="
find /home/whatsapp/whatsapp-bot/data -type f 2>&1 | head
# maybe ACL for casher somewhere
getfacl /home/whatsapp/whatsapp-bot/data 2>&1 | head -20 || true
