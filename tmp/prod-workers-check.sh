#!/bin/bash
cd /home/casher/app
echo casher=$(systemctl is-active casher)
echo inbox=$(systemctl is-active messaging-inbox-worker.service)
echo ai=$(systemctl is-active messaging-ai-worker.service)
systemctl is-active messaging-worker.service > /tmp/outbox_sys.txt 2>/dev/null || echo inactive > /tmp/outbox_sys.txt
echo outbox_sys=$(cat /tmp/outbox_sys.txt)
XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user is-active messaging-worker.service > /tmp/outbox_user.txt 2>/dev/null || echo inactive > /tmp/outbox_user.txt
echo outbox_user=$(cat /tmp/outbox_user.txt)
echo ---pids---
pgrep -af messaging-inbox-worker || true
pgrep -af messaging-ai-worker || true
pgrep -af messaging-outbox-worker || true
pgrep -af scripts/messaging || true
echo ---ai-log---
journalctl -u messaging-ai-worker --no-pager -n 30
echo ---inbox-log---
journalctl -u messaging-inbox-worker --no-pager -n 15