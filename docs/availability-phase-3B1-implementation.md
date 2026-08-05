# Availability Architecture — Phase 3B.1 Implementation

**Date:** 2026-08-03  
**Status:** Complete  
**Base:** Phase 3B workforce UI + Phase 3A daily adjustments  
**Companions:**  
- [`availability-legacy-ui-transition.md`](./availability-legacy-ui-transition.md)  
- [`availability-phase-3B1-deployment-checklist.md`](./availability-phase-3B1-deployment-checklist.md)

This is a completion/hardening phase. No multi-window booking runtime. No drag-and-drop. No resolver redesign.

---

## 1. Executive summary

Phase 3B.1 closes operational gaps:

| Area | Outcome |
|------|---------|
| Permissions | Idempotent ensure + `npm run seed:permissions` / `verify:availability-permissions` |
| History | `status=active\|cancelled\|all` + lazy drawer history with audit names |
| Refresh | `availability:changed` event (same-tab + BroadcastChannel) + ops board subscribe |
| Legacy UI | Disable duplicate schedule-control actions; transition doc |
| Timeline | Read-only day timeline with legend + multi-window note |
| UX / a11y | Confirm dialog, dirty-close warn, error codes, live toasts |
| Ops date | Regression for Cairo 03:59 / 04:00 |

---

## 2. Files added and modified

### Added

| File | Role |
|------|------|
| `src/lib/permissions/workforceAvailabilityPermissions.ts` | Ensure + verify |
| `scripts/seed-permissions.ts` | CLI seed |
| `scripts/verify-availability-permissions.ts` | CLI verify (exit 1 if missing) |
| `src/lib/availability/availabilityChangedEvent.ts` | UI invalidation |
| `src/components/admin/workforce/AvailabilityDayTimeline.tsx` | Read-only timeline |
| `src/components/admin/workforce/WorkforceConfirmDialog.tsx` | Accessible confirm |
| `src/lib/__tests__/availabilityPhase3B1.test.ts` | Tests |
| `docs/availability-phase-3B1-implementation.md` | This report |
| `docs/availability-legacy-ui-transition.md` | Legacy action matrix |
| `docs/availability-phase-3B1-deployment-checklist.md` | Deploy checklist |

### Modified (selected)

| File | Change |
|------|--------|
| `package.json` | npm scripts |
| `permissions/seed/route.ts` | Calls ensure after full seed |
| `dailyAdjustments.ts` / `dailyAdjustmentService.ts` | History types + `listDailyAdjustmentHistory` |
| `daily-adjustments/route.ts` | `status` query |
| `WorkforceAvailabilityPage.tsx` | Events, errors, emit |
| `AvailabilityExplainDrawer.tsx` | Tabs, timeline, lazy history, confirm |
| `DailyAdjustmentHistory.tsx` | Cancelled badge / audit |
| `DailyAdjustmentModal.tsx` | Dirty close warn |
| `ScheduleControlModal.tsx` | Disable day_off/custom_hours/block_range create |
| `operations/page.tsx` | Subscribe refresh |
| `workforce-day/route.ts` | DEV timing log |

---

## 3. Permission deployment safety

- Page key: `hr.workforce_availability`
- Expected roles: `super_admin`, `admin`, `manager`, `receptionist`
- Grants use `IF NOT EXISTS` — never deletes custom `TblPageRoleAccess` rows
- Commands:
  - `npm run seed:permissions`
  - `npm run verify:availability-permissions` (non-zero when missing)
- No auto-grant on every HTTP request

---

## 4. Adjustment history

```http
GET /api/admin/availability/daily-adjustments?date=&empId=&status=active|cancelled|all
```

Default `active`. History includes `isActive`, cancel audit, creator/canceller names (one user `IN` query). Resolver / `loadDailyAdjustmentsBatch` still **active only**.

Drawer tabs: **التعديلات الحالية** | **السجل** (lazy `status=all`).

---

## 5. Browser invalidation design

- Event name: `availability:changed`
- APIs: `emitAvailabilityChanged` / `subscribeAvailabilityChanged`
- In-process listeners + `CustomEvent` + `BroadcastChannel`
- Debounce ~400ms (anti-loop)
- Server `invalidateEmployeeScheduleCaches` remains authoritative
- Workforce page + `/operations` refresh when `businessDate` matches

---

## 6. Legacy UI transition

See `availability-legacy-ui-transition.md`. ScheduleControlModal disables create for `day_off` / `custom_hours` / `block_range`. Attendance restore / late_start / early_leave kept.

---

## 7. Timeline visualization

`AvailabilityDayTimeline`: working windows, blocks, attendance markers, current-time marker on current business date, textual legend + `role="img"` alt. Multi-window note clarifies Phase 3C runtime gap. Read-only.

---

## 8. UX and accessibility hardening

- Skeletons, retry + technical code details
- `WorkforceConfirmDialog` replaces `window.confirm` for cancel
- Dirty modal close warning
- Live region toasts
- History cancel `aria-describedby`

---

## 9. Operational-date audit

- UI uses `getOperationalDate` / `shiftCalendarDate`
- Tests: Cairo 03:59 → previous day; 04:00 → calendar day
- Payroll 5 AM unchanged

---

## 10. API query flow

**Workforce-day:** roster SQL → one `resolveEmployeeDayPlansBatch` → pure `explainEmployeeDayPlan` per emp (no second resolve). DEV timing log.

**History:** opened only from drawer tab → headers + windows + user names (batched). Not on initial board load.

---

## 11. Tests and exact results

```text
npx vitest run availabilityPhase3B1 → 15 passed
npx vitest run Phase01+2+25+3A+3B+3B1+bookingMoveValidation → 119 passed
```

`npx tsc --noEmit`: Phase 3B.1 production files clean (pre-existing unrelated test errors remain).

---

## 12. Deployment steps

Follow [`availability-phase-3B1-deployment-checklist.md`](./availability-phase-3B1-deployment-checklist.md).

---

## 13. Known limitations

- No restore of cancelled adjustments  
- No Phase 3C multi-window booking generation  
- BroadcastChannel unsupported browsers rely on same-tab event + polling  
- BookingControlDrawer deprecation messaging only (chips not fully disabled there)

---

## 14. Phase 3C readiness

Ready for multi-window booking/queue runtime that consumes **all** effective windows, retiring primary-window-only product shortcuts.

---

```text
PHASE 3B.1 COMPLETE

WORKFORCE UI OPERATIONALLY HARDENED

PERMISSIONS, HISTORY, REFRESH, AND LEGACY TRANSITION COMPLETE

READY FOR PHASE 3C MULTI-WINDOW RUNTIME
```
