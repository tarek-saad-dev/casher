# Phase 1M / 1O — Outstanding Business Decisions

Updated after Phase **1O** live config apply on cloud / `last132` (CAMP_CAESAR BranchID=3). Do not invent production values for OPEN items.

| Decision | Status |
|---|---|
| Real branch #2 name/code | **RESOLVED** — Arabic: فرع كامب شيزار · English: Camp Caesar · BranchCode: `CAMP_CAESAR` · Timezone: `Africa/Cairo` · ShortName: كامب شيزار · BranchID=3 |
| Address / contact | **RESOLVED** — Address: كامب شيزار · Phone: 01012126899 |
| Operating hours | **RESOLVED** — DefaultOpen 11:00 · DefaultClose 01:30 overnight · Cutoff 04:00 |
| Service / price policy | **RESOLVED** — Global `TblPro` shared catalog; parity mismatches=0 at apply; no branch price table |
| User / permission policy | **RESOLVED** — 9 GLEEM active users mapped to CC (created 8, updated 1); SETUP IsActive=0 hides from switcher |
| Global employee identity policy | **RESOLVED** — Global `TblEmp`; branch assignment via `commitEmployeeBranchAssignment`; no duplicate people / no GLEEM plan fallback |
| Assignment-time payroll / target policy | **RESOLVED** (contract) — payroll plan + target plan or explicit NO_TARGET required at commit |
| Payment-method policy | **RESOLVED** — Global 9 methods; no balances copied |
| Partner percentages | **RESOLVED** (draft) — أ/ عايدة 40 · أ/ طارق 20 · أ/ ذياد 20 · أ/ عمر 20 · total 100% · IsActive=0; GLEEM partners unchanged |
| Shared printer policy | **RESOLVED** — SharedPrinterApproved=true; receipt identity = Arabic name + phone; prints=0 |
| Shared WhatsApp policy | **RESOLVED** — SharedWhatsAppApproved=true; sends=0; ExternalNotificationsEnabled=0 |
| Opening cash balance | **OPEN** |
| Opening inventory decision / qty / costs | **OPEN** — options UI A/B/C only; still blocker |
| Real employee assignments | **OPEN** |
| Real payroll values | **OPEN** |
| Real target values | **OPEN** |
| Partner-share EffectiveFrom / opening date | **OPEN** — draft placeholder 2099-01-01 only while inactive |
| Supplier sharing policy | OPEN |
| Inventory-transfer policy | OPEN (1J controlled; option C may use) |
| Central/head-office expenses | OPEN |
| Inter-branch cash policy | OPEN (forbidden to invent) |

Missing OPEN decisions above block **INTERNAL_LIVE**.

Technical smoke may use controlled `[SMOKE CC]` values (Phase 1N-B SmokeRunID 11). Those values are **not** production decisions.

Camp Caesar remains **SETUP** after Phase 1O config apply — not launched. INTERNAL_LIVE / PUBLIC_LIVE = **NO-GO**.
