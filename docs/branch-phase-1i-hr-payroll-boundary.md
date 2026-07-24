# Phase 1I — HR, Payroll, Ledger, and Targets Boundary

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Phase 1I:** Re-evaluated operational safety; **no HR schema migration**, **no payroll redesign**

Live facts: `TblEmpAttendance` 893 rows, **no BranchID**; `TblEmpLedgerEntry` 517 rows, **no BranchID**; `TblEmpPayroll` / `TblEmpTarget` tables **absent**; `attendanceHasBranch: false`.

---

## 1. Baseline model

| Layer | Expected classification | Live state |
|---|---|---|
| `TblEmp` identity | `GLOBAL_MASTER` | Global |
| `TblEmpBranchAssignment` | Branch eligibility | `BranchID NOT NULL` |
| `TblEmpAttendance` event | Should be branch-owned activity | **Global** Emp+WorkDate unique |
| Daily payroll / targets | Hybrid — emp identity, branch attribution TBD | Emp+WorkDate keys, no branch column |
| `TblEmpLedgerEntry` | Hybrid — global balance, branch source TBD | Global entries; `CashMoveID` links branch-owned cash |
| Cash payout / funding | Branch treasury | `TblCashMove.BranchID` (Phase 1D) |

Nightly close (`runNightlyClose`) orchestrates attendance finalize → daily payroll → targets → WhatsApp **once per workDate globally**, not per active branch.

---

## 2. Nine explicit cases (Phase 1I brief)

### Case 1 — Employee works only in GLEEM

| Aspect | Assessment |
|---|---|
| Attendance | Current global row works — only one branch |
| Payroll / targets | Revenue from GLEEM invoices only |
| Ledger | Cash moves all GLEEM |
| **Verdict** | **SAFE today** |

### Case 2 — Employee works only in branch B

| Aspect | Assessment |
|---|---|
| Attendance | Check-in at B with no `BranchID` **indistinguishable** from GLEEM row |
| Payroll | Would aggregate B revenue only if sales filtered — but attendance ambiguous |
| **Verdict** | **BLOCKER** before branch B staff check-in |

### Case 3 — Employee works morning GLEEM, evening branch B (same calendar date)

| Aspect | Assessment |
|---|---|
| Attendance | Single `EmpID+WorkDate` row **cannot** represent two branch sessions |
| Payroll hours | Would double-count or merge incorrectly |
| **Verdict** | **BLOCKER** — requires split events, branch session attribution, or explicit business rule forbidding same-day multi-branch |

### Case 4 — Employee generates sales in both branches

| Aspect | Assessment |
|---|---|
| Invoice ownership | **Correct** — each sale stamped via session branch (Phase 1D) |
| Target / commission calc | Target generation uses emp+date; sales queries **can** filter `BranchID` in report SQL (Phase 1E) but generation job is not branch-iterated |
| **Verdict** | Sales **safe**; target/payroll **attribution incomplete** — decision required, not immediate corruption if HR stays centralized |

### Case 5 — One branch pays advance for employee assigned to both branches

| Aspect | Assessment |
|---|---|
| Cash move | Stamped to paying branch treasury — **correct** |
| Ledger entry | Global emp balance decreases — **correct for global balance model** |
| Branch P&L | Advance cost should appear on paying branch — **partially correct** via `CashMove.BranchID`; ledger entry lacks source tag for non-cash views |
| **Verdict** | **DEFERRED** — acceptable for global ledger if reports use CashMove branch; document as business decision |

### Case 6 — Head office pays salary outside either branch treasury

| Aspect | Assessment |
|---|---|
| Implementation | Would use non-branch cash or manual ledger entry |
| **Verdict** | **DEFERRED** — requires explicit off-branch payment workflow; not enabled in standard paths |

### Case 7 — Target uses aggregate revenue across branches

| Aspect | Assessment |
|---|---|
| Feasibility | SQL can sum all branches' invoices for emp+date |
| **Verdict** | **Valid business choice** — must be explicit; not default without sign-off |

### Case 8 — Target is branch-specific

| Aspect | Assessment |
|---|---|
| Feasibility | Filter invoice revenue by `BranchID` + emp+date |
| **Verdict** | **Valid business choice** — requires branch-aware target generation job |

### Case 9 — Historical invoice reassigned to another employee

| Aspect | Assessment |
|---|---|
| Branch impact | Invoice `BranchID` **immutable**; emp on detail line changes |
| Payroll / target recalc | Recalc requests keyed emp+date — may cross branch revenue |
| **Verdict** | **Existing behavior** — branch ownership preserved; recalc scope is emp-global (acceptable deferral) |

---

## 3. Attendance write path audit

| Route / service | Uses session branch? | Writes BranchID? |
|---|---|---|
| `POST /api/employees/attendance` | **No** | **No** |
| HR board reads | Emp+date filter only | N/A |
| `finalizeIncompleteAttendanceWithDefaults` (nightly) | **No** | **No** |

Unique constraint pattern: `EmpID + WorkDate` (global).

**Blocker rule:** If branch #2 enables staff check-in without attendance branch ownership, attendance for shared employees becomes **ambiguous** (cases 2–3).

---

## 4. Payroll / ledger / targets write paths

| Workflow | Branch on write | Notes |
|---|---|---|
| Daily payroll generate | No | Uses attendance + emp rules |
| Post payroll to cash | **Yes** (via active branch context in 1D) | Cash move branch-owned |
| Employee funding / payout | **Yes** (cash branch) | Ledger dual-write |
| Target generate / recalc | No on target row | Revenue SQL should include branch filter when scoped |
| Monthly payroll SP | Deferred | Not rewritten in 1E |

---

## 5. Nightly close and jobs risk

`POST /api/admin/hr/nightly-close` → `runNightlyClose`:

* Finalizes attendance globally for `workDate`
* Generates payroll for all eligible employees
* Generates targets globally
* Sends employee WhatsApp (uses `getConfig().defaultBranchName` — **not** per-branch iteration)
* Sends owner WhatsApp (**Phase 1I:** iterates active branches for full-day sections)

**Risk:** When two branches are active, a single nightly run may close/payroll/target for all employees without branch iteration — GLEEM watcher must not prevent branch B close, and branch B attendance must not corrupt GLEEM rows.

**Phase 1I action:** Documented as **settings/jobs risk**; not rewritten in 1I.

---

## 6. Go-live gates

| Capability | GLEEM-only | Branch #2 staff check-in | Branch #2 full HR |
|---|---|---|---|
| Attendance | OK | **NO-GO** | **NO-GO** until BranchID or rule |
| Daily payroll | OK | Conditional (if attendance blocked) | **NO-GO** until attribution |
| Ledger | OK | Conditional | **DEFERRED** decision |
| Targets | OK | Conditional | **DEFERRED** decision |

---

## 7. Required business decisions (blocking records)

1. **Attendance ownership** — branch-owned event vs single row per day vs assignment-only proxy  
2. **Payroll cost attribution** — branch of work vs branch of treasury payment  
3. **Ledger source branch** — global balance + optional `SourceBranchID` vs per-branch sub-accounts  
4. **Target aggregation** — case 7 vs case 8  
5. **Nightly job topology** — per-branch iteration vs centralized HR hub  

**Phase 1I does not implement these.** Mark as **DEFERRED_REQUIRES_BUSINESS_DECISION** with attendance and full product+HR ops as **go-live blockers** for branch #2.
