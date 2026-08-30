#!/bin/bash
set -euo pipefail
echo "=== STATUS ==="
curl -fsS --max-time 8 http://127.0.0.1:3001/api/whatsapp/status | python3 -m json.tool 2>/dev/null | head -120
echo
echo "=== LISTENER COUNTS ==="
curl -fsS --max-time 8 http://127.0.0.1:3001/api/whatsapp/status | python3 -c "
import sys,json
d=json.load(sys.stdin)
diag=d.get('diagnostics') or {}
print('messagesUpsertListeners', diag.get('messagesUpsertListeners'))
print('connectGeneration', diag.get('connectGeneration'))
print('reconnectAttempts', d.get('reconnectAttempts'))
print('lastConnectedAt', d.get('lastConnectedAt'))
print('lastDisconnectAt', d.get('lastDisconnectAt'))
print('unresolvedLidCount', d.get('unresolvedLidCount'))
print('lidMappings', d.get('lidMappings'))
inbox=d.get('inbox') or {}
print('delivery', inbox.get('delivery'))
print('deliveryWorker', inbox.get('deliveryWorker'))
print('lastPollAt', inbox.get('lastPollAt'))
print('lastCapturedCount', inbox.get('lastCapturedCount'))
print('lastText', inbox.get('lastText'))
"
echo
echo "=== JOURNAL 19:45-20:15 EEST ==="
journalctl -u whatsapp-bot.service --since "2026-08-29 19:45" --until "2026-08-29 20:15" --no-pager 2>&1 | tail -250
echo
echo "=== KEYWORD SEARCH 4H ==="
journalctl -u whatsapp-bot.service --since "4 hours ago" --no-pager 2>&1 | grep -E 'messages\.upsert|baileys_captured|baileys_inbound_ignored|unresolved_lid|fromMe|not_live_notify|protocol_or_system|locally_queued|delivered_to_erp|92449473073158|1557994946|201557994946|فرع|جليم|مين متاح|حاليا|webhook|spool' | tail -120
