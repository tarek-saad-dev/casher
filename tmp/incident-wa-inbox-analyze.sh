#!/bin/bash
set -euo pipefail
curl -fsS http://127.0.0.1:3001/api/whatsapp/inbox > /tmp/wa-inbox.json
python3 <<'PY'
import json
from datetime import datetime, timezone
d=json.load(open('/tmp/wa-inbox.json'))
msgs=d.get('messages') or []
print('count_field', d.get('count'), 'messages_len', len(msgs))
print('lastPollAt', d.get('lastPollAt'))
print('lastCapturedCount', d.get('lastCapturedCount'))
print('delivery', d.get('delivery'))
print()
# all for canary phone
phone='201557994946'
lid='92449473073158'
hits=[]
for m in msgs:
    raw=json.dumps(m, ensure_ascii=False)
    if phone in raw or lid in raw or 'جليم' in raw or 'متاح' in (m.get('text') or ''):
        hits.append(m)
print('HITS_FOR_CUSTOMER_OR_GLEEM', len(hits))
for m in hits[:30]:
    print(json.dumps({
      'phone': m.get('phone'),
      'text': m.get('text'),
      'receivedAt': m.get('receivedAt'),
      'capturedAt': m.get('capturedAt'),
      'deliveredAt': m.get('deliveredAt'),
      'deliveryStatus': m.get('deliveryStatus'),
      'providerMessageId': m.get('providerMessageId'),
      'upsertType': (m.get('rawPayload') or {}).get('upsertType'),
      'fromMe': ((m.get('rawPayload') or {}).get('baileysKey') or {}).get('fromMe'),
      'remoteJid': ((m.get('rawPayload') or {}).get('baileysKey') or {}).get('remoteJid'),
      'senderPn': ((m.get('rawPayload') or {}).get('baileysKey') or {}).get('senderPn'),
    }, ensure_ascii=False))
print()
# newest overall
msgs_sorted=sorted(msgs, key=lambda x: x.get('capturedAt') or '', reverse=True)
print('NEWEST_5')
for m in msgs_sorted[:5]:
    print(m.get('capturedAt'), m.get('phone'), (m.get('text') or '')[:60], m.get('deliveryStatus'))
# any after 16:50 UTC for canary phone
print()
print('AFTER_1650_UTC_CANARY')
for m in msgs:
    if m.get('phone')==phone and (m.get('receivedAt') or '') >= '2026-08-29T16:50':
        print(json.dumps(m, ensure_ascii=False)[:500])
print('NONE' if not any(m.get('phone')==phone and (m.get('receivedAt') or '') >= '2026-08-29T16:50' for m in msgs) else 'HAS')
# quarantine/failed
print()
print('NON_DELIVERED')
for m in msgs:
    if m.get('deliveryStatus') not in ('delivered', None, 'pending'):
        if phone in json.dumps(m) or lid in json.dumps(m):
            print(m.get('deliveryStatus'), m.get('phone'), m.get('text'), m.get('providerMessageId'))
PY

# try more endpoints
for p in /api/whatsapp/inbox?limit=500 /api/whatsapp/inbox/all /api/whatsapp/inbox/quarantined /api/whatsapp/inbox/failed /api/whatsapp/spool/stats /api/whatsapp/lid-map /api/whatsapp/lid; do
  code=$(curl -sS -o /tmp/r.txt -w '%{http_code}' --max-time 3 "http://127.0.0.1:3001$p" || true)
  echo "ENDPOINT $p -> $code $(head -c 120 /tmp/r.txt | tr '\n' ' ')"
done
