# Availability Architecture — Phase 3B Implementation

**Date:** 2026-08-03  
**Status:** Complete  
**Base:** Phase 3A daily adjustments + Phase 2.5 explain/hardening  
**Companion:** [`availability-daily-adjustment-migration-map.md`](./availability-daily-adjustment-migration-map.md)

This phase ships the first production **workforce availability UI**. No resolver redesign, no schema changes, no drag-and-drop.

---

## 1. Executive summary

Operators can manage same-day availability from one Arabic RTL page:

| Capability | How |
|------------|-----|
| View branch employees for a business date | `GET /api/admin/availability/workforce-day` |
| See effective windows, blocks, attendance, deny reasons | Canonical day-plan + explain |
| Create `CLOSE_DAY` / `REPLACE_WINDOWS` / `ADD_WINDOW` / `BLOCK_WINDOW` | Phase 3A admin APIs |
| Soft-cancel adjustments | `DELETE …/daily-adjustments/{id}` |
| Understand “why” | Explain drawer over `explainEmployeeDayPlan` |

Branch is always session-scoped. Status badges are derived from day-plan fields — not recalculated in the UI.

---

## 2. Routes and navigation

| Item | Value |
|------|--------|
| Page | `/admin/workforce/availability` |
| Nav | الموارد البشرية → **توافر الموظفين** |
| Guard | `PageGuard` + permissions seed `hr.workforce_availability` |
| Roles (seed) | `super_admin`, `admin`, `manager`, `receptionist` |

Re-run permissions seed (`POST /api/admin/permissions/seed`) after deploy so non–super-admin roles receive the page key.

---

## 3. Files added and modified

### Added

| File | Role |
|------|------|
| `src/app/admin/workforce/availability/page.tsx` | Route |
| `src/app/admin/workforce/availability/layout.tsx` | PageGuard |
| `src/app/api/admin/availability/workforce-day/route.ts` | Read API |
| `src/lib/availability/workforceDay.ts` | Batch loader |
| `src/lib/availability/workforceUiLabels.ts` | Status / Arabic labels |
| `src/lib/availability/timeWindowEditorUtils.ts` | Client window validation |
| `src/components/admin/workforce/*` | Header, grid, card, modal, editor, drawer, history, badges, chips |
| `src/lib/__tests__/availabilityPhase3B.test.ts` | Contract + unit tests |
| `docs/availability-phase-3B-implementation.md` | This report |

### Modified

| File | Change |
|------|--------|
| `nav-config.ts` | Nav link |
| `permissions/seed/route.ts` | Page + role grants |
| `dailyAdjustmentService.ts` | Invalidate schedule caches after create/cancel |
| `ScheduleControlModal.tsx` | Deprecation note → new page |
| `BookingControlDrawer.tsx` | Deprecation note → new page |

---

## 4. Workforce-day API contract

```http
GET /api/admin/availability/workforce-day?date=YYYY-MM-DD
```

- Auth: `requirePageAccess('/admin/workforce/availability')` with `/admin` fallback  
- Branch: `requireBranchOperationAccess()` — never from query  
- Roster: assigned barbers + temporary transfers-in  
- Plans: **one** `resolveEmployeeDayPlansBatch`  
- Explain: `explainEmployeeDayPlan(plan)` only (no second resolve)  
- Payload includes `uiStatus`, `reasonLabelAr`, `dayPlan`, `dailyAdjustments`, `explanation`

---

## 5. Employee card model

Each card shows: name, job, status badge, base source, weekly window, effective windows, blocked count, attendance, adjustment state, overnight chip, reason, active adjustment badges, actions (close / replace / add / block / details).

Status keys (from day-plan): متاح، متاح جزئيًا، إجازة، غائب، اليوم مغلق، بدون جدول، خارج ساعات العمل، غير متاح.

---

## 6. Adjustment modal behavior

`DailyAdjustmentModal` + `TimeWindowEditor`:

- `CLOSE_DAY` — no windows; confirmation copy about blocking bookings/queue  
- Other types — require ≥1 window; overnight toggle / `endDayOffset`  
- Client validation + Arabic server errors  
- Submit disabled while saving; duplicate submit blocked  

Writes only via Phase 3A APIs (no legacy override writes).

---

## 7. Overnight handling

- Explicit `endDayOffset: 0 | 1` in payloads  
- Toggle “ينتهي في اليوم التالي”  
- Preview: `22:00 ← 02:00 اليوم التالي`  
- Inference when end ≤ start if offset omitted  

---

## 8. Explain drawer

Sections: النتيجة الحالية، مصدر الجدول، مراحل الحساب (mapped timeline steps), النوافذ الفعلية، الفترات المحظورة، الحضور، التعديلات (+ soft-cancel), التحذيرات.

Timeline is canonical — UI does not invent steps.

---

## 9. Permissions and branch scoping

- Page: PageGuard + seeded ACL  
- Mutations: existing daily-adjustment routes (session branch, eligibility check, `CreatedBy` / `CancelledBy` from auth)  
- Client never sends `branchId`  

---

## 10. Legacy UI coexistence

`ScheduleControlModal` and `BookingControlDrawer` remain for legacy overrides, with a visible note linking to `/admin/workforce/availability`. No automatic migration.

---

## 11. Mutation refresh behavior

After create/cancel:

1. Soft toast  
2. Re-fetch workforce-day for the **same** `selectedDate`  
3. `invalidateEmployeeScheduleCaches` so ops board / public settings bump on next poll  

No WebSockets in this phase.

---

## 12. Accessibility

- RTL Arabic  
- Status badges include text (not color alone)  
- Modal/dialog labels; drawer `role="dialog"`  
- Time inputs labeled  
- Toast / last-refresh `aria-live="polite"`  
- Cancel confirmation via `window.confirm` (keyboard accessible)  

---

## 13. Tests and exact results

```text
npx vitest run src/lib/__tests__/availabilityPhase3B.test.ts
→ 15 passed

npx vitest run Phase01 + Phase2 + Phase25 + Phase3A + Phase3B + benchmarks + bookingMoveValidation
→ 108 passed (7 files)
```

`npx tsc --noEmit`: Phase 3B production files clean. Remaining errors are pre-existing unrelated `__tests__` files.

---

## 14. Known limitations

- No drag-and-drop / weekly editor / bulk edit / recurring templates  
- Cancelled adjustment history not listed (active only)  
- Permissions seed must be re-run for non–super-admin access  
- Cross-tab real-time not included (poll / revisit ops board)  

---

## 15. Recommended Phase 3C scope

1. Multi-window runtime consumers (stop primary-window-only shortcuts where product needs all windows)  
2. Richer timeline visualization (still no DnD required)  
3. Optional cancelled-adjustment history endpoint  
4. Gradual retirement of legacy override write paths after parity  

---

### UI walkthrough (text)

1. Open **توافر الموظفين** → see today’s operational Cairo date and branch name.  
2. Browse employee cards; open **عرض التفاصيل** for explain timeline.  
3. **إغلاق اليوم** / **استبدال** / **إضافة** / **حظر** → modal → save → board refreshes.  
4. Soft-cancel from the drawer → confirm → board refreshes.

---

```text
PHASE 3B COMPLETE

WORKFORCE AVAILABILITY UI IMPLEMENTED

DAILY ADJUSTMENTS OPERATIONALLY MANAGEABLE

READY FOR PHASE 3C MULTI-WINDOW RUNTIME
```
