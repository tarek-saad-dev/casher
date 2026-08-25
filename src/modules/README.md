# Workforce modules (Phase A)

Architecture **boundaries only**. Implementations stay in `src/lib/*`.
These folders re-export current behavior. They must not add SQL, rules, or route changes.

```text
UI / API Routes
       ↓
Module Public API          (@/modules/<name>)
       ↓
Application
       ↓
Domain
       ↓
Infrastructure             (adapters over src/lib/…)
```

Import rule (from Phase B onward; existing `src/lib` imports are unchanged in Phase A):

```ts
import { … } from "@/modules/attendance";
```

Not:

```ts
import { … } from "@/modules/attendance/infra/…";
```

## Forbidden dependencies (target; not enforced by compiler in Phase A)

- Booking must not query Attendance SQL directly.
- UI must not own Attendance business rules.
- Payroll must not define Attendance OPEN.
- Attendance must not directly mutate Booking.
- Operations must not own Workforce persistence.
- Routes must eventually contain no domain SQL.

## Phase A scope

Facades / re-exports over:

| Module | Existing implementation |
|---|---|
| `attendance` | `src/lib/hr/attendance/branchAttendance.service.ts` |
| `business-day` | `src/lib/businessDate.ts`, `src/lib/branch/businessDay.ts` |
| `transfers` | `src/lib/hr/temporaryBranchTransfer.ts` |
| `availability` | `src/lib/booking/AvailabilityMutationNotifier.ts` |

No runtime behavior change. Do not unify WorkDate / OPEN / cutoff here.
