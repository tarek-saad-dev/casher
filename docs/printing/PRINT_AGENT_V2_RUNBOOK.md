# CUT Salon Print Agent V2 — rollout and recovery (no automatic deployment)

## Scope and safety gates

This branch is review-only. It must not merge or deploy until a human reviews CI, the Windows installer, and a physical XP-80 print. Merge into main is a production deployment trigger in this repo; do not merge automatically.

V2 version: `2.0.0` from `print-service/package.json`; browser expects the same version.

## Current behavior

- Chrome Loopback: site requests `loopback-network` permission only on an explicit button click if not previously granted. Browser network failures **cannot prove** CORS vs LNA vs Agent down. On supported Chrome, fetch declares `targetAddressSpace: 'loopback'`. Older browsers ignore it. The **exact** website origin must remain allowed by Agent CORS.
- `GET /health`: process-only liveness and version, not printer readiness.
- `GET /settings`: reports version and local on/off/settings, printer name and queues.
- `GET /diagnostics`: read-only PowerShell Get-Printer / Get-Service Spooler / Get-PrintJob probe. `printerFound`, `spoolerStatus` and `queuedJobs` are best-effort; physical paper status is always `unknown`.
- Repair tool: detects a version mismatch, validates local printer name without choosing ambiguous devices, downloads/stages dependencies, stops only the managed scheduled task, swaps app files, registers user-login autostart and validates V2 /health + /settings. On failure, attempts rollback of prior files, user config and scheduled task. Print policy settings remain in `%LOCALAPPDATA%\CUT-Salon\print-settings.json`.
- Supervisor: `run-agent.ps1` keeps the Node process running with bounded restart backoff. Task Scheduler provides logon-start and up to three retries if the PowerShell runner itself exits. This is **not** a guarantee of nonstop availability before Windows login.
- Printer selection: exact `XP-80` preferred; otherwise auto-select only one matching receipt printer. If ambiguous, explicit `-PrinterName '...' ` is required. Stored in `%LOCALAPPDATA%\CUT-Salon\print-agent.config.json`. Printer drivers are not installed/changed.

## Critical release note

The Windows repair installer downloads the official `main.zip` and **checks that the downloaded print-service/package.json is exactly V2** before replacing anything. Until main has V2, that repair is expected to refuse an update without modifying the current install. No production PC should run the V2 installer from a draft PR.

A signed, pinned release installer is recommended before broad rollout. As currently written, fetching the moving `main` requires trust in repository governance.

## Required pre-merge checks

1. Linux CI: `npm ci --prefix print-service`, `npm test --prefix print-service`, `PRINT_ENGINE=escpos PRINT_ADAPTER=mock npm test --prefix print-service`.
2. Web CI: `npx vitest run src/lib/__tests__/localPrintClient.test.ts src/lib/__tests__/localPrintAgentV2.test.ts src/components/printing/__tests__/LocalPrintConnectionHelp.test.tsx`.
3. Windows CI: parse all V2 PowerShell scripts without executing system mutations.
4. Review use of browser permissions, rollback and CORS constraints; no print route on `0.0.0.0`.
5. Physical Windows cashier PC: capture `/health`, `/settings`, `/diagnostics` before/after; verify one readable Arabic/English receipt and cutter; restart Windows, log in and re-test. Validate failed install rollback in a non-production Windows VM. Test printer disconnected/reconnected.
6. Roll out one machine at a time with a manual rollback plan. Version changes on VPS do not update a pre-existing Windows Agent.

## On-site diagnosis

On the cashier Windows PC (never from the VPS):
- Open `http://127.0.0.1:7788/health` in Chrome. If unreachable: check Task Scheduler `CUT Salon Print Agent`, running account and `print-service/logs/print-agent.log`.
- If health works but Cashier fails: check Chrome site settings `Loopback network` permission and DevTools blocked CORS/mixed-content errors, and `ALLOWED_ORIGINS`.
- If health shows 1.x but website expects 2.0.0: repair is required **after approved release**; no reinstall solely based on an old V1 healthy response.
- If Agent works but no paper: inspect `/diagnostics` and physical printer/USB, Windows queue and thermal self-test. A spool ACK is not a paper receipt.
- If Agent crashes: inspect log before repair; Task Scheduler status alone does not prove its Node child survived.

Never publish TCP/7788 or SMB/445 to the internet. Remote branch printing belongs to a separately authenticated outbound queue design.
