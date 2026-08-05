# Availability Architecture — Phase 3B.2 Implementation

**Date:** 2026-08-03  
**Status:** COMPLETE  
**Scope:** Availability Layers Inspector inside `/admin/workforce/availability` employee drawer.

Companions:

- [`availability-layers-control-matrix.md`](./availability-layers-control-matrix.md)
- [`availability-phase-3B-implementation.md`](./availability-phase-3B-implementation.md)
- [`availability-phase-3B1-implementation.md`](./availability-phase-3B1-implementation.md)

---

## 1. Executive summary

Operators opening an employee now see a seven-layer pipeline:

1. Employment identity  
2. Base branch weekly schedule  
3. Temporary transfer / freelance unlock  
4. Legacy schedule overrides  
5. Attendance reality  
6. Canonical daily adjustments  
7. Final effective availability  

Layers are built **server-side** from the already-resolved day plan + explain metadata. The UI does not recalculate schedules. Mutations stay owned by their layer (daily adjustments via existing modal; attendance/transfer/weekly via existing HR pages).

---

## 2. Layer architecture

```text
[1] بيانات الموظف
        ↓
[2] التعيين والجدول الأساسي
        ↓
[3] النقل أو فتح العمل الاستثنائي
        ↓
[4] التعديلات القديمة
        ↓
[5] الحضور الفعلي
        ↓
[6] التعديلات اليومية
        ↓
[7] النتيجة النهائية (+ timeline)
```

Status model: `APPLIED | NOT_APPLICABLE | NO_DATA | OVERRIDDEN | BLOCKING | INFORMATIONAL | WARNING` with Arabic labels.

---

## 3. Files added and modified

### Added

| File | Role |
|------|------|
| `src/lib/availability/buildAvailabilityLayers.ts` | Pure layer view-model |
| `src/components/admin/workforce/layers/*` | Inspector UI |
| `src/lib/__tests__/availabilityPhase3B2.test.ts` | Tests |
| `docs/availability-phase-3B2-implementation.md` | This report |
| `docs/availability-layers-control-matrix.md` | Controls × permissions |

### Modified

| File | Change |
|------|--------|
| `explainAvailability.ts` | `layers[]` + `buildExplainLayers` snapshots |
| `workforceDay.ts` | Employment type, transfer batch, `layers` on each employee |
| `AvailabilityExplainDrawer.tsx` | Layers inspector + history tab |
| `WorkforceAvailabilityPage.tsx` | Wire modal/refresh from layer actions |
| `workforceUiLabels.ts` | Freelance unlock Arabic label |
| Phase 3B / 3B.1 tests | Drawer contract updates |

---

## 4. Server view model

`loadWorkforceDay` still:

1. Roster SQL (now includes `EmploymentType` + assignment dates)  
2. **One** `resolveEmployeeDayPlansBatch`  
3. **One** transfer batch for the date  
4. `explainEmployeeDayPlan` + `buildAvailabilityLayers` in memory  

Payload additions: `permissions`, `employees[].employmentType`, `employees[].transfer`, `employees[].layers`.

---

## 5. Explain-engine extension

`AvailabilityExplanation.layers` (additive; `evaluationTimeline` preserved).

Each entry: key, order, applied, status, input/output summaries, effectCode, warnings, optional `snapshot` (before/after windows & blocks).

Snapshots replay pure `applyOverrides` / `applyDailyAdjustments` — no SQL, no product-rule fork.

---

## 6. Seven UI layers

Implemented in `AvailabilityLayersInspector` + `AvailabilityLayerCard` with connectors, status badges, effect rows, expand/collapse, technical details, and sticky footer shortcuts into daily-adjustment modals.

---

## 7. Layer effect snapshots

Before/after windows shown per layer when explain snapshots exist (legacy, attendance, daily, final). Absence clears windows. Daily replace/close reflected in after-windows.

---

## 8. Controls and permission ownership

See control matrix doc. Defaults assume workforce page access; disabled actions carry Arabic reasons. Legacy create remains disabled; cancel-existing links to schedule-control. Final layer is read-only (refresh / copy tech only).

---

## 9. Data / query flow

```text
O(1 roster) + O(1 day-plan batch) + O(1 transfers) + O(N explain+layers CPU)
```

No per-layer SQL. No salary/payroll fields exposed.

---

## 10. UX and accessibility

- RTL drawer, sticky header/footer  
- Blocking + final layers auto-expanded  
- Final layer visually emphasized  
- Arabic first; codes secondary  
- Timeline remains read-only  
- Help: «ما الفرق بين الجدول والحضور؟»  
- Multi-window note: Phase 3C already shipped — success copy retained on timeline  

---

## 11. Tests and exact results

```text
npx vitest run src/lib/__tests__/availabilityPhase3B2.test.ts
→ 11 passed

With Phase 3B / 3B.1 / 2.5 / 3A:
→ green (drawer contracts updated)
```

---

## 12. Known limitations

- Transfer/freelance HR controls are deep-links, not embedded editors  
- Attendance actions open HR attendance surfaces (no duplicate POS attendance UI)  
- Permission bag is currently default-true for page viewers; finer session permission gating can be added without changing the layer contract  
- Inactive employees filtered by roster query (`isActive=1`) — inactive blocking path covered in builder tests  

---

## 13. Phase 3C readiness

Multi-window runtime (Phase 3C) is already implemented in this repo. The layers inspector surfaces **all** `effectiveWindows` and uses the post-3C timeline success label. Layer UI does not depend on primary-window shortcuts for eligibility.

---

```text
PHASE 3B.2 COMPLETE

AVAILABILITY LAYERS INSPECTOR IMPLEMENTED

EVERY SCHEDULE, TRANSFER, ATTENDANCE, OVERRIDE, AND DAILY ADJUSTMENT LAYER IS VISIBLE AND CONTROLLABLE

READY FOR PHASE 3C MULTI-WINDOW RUNTIME
```
