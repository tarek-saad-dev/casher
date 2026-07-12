# Remaining Financial + Payroll Issues Audit

**Date:** 2026-07-12  
**Scope:** Read-only audit after Phase 5B.2 — no data, formula, flag-default, or category changes.  
**Mode:** SELECT / code review / existing QA scripts only.

---

## Executive Summary

| Gate | Value |
|------|-------|
| `READY_FOR_STAGED_REVIEW` | **true** |
| `READY_FOR_FULL_CUTOVER` | **false** |

| Severity | Count |
|----------|------:|
| Critical | 2 |
| High | 4 |
| Medium | 5 |
| Low | 4 |
| Info (pass / expected) | 8+ |

**Bottom line:** Classification and ledger month totals for July 2026 are coherent and match prior QA. Staged review behind flags is appropriate. Full cutover is blocked by (1) unauthenticated legacy post-to-cash when flags are not both on, (2) same-month date-range payroll over-attribution in treasury/intra-month classification, (3) active employee revenue maps still feeding `legacyEmployeeIncomeMirror`, and (4) authenticated endpoint QA still SKIPPED.

---

## Current Known Baseline (July 2026)

| Metric | Amount | Source |
|--------|-------:|--------|
| legacyNet | 30,852.00 | Classification QA (cash in − cash out) |
| partners cleanNetProfit | 34,142.07 | Invoice sales override + classified P&L |
| cleanNetProfit (cash sales base) | 31,908.07 | CashMove sales + other − OpEx − ledger payroll |
| payrollExpenseFromLedger | 23,707.93 | hourly 14,707.93 + monthly 9,000.00 |
| legacyEmployeeIncomeMirror | 7,460.00 | 9 rows, all high confidence |
| nonRevenueCashIn | 24,246.00 | Funding / repayments / internal in |
| employeeAdvances | 31,854.00 | Matches ledger advance debits |
| employeePayouts | 200.00 | Matches ledger payout debit |
| uncategorizedCashIn | 0.00 | |
| uncategorizedCashOut | 0.00 | |
| Phase 5A vs classified buckets | **exact match** | |

**Env flags (current `.env`):**

```
EMP_LEDGER_DUAL_WRITE_ENABLED=true
EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH=true
FINANCIAL_REPORT_CLASSIFICATION_ENABLED=true
```

---

## Critical Issues

### REM-CRIT-01 — `/api/payroll/daily/post-to-cash` has no auth
- **Area:** Legacy post-to-cash API  
- **Evidence:** `src/app/api/payroll/daily/post-to-cash/route.ts` — no `getSession` / `canAccessPath`; block only via `shouldBlockLegacyPostToCash()` before `getPool`.  
- **Impact:** When either dual-write or disable flag is off, unauthenticated callers can create expense + income mirror CashMoves. With **both** flags currently true, route returns 409 (mitigated in this env).  
- **Recommended fix:** Add same auth/permission gate as HR ledger APIs; keep 409 kill-switch.  
- **Safe phase:** Immediate security hardening (no accounting change).  
- **Data mutation required?** no  
- **Block production?** **yes** for any env where kill-switch is not both-on; **warn** even when both-on (defense in depth).

### REM-CRIT-02 — Same-month date range loads **full-month** payroll into `cleanNetProfit`
- **Area:** Classification service / treasury daily / incomes date ranges  
- **Evidence:** `financialReportClassificationService.ts` — if `startDate` and `endDate` share `YYYY-MM`, calls `getPayrollExpenseFromLedger(year, month)` (entire month) even when cash moves are day-scoped.  
- **Impact:** Daily treasury (or any intra-month range) can subtract **all July payroll (~23.7k)** from clean net while showing one day’s cash → severely wrong daily “clean” P&L. Month-scoped partners/monthly reports remain correct.  
- **Recommended fix:** For non-full-month windows, filter ledger credits by `EntryDate` (or pro-rata), not full `PayrollMonth`.  
- **Safe phase:** Phase 5B.x classification scoping fix (formula for month reports unchanged).  
- **Data mutation required?** no  
- **Block production?** **yes** for using classified clean net on **daily/treasury** views; **no** for month partners/monthly if operators only use month reports.

---

## High Issues

### REM-HIGH-01 — Legacy disable flag is AND-gated on dual-write
- **Area:** Feature flags  
- **Evidence:** `shouldBlockLegacyPostToCash() = dualWrite && disable` (`legacyPostToCashFlags.ts`).  
- **Impact:** Setting only `EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH=true` does **not** block API or hide UI.  
- **Recommended fix:** Document clearly; optionally make disable independent.  
- **Data mutation?** no · **Block full cutover?** no (current env has both true)

### REM-HIGH-02 — Active `TxnKind=revenue` employee maps still inflate legacy mirrors
- **Area:** Categories / classification  
- **Evidence:** 20 active revenue maps; July mirror = 7,460 across 9 CashMoves; names like `سد سلفة كريم` / `سد ذياد` mapped as **revenue** (should likely be advance repayment). Duplicate Emp maps on same ExpINID (e.g. 1056 → two EmpIDs; OUTER APPLY TOP 1 is non-deterministic).  
- **Impact:** Clean profit already excludes mirrors; legacy cash revenue / income-review still show them unless UI labels are noticed. Mis-mapped سد categories continue to classify as mirrors not `nonRevenueCashIn`.  
- **Recommended fix:** Mapping review phase (remap TxnKind / deactivate legacy revenue maps) — **do not delete CashMoves**.  
- **Data mutation?** mapping table only (future phase) · **Block staged?** no · **Block full cutover?** **yes** until operators accept WARN or maps cleaned

### REM-HIGH-03 — Date-range payroll OR can over-include
- **Area:** `getPayrollExpenseFromLedgerForDateRange`  
- **Evidence:** `PayrollMonth in range OR EntryDate in range`  
- **Impact:** Cross-month ranges may pull credits outside the intended cash window.  
- **Recommended fix:** Align with REM-CRIT-02 scoping policy.  
- **Data mutation?** no

### REM-HIGH-04 — Authenticated HTTP endpoint QA still SKIPPED
- **Area:** Endpoint QA  
- **Evidence:** `docs/financial-classification-endpoint-qa-2026-07.md` — all five APIs SKIPPED (401 / no AUTH_COOKIE).  
- **Impact:** Live payload shape (`classificationEnabled`, row badges) not confirmed in a real session after restart.  
- **Recommended fix:** Manual browser QA or `AUTH_COOKIE=...` script per `docs/financial-classification-endpoint-qa.md`.  
- **Data mutation?** no · **Block full cutover?** **yes** until PASS once

---

## Medium Issues

### REM-MED-01 — Monthly salary partial commit on per-row errors
- **Evidence:** `employeeLedgerMonthlySalaryService` catches per employee then commits.  
- **Impact:** `success: true` with partial apply possible.  
- **Fix phase:** Payroll hardening · mutation? no (logic only)

### REM-MED-02 — Monthly report UI cash vs profit labeling
- **Evidence:** `/reports/monthly` shows classification clean net beside cards labeled إجمالي الوارد.  
- **Impact:** Operator confusion.  
- **Fix phase:** UX copy · mutation? no

### REM-MED-03 — Funding category name not found as exact CatName
- **Evidence:** DB probe `fundingCategoryExists = 0` for `تمويل من موظف`.  
- **Impact:** Funding may create category on first use, or name differs; treasury already special-cases funding name in code. Worth verifying funding path in a future QA.  
- **Fix phase:** Data/config check · mutation? only if creating missing category (not this audit)

### REM-MED-04 — Advance categories without Emp map (by-name only)
- **Evidence:** Phase 5A registry: several `سلف*` with TxnKind `—` classified by name heuristics.  
- **Impact:** Usually still `employee_advance`; weaker confidence / drift risk.  
- **Fix phase:** Mapping cleanup

### REM-MED-05 — Inactive employees still `IsPayrollEnabled` (5)
- **Evidence:** DB probe `inactivePayrollEnabled = 5`.  
- **Impact:** Low operational risk if inactive filtered in generate; hygiene issue.  
- **Fix phase:** HR data cleanup · mutation? employee flags only (future)

---

## Low / Info

| ID | Title | Notes |
|----|-------|-------|
| REM-LOW-01 | Legacy page redirects to daily-payroll tab not employee-ledger | `LEGACY_POST_TO_CASH_REDIRECT_TAB` unused by page redirect |
| REM-LOW-02 | Nav omits explicit payroll/ledger links | Access via `/admin/hr` tabs |
| REM-LOW-03 | Uncategorized “فئة” count UI always 0/1 | Cosmetic in `FinancialClassificationPanel` |
| REM-LOW-04 | Dual Emp maps on one ExpINID | Non-deterministic TOP 1 |
| REM-INFO-01 | Flag helpers consistent | No production raw `process.env` outside helpers |
| REM-INFO-02 | Legacy post-to-cash 409 before getPool when both flags on | Pass |
| REM-INFO-03 | DailyPayrollPanel hides post button when blocked | Pass |
| REM-INFO-04 | Monthly salary RefType/CashMoveID null/idempotent | Pass — 2 emps, 9,000, 0 CashMove links |
| REM-INFO-05 | Advances 102 / payouts 1 all have CashMoveID | Pass |
| REM-INFO-06 | No duplicate active RefType/RefID/EntryReason | Pass |
| REM-INFO-07 | cleanNetProfit formula + ledger payroll include list | Pass for month reports |
| REM-INFO-08 | Daily payroll HR audit 2026-07-12 | Expected: monthly/freelance excluded; 6 no_attendance (Sunday / no punches) |

---

## Detailed Findings (selected)

See Critical / High / Medium sections for full REM-* IDs. Additional notes:

| ID | Title | Severity | Area | Evidence | Impact | Recommended fix | Phase | Mutation? | Block prod? |
|----|-------|----------|------|----------|--------|-----------------|-------|-----------|-------------|
| REM-CRIT-01 | post-to-cash unauthenticated | Critical | Payroll API | `post-to-cash/route.ts` | CashMove writes if flags off | Add session + page ACL | Security | no | yes* |
| REM-CRIT-02 | Full-month payroll on day range | Critical | Classification | `financialReportClassificationService.ts:120-128` | Wrong daily clean net | Scope payroll by EntryDate for partial months | 5B.x | no | yes for daily classified |
| REM-HIGH-02 | Active revenue maps / mislabeled سد | High | Categories | Mirror review + 5A audit | WARN 7,460; mapping debt | Remap TxnKind; deactivate legacy revenue maps | Mapping | map only | full cutover |
| REM-HIGH-04 | Endpoint QA SKIPPED | High | QA | endpoint QA doc | Unknown live API shape | Login + Network / AUTH_COOKIE | QA | no | full cutover |

\*Blocked for unsafe flag configs; mitigated when both ledger flags true.

---

## Endpoint QA Status

| Endpoint | Status | Notes |
|----------|--------|-------|
| `/api/reports/monthly` | SKIPPED | requires auth |
| `/api/admin/reports/partners` | SKIPPED | requires auth |
| `/api/reports/expenses/monthly` | SKIPPED | requires auth |
| `/api/incomes` | SKIPPED | requires auth |
| `/api/treasury/daily-summary` | SKIPPED | requires auth |

Code-level: all five wire classification behind `isFinancialReportClassificationEnabled()`; partners uses `classifiedPartnerSplit.cleanNetProfit`; flag off → legacy-only payload. **Manual confirmation still required.**

Guide: `docs/financial-classification-endpoint-qa.md`

---

## Legacy Mirror Review

| Item | Value |
|------|------:|
| Total | 7,460.00 |
| Rows | 9 |
| Confidence | high=9 |
| Top employee | طارق 5,910 |
| In clean profit? | **No** |
| In legacy cash in? | **Yes** |

Full rows: `docs/legacy-employee-income-mirror-review-2026-07.md`

**Recommendation:** Keep as Legacy Adjustment WARN; do not delete historical CashMoves; optional UI drilldown later; fix **category TxnKind** for سد* names before treating mirrors as “fully explained.”

---

## Ledger / Reconciliation Status (July 2026)

| EntryReason | Direction | Count | Amount |
|-------------|-----------|------:|-------:|
| hourly_wage | credit | 66 | 14,707.93 |
| monthly_salary | credit | 2 | 9,000.00 |
| advance | debit | 102 | 31,854.00 |
| payout | debit | 1 | 200.00 |

- monthly_salary CashMoveID always NULL: **yes** (0 with cash)  
- duplicates monthly_salary: **none**  
- missing monthly eligible: **none** (طارق 6000 + مريم 3000)  
- advance/payout missing CashMoveID: **0**  
- non-positive amounts: **none**  
- voided in scope: 2 rows / 210 (excluded via IsVoided=0)  
- duplicate active Ref triples: **none**  
- inactive with monthly_salary: **none**

DB probe artifact: `docs/remaining-financial-payroll-issues-db-probe-2026-07.md`

---

## Payroll Status

### Daily (audit `--date=2026-07-12`)
- Script: `node scripts/audit-daily-payroll-hr-model.js --date=2026-07-12` — **OK**  
- monthly_excluded: 2 · freelance_no_attendance: 2 · not_scheduled: 2 · no_attendance errors: 6 (expected if no punches that day)  
- Rate resolution fields populated for hourly employees in sample  

### Monthly salary
- Eligible active: طارق, مريم  
- Both have ledger credits; no orphans/missing; no CashMove  

### Legacy post-to-cash
- Both flags true → API 409 before DB; UI button hidden  
- Redirect old page → `/admin/hr?tab=daily-payroll`  

---

## Report Classification Status

| Check | Result |
|-------|--------|
| Formula | `sales + otherBusiness − operating − payrollFromLedger` |
| Excludes advances/payouts/mirrors/funding/transfers | Pass (month) |
| payrollExpenseFromLedger reasons | hourly_wage, monthly_salary, commission, bonus, target |
| Excludes advance/payout/funding | Pass |
| July numbers vs prior QA | Unchanged |
| Uncategorized | 0 / 0 |
| Partners use cleanNetProfit when flag on | Pass (code + QA) |
| Daily/range payroll scoping | **Fail design** (REM-CRIT-02) |

---

## Data Quality Status

| Check | Result |
|-------|--------|
| Active missing EmploymentType / PayrollMethod | 0 / 0 |
| Monthly no BaseSalary / hourly no rate / daily no rate | 0 / 0 / 0 |
| Freelance monthly violations | 0 |
| Inactive payroll enabled | **5** |
| Active revenue Emp maps | **20** |
| Active advance maps | 19 |
| Maps missing TxnKind | 0 |
| Payout category exists | 1 |
| Funding category exact name | **0** (see REM-MED-03) |
| Advance categories by name only | several (REM-MED-04) |

---

## Commands Run + Results

| Command | Result |
|---------|--------|
| `node scripts/audit-remaining-financial-payroll-issues.js --month=2026-07` | OK — DB probe written |
| `node scripts/qa-financial-classification-enabled.js --month=2026-07` | **WARN** (0 FAIL), numbers unchanged |
| `node scripts/audit-financial-report-classification.js --month=2026-07` | OK — buckets match |
| `node scripts/audit-legacy-employee-income-mirrors.js --month=2026-07` | OK — 7,460 / 9 rows |
| `node scripts/qa-financial-classification-endpoints.js --year=2026 --month=7` | **SKIPPED** (no AUTH_COOKIE) |
| `node scripts/audit-daily-payroll-hr-model.js --date=2026-07-12` | OK — HR rules behave |
| `npx tsc --noEmit` | **clean** |
| vitest (flags, classification, legacy post-to-cash, monthly salary, daily HR audit, mirror review) | **54 PASS** |

No write statements executed against TblCashMove / TblEmpLedgerEntry.

---

## Recommended Next Phases

1. **Phase Sec-1 — Critical API auth** on `post-to-cash` (and review sibling payroll generate routes).  
2. **Phase 5B.3x — Classification date-range payroll scoping** (fix REM-CRIT-02 / REM-HIGH-03) without changing month formula.  
3. **Phase Map-1 — Category mapping review** for `TxnKind=revenue` and سد* repayment mis-maps (no CashMove deletes).  
4. **Phase QA-1 — Authenticated endpoint PASS** once after login + server restart.  
5. **Phase UX-1 — Labels + optional legacy mirror drilldown UI.**  
6. **Phase Cutover — Full cutover decision** only after 1–4 green.

---

## Final Recommendation

| Question | Answer |
|----------|--------|
| Leave `FINANCIAL_REPORT_CLASSIFICATION_ENABLED=true`? | **Yes** for staged review (month partners/monthly). |
| Staged production? | **Yes**, with caveats: do not treat daily treasury clean net as authoritative until REM-CRIT-02 fixed; keep kill-switch flags both on; complete login endpoint QA. |
| Full cutover? | **No** — not until auth hardening, date-range payroll fix, mapping review (or accepted WARN), and authenticated endpoint PASS. |
| Fix first? | **(1) post-to-cash auth**, **(2) payroll scoping for partial date ranges**, **(3) endpoint QA after login**, **(4) revenue/سد mapping review**. |

`READY_FOR_STAGED_REVIEW=true`  
`READY_FOR_FULL_CUTOVER=false`

---

## Artifacts

- This report: `docs/remaining-financial-payroll-issues-audit.md`  
- DB probe: `docs/remaining-financial-payroll-issues-db-probe-2026-07.md`  
- Classification QA: `docs/financial-classification-qa-2026-07.md`  
- Endpoint QA: `docs/financial-classification-endpoint-qa-2026-07.md`  
- Mirror review: `docs/legacy-employee-income-mirror-review-2026-07.md`  
- Probe script (read-only): `scripts/audit-remaining-financial-payroll-issues.js`

---
*Audit only — no accounting logic, historical data, or feature-flag defaults were changed.*
