# Phase 1N — Readiness Hardening

`evaluateBranchReadiness` now uses **blockers only** for gates (score is informational).

## New smoke blockers
- `smoke.operator`, `smoke.work_schedule`, `smoke.service_price`, `smoke.service_duration`
- `smoke.payment_method`, `smoke.treasury_container`, `smoke.inventory_container`, `smoke.product`
- `smoke.queue_settings`, `smoke.notifications_off`, `smoke.public_booking_off`
- `smoke.artifact_registry`, `smoke.cleanup_path`, `smoke.gleem_baseline`
- Existing: `smoke.assignment`, `payroll.plan_coverage`

## Internal live blockers
- Business decisions: `biz.address`, `biz.operating_hours`, `biz.opening_cash`, `biz.opening_inventory`, `biz.printer_policy`, `biz.whatsapp_policy`, `biz.partner_shares`, `biz.real_employees`
- `internal.passed_smoke_run` + `proof.*` keys from `INTERNAL_LIVE_SMOKE_PROOF_KEYS`

## Public live
- `public.frontend_multi_branch` is a **blocker** (not warning)
- Plus public booking flag rules and business decisions

Policy module: `src/lib/branch/smokeBranchPolicy.ts`
