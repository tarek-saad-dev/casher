# Booking Audit — Phase 4: Existing Booking Data Impact

**Date:** 2026-07-15  
**Based on:** Phases 1–3 architecture / date / concurrency findings  
**Constraint:** Read-only SQL. No writes, no schema changes, no app changes.

**Database:** Azure `last132` (`newserverr.database.windows.net`) — 1,291 `Bookings` rows (2026-05-16 → 2026-07-22).  
Active statuses for conflict scans (match availability engine):  
`confirmed`, `arrived`, `queued`, `in_service`, `in_progress` via `LOWER(Status)`.

---

## 1. Schema and index summary

| Column | Type | Nullable |
| ------ | ---- | -------- |
| `BookingID` | `int` | NO (PK) |
| `BookingCode` | `nvarchar(30)` | YES (unique UX) |
| `ClientID` | `int` | YES |
| `AssignedEmpID` | `int` | YES |
| `BookingDate` | `date` | NO |
| `StartTime` | `time` | NO |
| `EndTime` | `time` | YES |
| `Status` | `nvarchar(30)` | NO |
| `Source` | `nvarchar(30)` | NO |
| `CreatedAt` | `datetime` | NO |
| `CancelledAt` | `datetime` | YES |
| `BookingServices.DurationMinutes` | `int` | YES |

**Indexes (Bookings):**

| Index | Columns |
| ----- | ------- |
| `PK_Bookings` (clustered unique) | `BookingID` |
| `UX_Bookings_BookingCode` (unique) | `BookingCode` |
| `IX_Bookings_Date_Emp_Status` | `BookingDate`, `AssignedEmpID`, `Status` |
| `IX_Bookings_AssignedEmpID_BookingDate_Status` | `AssignedEmpID`, `BookingDate`, `Status` + includes `StartTime`, `EndTime` |

No unique constraint prevents overlapping intervals for the same barber.

---

## 2. Same-start conflicts

Active rows with same `AssignedEmpID` + `BookingDate` + `StartTime`, different `BookingID`.

| Metric | Value |
| ------ | ----: |
| Conflict sets | **7** |
| Affected booking rows | **18** |
| Source pairs | **online + online: 7** (0 operations pairs) |

Example sets:

| Emp | Date | Start | BookingIDs | Clients |
| --- | ---- | ----- | ---------- | ------- |
| 5 | 2026-05-20 | 20:45 | 21, 32, 34, 35 | 3855 + 8 (triple for client 8) |
| 5 | 2026-05-20 | 21:15 | 22, 33 | 3855, 8 |
| 5 | 2026-05-26 | 23:45 | 227, 228 | 12648, 12649 |
| 5 | 2026-06-22 | 23:30 | 683, 687 | 169, 3610 |
| 12 | 2026-05-23 | 23:30 | 84, 85 | … |

All are **online + online** — consistent with `/plan` vs `/plan` historical races and/or duplicate submissions before guards, and with Phase 3 (`/create` vs `/plan` lock gap would also allow operations+online; **none observed** in current active same-start set).

---

## 3. Interval overlaps

Absolute intervals: `StartAt = BookingDate+StartTime`; if `EndTime <= StartTime` then `EndAt = BookingDate+1 + EndTime`. Pair rule `A.StartAt < B.EndAt AND B.StartAt < A.EndAt`, `BookingID_A < BookingID_B`.

| Metric | Value |
| ------ | ----: |
| Overlapping pairs | **25** |
| Source pairs | **online + online: 25** |

Reclassified (by `BookingDate` + start equality):

| Class | Pairs |
| ----- | ----: |
| same start | 17 |
| partial overlap | 1 |
| full containment | 0 |
| cross-date / cross-midnight | 7 |

**Note:** Booking **1016** has `StartTime≈22:00` and `EndTime≈19:45` → wrap rule yields ~22h occupancy and **3 inflated** overlaps with next-day afternoon slots (1025, 1031, 1033). Treat those three as **data anomaly / manual review**, not proven `/plan` races.

---

## 4. Cross-midnight conflicts

Pairs with **different `BookingDate`** and absolute overlap (what `/plan` same-date UPDLOCK misses):

| A | B | Overlap (min) | Notes |
| - | - | ------------: | ----- |
| 209 | 256 | 30 | ~23:45→00:30 vs next day 00:00–00:30 |
| 212 | 256 | 30 | same pattern |
| 211 | 256 | 25 | same pattern |
| 200 | 256 | 5 | same pattern |
| 1016 | 1025 | 35 | **suspect** long wrap on 1016 |
| 1016 | 1031 | 45 | **suspect** |
| 1016 | 1033 | 30 | **suspect** |

**Genuine overnight cross-date conflicts: 4 pairs** (IDs 200, 209, 211, 212, 256).  
**Suspect wrap anomalies: 3 pairs** involving 1016.

Rows with raw `EndTime <= StartTime`: online **39**, operations **2**, walk_in **1**.

---

## 5. Suspected wrong-date online bookings

**Evidence rules (DB-only):**

| Class | Rule |
| ----- | ---- |
| Confirmed wrong date | *(none)* — original board date not stored |
| Strong candidate | `Source=online`, `StartTime < 06:00`, `CAST(CreatedAt AS date) = BookingDate - 1 day` |
| Weak candidate | online + `StartTime < 06:00` (other CreatedAt patterns) |
| Cannot determine | no early-morning signal |

| Class | Count |
| ----- | ----: |
| Strong candidate | **1** (BookingID **223**, start 00:30 on 2026-05-26, created 2026-05-25; sibling 222 at 23:45 previous date, CreatedAt Δ=1s — classic overnight plan segment / possible double-offset) |
| Weak candidate | **11** |
| Adjacent online date-gap segment pairs (CreatedAt ≤120s) | **6** |

Phase 2 root cause remains FE+`/plan` double `dayOffset`; DB cannot prove most early-morning dates without the original selected day.

---

## 6. Multi-service plan groups

**Grouping tolerance:** same `ClientID`, `Source=online`, `CreatedAt` within **90 seconds** of cluster seed; size ≥ 2. Heuristic — not every nearby pair is one cart.

| Metric | Count |
| ------ | ----: |
| Inferred plan groups | **89** |
| All rows `confirmed` | **57** |
| Containing cancelled | **32** |
| Mixed statuses | **14** |
| Date gaps (multi `BookingDate`) | **5** |
| Barber changes within group | **16** |
| Internal barber interval overlap | **3** |

---

## 7. Partial-failure cancelled rows

Online `cancelled`/`Cancelled` with ≥1 other online row for same `ClientID` within **120s CreatedAt**:

| Metric | Count |
| ------ | ----: |
| Cancelled rows matching signal | **56** |
| Of those with nearby **active** sibling | **16** |

**Reader / blocker impact:**

| Surface | Appears? | Blocks availability? |
| ------- | -------- | -------------------- |
| `/plan` conflict SQL / busy intervals | No (active status lists) | **No** |
| flow-board active filter | No | **No** |
| bookings list UI (`cancelled` tab / filters) | **Yes** if status lowercased or exact match | N/A |
| Public cancel exact `'Cancelled'` | Mixed casing (see §8) | N/A |

**Later disposition:** prefer **keep** for audit trail; optional archive/hide from ops lists. Do **not** delete in Phase 5 without product decision.

---

## 8. Status consistency

DB collation is case-**insensitive** for `GROUP BY Status`, so casing variants collapse in aggregates.

| Exact value (CI group) | LOWER | Count | Online | Operations | Other |
| ---------------------- | ----- | ----: | -----: | ---------: | ----: |
| confirmed | confirmed | 1013 | 913 | 99 | 1 |
| cancelled | cancelled | 270 | 230 | 20 | 20 |
| pending | pending | 5 | 0 | 0 | 5 |
| arrived | arrived | 1 | 1 | 0 | 0 |
| completed | completed | 1 | 1 | 0 | 0 |
| queued | queued | 1 | 1 | 0 | 0 |

**Case-sensitive probe:** **68** rows where `Status COLLATE Latin1_General_CS_AS <> LOWER(Status)` — observed as **`Cancelled`** (Pascal), written by public cancel path (`Status = 'Cancelled'`).

| Reader | Comparison | Effect of `Cancelled` vs `cancelled` |
| ------ | ---------- | ------------------------------------- |
| `buildBookingIntervals` / availability | `LOWER(Status)` | Consistent — both inactive |
| `/plan` write conflict | exact `IN ('confirmed',…)` | Consistent for actives |
| flow-board | exact `IN ('confirmed',…)` | Consistent for actives |
| public cancel route | exact `=== 'Cancelled'` | May **miss** lowercase `cancelled` as already-cancelled |
| ops cancel | writes `'cancelled'` | Divergent writers |

No `Confirmed` Pascal rows found. `pending` (5) is outside active conflict lists.

---

## 9. Impact summary

| Area | Impact |
| ---- | ------ |
| Volume | 1,291 bookings; 1,146 online; 119 operations; 1,015 active |
| Same-start active conflicts | 7 sets / 18 rows — **all online** |
| Interval overlap pairs | **25** (all online+online) |
| True cross-midnight `/plan`-style pairs | **4** (+3 suspect from 1016 EndTime wrap) |
| Early-morning online (hour 0–5) | **19** |
| Strong wrong-date candidate | **1** |
| Inferred multi-service groups | 89; 32 with cancelled; 14 mixed |
| Partial-cancel candidates | **56** rows |
| Status casing | **68** Pascal `Cancelled` |

**Conflict rate by source:** all measured active overlaps are **online + online**. No active operations+online same-start pairs in current data (Phase 3 vulnerability remains for future concurrency).

---

## 10. Remediation manifest

Actions are **recommendations only** — not executed.

### `same_start_duplicate` (18)

`21,22,32,33,34,35,71,84,85,137,200,209,211,212,227,228,683,687`  
Severity: high · Action: **cancel duplicate** (keep earliest CreatedAt or keep customer-of-record) · Related: peers in same set.

### `confirmed_overlap` / partial (2)

`71,238` · Action: **manual review**.

### `cross_midnight_overlap` (genuine 5 IDs + anomaly)

Genuine: `200,209,211,212,256` · Action: **manual review** / possibly **cancel duplicate**.  
Anomaly wrap: `1016,1025,1031,1033` · Action: **manual review** (fix EndTime / occupancy before cancelling).

### `suspected_double_day_offset` (12)

`223,256,278,460,632,633,634,748,753,768,850,869`  
Strong: **223** → consider **move date** (−1) after ops confirm. Others → **manual review**.

### `partial_plan_cancelled` (56)

See script output / IDs in audit JSON generation:  
`6,7,28,29,36,37,38,39,50,51,52,54,58,59,72,94,95,106,107,118,120,121,133,134,138,193,194,219,302,335,358,359,385,427,428,455,520,521,577,578,579,580,593,667,685,686,774,777,778,959,960,982,1003,1004,1005,1009`  
Action: **keep** (unless product wants archive).

### `status_inconsistency` (68)

Pascal `Cancelled` IDs include:  
`103,141,169,170,172,193,194,219,233,234,247,255,257,262,270,276,345,365,398,431,455,462,463,464,499,523,568,575,596,603,641,685,686,691,730,749,750,779,820,874,893,910,934,936,937,959,960,969,982,1004,1005,1030,1035,1043,1055,1058,1060,1071,1077,1098,1100,1193,1194,1201,1203,1244,1250,1252`  
Action: **normalize status** → `cancelled`.

### `manual_review` (unique BookingIDs with that action: **32**)

Includes overlap owners, internal plan overlaps (`32,33,34,455,456,577–580`, …).

---

## 11. Inputs needed for Phase 5

1. Product rule: which duplicate to keep on same-start conflicts (earliest / latest / by source).
2. Confirm whether Booking **223** (and weak early-morning set) should shift `BookingDate - 1`.
3. Disposition of Pascal `Cancelled` normalization and public cancel path alignment.
4. Whether partial-plan cancelled rows stay forever, archive, or hard-delete.
5. Fix scope order: unify `/plan` write guard (Phase 3) **before** bulk data cleanup to avoid new overlaps while remediating.
6. Decision on anomalous EndTime wraps (e.g. 1016) — data repair vs schedule engine clamp.

Reusable read-only SQL: `scripts/audit-booking-data-impact.sql`.

---

**Read-only confirmation:** No INSERT/UPDATE/DELETE/DDL against booking tables; no application code changes; audit queried Azure `last132` only.
