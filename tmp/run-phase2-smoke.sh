#!/bin/bash
set -euo pipefail
cd /home/casher/app
ls node_modules/tsx/package.json
ls -la node_modules/.bin/tsx || true
npm exec -- tsx /home/casher/app/tmp-prod-phase2-tools-smoke.ts
