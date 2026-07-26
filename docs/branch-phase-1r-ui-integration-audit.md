# Phase 1R — UI Integration Audit

**Date:** 2026-07-26  
**Scope:** Employee default weekly branch schedule UX + operations emergency daily transfer  
**SoT (unchanged):** `TblEmpBranchWorkSchedule` + `TblEmpTemporaryBranchTransfer` + `resolveEmployee*` (Phase 1Q)

---

## Summary

| Area | Status before 1R | Required integration |
|---|---|---|
| Branch schedule SoT / resolvers | Done (1Q) | Consume only — do not redesign |
| HR employees row actions | No schedule entry | Add «الفروع ومواعيد العمل» |
| Weekly planner page | Read-only matrix; broken `empId` param | Editable planner + preview/save |
| Branch-schedule API | GET + single-branch PUT | Global days[] save + preview |
| Temporary transfer | `createTemporaryBranchTransfer` only | Preview / apply / cancel + APIs + UI |
| Ops «إدارة مواعيد اليوم» | Legacy `availabilityEngine` + all barbers | Day-state from resolvers + transfer action |
| Flow-board | Assignment ∩ branch; status legacy | Filter by resolved location for WorkDate |
| Queue / booking | Mixed | Booking already transfer-aware; keep guards |

---

## Component matrix

| Current component | Data source | Current action | Required integration | Duplication risk | Final path |
|---|---|---|---|---|---|
| `admin/hr/page.tsx` EmployeesPanel | `GET /api/employees` | Edit / target / finance / deactivate | Entry «الفروع ومواعيد العمل» → branch-schedule | Crowded action column → dropdown | Dropdown «إدارة العمل» |
| `EmployeeHrFormModal` | `TblEmpWorkSchedule` via upsert | Edit global weekly hours | Must **not** become branch SoT editor | High vs branch schedule | Leave legacy fields; schedule page is SoT |
| `admin/hr/employees/[empId]/branch-schedule/page.tsx` | GET branch-schedule | Read-only | Fix `empId`; editable planner; summary from resolver | Parallel legacy schedule APIs | Full weekly planner (1R) |
| `api/admin/employees/[id]/branch-schedule` | Resolver + `saveEmployeeBranchWeeklySchedule` | GET / PUT per branch | Add preview; atomic global days[] | Single-branch PUT remains for assignment commit | Extend save module |
| `ScheduleControlModal` | `GET schedule-control` → `getBarbersDayStatus` | day_off / late / early / block / custom | Show resolved branch + transfer / cancel | Overrides vs transfer | Enrich API + modal; transfer uses service |
| `api/operations/schedule-control` | All barbers + legacy schedule | List day status | Prefer session-branch day-state | Global barber list | Day-state service |
| `api/operations/flow-board` | Assignment + legacy status | Board | Include transfer-in; exclude scheduled-elsewhere | Assignment ≠ location | Resolve location filter |
| `availabilityEngine` | `TblEmpWorkSchedule` | Ops status | Do not replace overnight; day-state overlays resolver | Primary duplication | Keep for override timing; location from resolver |
| `temporaryBranchTransfer.ts` | Insert transfer | Create only | Preview + cancel + stronger guards | None if single service | Expand same module |
| `branchAttendance.service` | Resolver | Check-in gate | Already destination-aware after transfer | Low | No change required beyond transfer invalidate |
| Booking create/slots | Resolver | Wrong-branch codes | Reflect transfer | Low | Confirm invalidation after transfer |
| Public booking visibility | `canBranchAppearInPublicBooking` | Hide SETUP | Camp Caesar stays hidden | Hardcoded names | Lifecycle gates only |

---

## Visual language to preserve

- Operations modal: dark overlay, gold/`--primary` accents, RTL accordion rows.
- HR: RTL admin tokens (`bg-surface`, outline buttons).
- Do not invent a second schedule UI language.

---

## Precedence (confirmed for 1R docs)

```text
Global leave / day_off override
→ temporary branch transfer
→ branch weekly schedule
→ day override (late_start / early_leave / custom_hours / block_range)
→ busy intervals
```

Transfer must **not** override global leave. Day overrides remain timing controls on the resolved location — they do not create transfers.

---

## Implementation path

1. Audit (this doc).
2. Global weekly save + preview APIs; rebuild planner UI; HR entry.
3. Transfer preview/apply/cancel service + ops APIs.
4. Day-state API; enrich schedule-control + modal transfer UI.
5. Flow-board location filter + cache invalidation hooks.
6. Contract tests, verifier, smoke docs, closure.
