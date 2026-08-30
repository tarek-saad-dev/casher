#!/bin/bash
set -euo pipefail
pkill -f clpctlWrapper 2>/dev/null || true
curl -fsS http://127.0.0.1:3001/api/whatsapp/status > /tmp/wa-status2.json
python3 - <<'PY'
import json
d=json.load(open('/tmp/wa-status2.json'))
i=d.get('inbox') or {}
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
  'lastPollAt': i.get('lastPollAt'),
  'lastCapturedCount': i.get('lastCapturedCount'),
  'lastText': i.get('lastText'),
  'delivery': i.get('delivery'),
  'deliveryWorker': i.get('deliveryWorker'),
  'lastOutboundAt': diag.get('lastOutboundAt'),
}, indent=2, ensure_ascii=False))
PY
curl -fsS http://127.0.0.1:3001/api/whatsapp/inbox > /tmp/wa-inbox2.json
python3 - <<'PY'
import json
d=json.load(open('/tmp/wa-inbox2.json'))
msgs=d.get('messages') or []
phone='201557994946'
cust=[m for m in msgs if m.get('phone')==phone]
cust.sort(key=lambda m: m.get('receivedAt') or '', reverse=True)
print('customer_msgs_in_api', len(cust))
if cust:
  print('latest_customer', json.dumps({
    'text': cust[0].get('text'),
    'receivedAt': cust[0].get('receivedAt'),
    'capturedAt': cust[0].get('capturedAt'),
    'deliveryStatus': cust[0].get('deliveryStatus'),
    'providerMessageId': cust[0].get('providerMessageId'),
    'remoteJid': ((cust[0].get('rawPayload') or {}).get('baileysKey') or {}).get('remoteJid'),
    'senderPn': ((cust[0].get('rawPayload') or {}).get('baileysKey') or {}).get('senderPn'),
    'fromMe': ((cust[0].get('rawPayload') or {}).get('baileysKey') or {}).get('fromMe'),
    'upsertType': (cust[0].get('rawPayload') or {}).get('upsertType'),
  }, ensure_ascii=False))
print('any_customer_after_1650', any((m.get('receivedAt') or '')>='2026-08-29T16:50' for m in cust))
newest=sorted(msgs, key=lambda m: m.get('capturedAt') or '', reverse=True)[:3]
print('newest_overall')
for m in newest:
  print(m.get('capturedAt'), m.get('phone'), (m.get('text') or '')[:50])
PY
