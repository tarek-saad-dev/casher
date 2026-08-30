#!/bin/bash
set -euo pipefail
PID=$(systemctl show whatsapp-bot.service -p MainPID --value)
echo "pid=$PID"
echo "=== /proc cwd/data ==="
ls -la "/proc/$PID/cwd/data/" 2>&1 | head -30 || true
echo "=== try cat spool head ==="
# readable?
if head -c 200 "/proc/$PID/cwd/data/inbox-spool.json" 2>/dev/null; then
  echo
  echo SPOOL_READABLE_VIA_PROC
else
  echo SPOOL_NOT_READABLE_VIA_PROC
fi
# try fd for the json file
echo "=== fds matching spool ==="
ls -la "/proc/$PID/fd" 2>&1 | head -5 || true
python3 - <<PY
import os, json
pid=os.environ.get('PID') or '''$PID'''
# fix
pid=open('/proc/self/cmdline','rb').read()  # noop
pid='$PID'
base=f'/proc/{pid}/cwd/data'
print('list attempt')
try:
  print(os.listdir(base))
except Exception as e:
  print('list_err', e)
path=f'{base}/inbox-spool.json'
try:
  with open(path,'r',encoding='utf-8') as f:
    data=json.load(f)
  recs=data.get('records') or []
  print('spool_records', len(recs), 'updatedAt', data.get('updatedAt'))
  phone='201557994946'
  lid='92449473073158'
  hits=[]
  for r in recs:
    s=json.dumps(r, ensure_ascii=False)
    if phone in s or lid in s or 'جليم' in s:
      hits.append({
        'providerMessageId': r.get('providerMessageId'),
        'status': r.get('status'),
        'phone': r.get('phone'),
        'text': (r.get('text') or '')[:80],
        'receivedAt': r.get('receivedAt') or r.get('capturedAt'),
        'deliveredAt': r.get('deliveredAt'),
        'lastError': r.get('lastError'),
        'quarantinedAt': r.get('quarantinedAt'),
      })
  print('HITS', len(hits))
  for h in sorted(hits, key=lambda x: x.get('receivedAt') or '', reverse=True)[:15]:
    print(json.dumps(h, ensure_ascii=False))
  print('AFTER_1650')
  for h in hits:
    if (h.get('receivedAt') or '') >= '2026-08-29T16:50':
      print(json.dumps(h, ensure_ascii=False))
except Exception as e:
  print('read_err', type(e).__name__, e)
PY
