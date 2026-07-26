# Phase 1O — Camp Caesar Real Config Audit

**Database:** cloud / `last132`  
**Branch:** BranchID=3 · `CAMP_CAESAR` · فرع كامب شيزار  
**Apply:** `applyApprovedBranchConfigurationTemplate` (GLEEM → CC) · 2026-07-26T01:45Z  
**Lifecycle after apply:** `SETUP` · IsActive=0 · PublicBooking=0 · ExternalNotifications=0 · BookingEnabled=0

| Domain | Current | Desired | Create | Update | MustNotCopy | BizBlocker | TechBlocker | Final |
|---|---|---|---|---|---|---|---|---|
| Identity (AR name/code/tz) | فرع كامب شيزار / CAMP_CAESAR / Africa/Cairo | same | 0 | 0 | GLEEM BranchName | — | — | APPLIED |
| ShortName | كامب شيزار | same | 0 | 0 | — | — | — | APPLIED |
| Address / phone | كامب شيزار / 01012126899 | same | 0 | 1 | GLEEM address/phone | — | — | APPLIED |
| English display | QBS.SalonName=Camp Caesar + SetupPolicy.EnglishDisplayName | same (no new BranchName EN column) | 0 | 1 | GLEEM SalonName | — | — | APPLIED |
| Operating hours | Open 11:00 · Close 01:30 overnight · Cutoff 04:00 | same | 0 | 1 | invent hours | — | — | APPLIED |
| Queue/booking timing | Slot/min-notice from template; BookingEnabled=0 | SETUP-safe timing | 0 | 1 | BookingEnabled=1 | — | — | APPLIED |
| Services / prices | Global TblPro; active serv=1; mismatches=0 | parity with shared catalog | 0 | 0 | branch price table; reactivate deleted | — | — | PARITY OK |
| User branch access | 9 GLEEM active users mapped (created 8, updated 1) | GLEEM staff can switch when live | 8 | 1 | passwords; invent users | — | — | APPLIED |
| Switcher visibility | IsActive=0 → hidden | SETUP hidden | 0 | 0 | force IsActive=1 | — | — | PASS |
| Payment methods | Global 9 methods | same catalog | 0 | 0 | balances / CashMove | biz.opening_cash | — | CATALOG OK |
| Partner shares | Draft IsActive=0 · 40/20/20/20 · total 100% | real EffectiveFrom on open | 4 | 0 | GLEEM partners; invent open date | biz.partner_shares_effective_date | — | DRAFT ONLY |
| Shared printer | SharedPrinterApproved=true | same endpoint; CC receipt identity | 0 | 1 | print jobs; GLEEM name on receipt | — | — | POLICY OK · prints=0 |
| Shared WhatsApp | SharedWhatsAppApproved=true | same sender; CC identity | 0 | 1 | real sends; ExternalNotifications=1 | — | — | POLICY OK · sends=0 |
| Opening inventory | Options UI A/B/C only | chosen option + qty/costs | 0 | 0 | copy GLEEM qty without history | biz.opening_inventory | — | BLOCKER |
| Opening cash | unset | approved opening balance | 0 | 0 | invent balance | biz.opening_cash | — | OPEN |
| Employee assignments | none (smoke cleaned) | real staff + plans + targets | 0 | 0 | GLEEM payroll/target copy | biz.real_employees | — | OPEN |
| Payroll / target values | none on CC | assignment-time values | 0 | 0 | GLEEM plan fallback | payroll/target coverage | — | OPEN |
| Smoke proofs | SmokeRunID 11 retained (1N) | fresh 1O smoke when ready | — | — | treat 1N as INTERNAL_LIVE | — | smoke runner pending | 1N RETAINED |
| Lifecycle / live gates | SETUP | INTERNAL_LIVE later | — | — | premature activate | remaining biz blockers | public.frontend_multi_branch | INTERNAL_LIVE NO-GO · PUBLIC_LIVE NO-GO |

**Must-not-copy (global):** transactional rows, balances, inventory qty without transfer, GLEEM partner shares, deleted services, invent EffectiveFrom / opening cash / payroll amounts.
