#!/bin/bash
set -euo pipefail
echo "=== NOW ==="
date -u
date
echo "=== STATUS SNAPSHOT ==="
curl -fsS http://127.0.0.1:3001/api/whatsapp/status > /tmp/wa-status.json
python3 - <<'PY'
import json
d=json.load(open('/tmp/wa-status.json'))
diag=d.get('diagnostics') or {}
print(json.dumps({
  'ready': d.get('ready'),
  'connected': d.get('connected'),
  'transport': d.get('transport'),
  'qrRequired': d.get('qrRequired'),
  'authLoaded': d.get('authLoaded'),
  'reconnectAttempts': d.get('reconnectAttempts'),
  'lastConnectedAt': d.get('lastConnectedAt'),
  'lastDisconnectAt': d.get('lastDisconnectAt'),
  'lidMappings': d.get('lidMappings'),
  'unresolvedLidCount': d.get('unresolvedLidCount'),
  'messagesUpsertListeners': diag.get('messagesUpsertListeners'),
  'connectGeneration': diag.get('connectGeneration'),
  'lastPollAt': (d.get('inbox') or {}).get('lastPollAt'),
  'lastCapturedCount': (d.get('inbox') or {}).get('lastCapturedCount'),
  'delivery': (d.get('inbox') or {}).get('delivery'),
  'deliveryWorker': (d.get('inbox') or {}).get('deliveryWorker'),
  'lastOutboundAt': diag.get('lastOutboundAt'),
}, indent=2, ensure_ascii=False))
PY

echo "=== TRY SUDO JOURNAL NOPASSWD ==="
sudo -n journalctl -u whatsapp-bot.service --since "2026-08-29 19:50" --until "2026-08-29 20:15" --no-pager 2>&1 | tail -5 || true
sudo -n /usr/bin/journalctl -u whatsapp-bot.service -n 5 --no-pager 2>&1 | tail -5 || true

echo "=== TRY RUNUSER/WHATSAPP ==="
# readable files under bot via namei
namei -l /home/whatsapp/whatsapp-bot/data 2>&1 | head -20 || true
# check if any world-readable logs
find /home/whatsapp/whatsapp-bot -maxdepth 2 -type f -perm -004 2>/dev/null | head -30 || true
find /tmp -name '*whatsapp*' -o -name '*baileys*' 2>/dev/null | head -20 || true

echo "=== SUDOERS HINTS ==="
# only list what we can
ls /etc/sudoers.d 2>&1 || true
grep -r casher /etc/sudoers.d 2>&1 | head -20 || true
