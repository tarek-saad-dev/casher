#!/bin/bash
set -euo pipefail
cd /home/whatsapp/whatsapp-bot
echo "=== LID MAP RELEVANT ==="
python3 <<'PY'
import json
from pathlib import Path
p = Path('data/lid-phone-map.json')
print('exists', p.exists(), 'size', p.stat().st_size if p.exists() else 0)
d = json.loads(p.read_text(encoding='utf-8'))
print('type', type(d).__name__)
if isinstance(d, dict):
    # common shapes: {lid: phone} or {mappings: [...]}
    if 'mappings' in d:
        rows = d['mappings']
        print('mappings_count', len(rows) if isinstance(rows, list) else type(rows))
        for row in (rows if isinstance(rows, list) else []):
            s = json.dumps(row, ensure_ascii=False)
            if '92449473073158' in s or '1557994946' in s or '201557994946' in s:
                print('HIT', s)
    else:
        print('top_keys', list(d.keys())[:20])
        for k,v in d.items():
            s = f'{k}->{v}'
            if '92449473073158' in s or '1557994946' in s or '201557994946' in s:
                print('HIT', s)
        # also search nested
        raw = json.dumps(d, ensure_ascii=False)
        print('contains_lid', '92449473073158' in raw)
        print('contains_phone', '201557994946' in raw or '1557994946' in raw)
elif isinstance(d, list):
    print('list_len', len(d))
    for row in d:
        s = json.dumps(row, ensure_ascii=False)
        if '92449473073158' in s or '1557994946' in s or '201557994946' in s:
            print('HIT', s)
PY

echo
echo "=== DATA TREE ==="
find data -maxdepth 3 -type f 2>/dev/null | head -80
echo
echo "=== SPOOL / QUEUE FILES ==="
find data -iname '*spool*' -o -iname '*inbox*' -o -iname '*queue*' -o -iname '*deliver*' 2>/dev/null | head -40
ls -la data/inbox-spool 2>/dev/null || true
ls -la data/spool 2>/dev/null || true
ls -la data/baileys-inbox 2>/dev/null || true
