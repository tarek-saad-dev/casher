# Availability Phase 3C — Browser Workforce UI Verification

**Date:** 2026-08-03  
**Route:** `/admin/workforce/availability`  
**App URL:** `http://localhost:5500`  
**Kind:** Browser/UI verified (live automation session — not source-only)

Credentials were minted into a session cookie for authorized/unauthorized checks and are **not** recorded here.

---

## Environment

| Item | Value |
|------|-------|
| Active branch shown | جليم – سابا باشا (`GLEEM`) |
| Cairo business date control | `2026-08-03` |
| Authorized actor | UserID 13 (`Tarek`) — admin / workforce page access |
| Unauthorized actor | UserID 17 (`mr.ziad`) — partner / no workforce page |

---

## Checklist results

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | Page loads successfully | **PASS** | Title/nav OK under authorized session |
| 2 | Active branch name correct | **PASS** | جليم – سابا باشا |
| 3 | Cairo business date correct | **PASS** | Date input `2026-08-03` |
| 4 | Employee cards render | **PASS** | احمد، زياد، عمر، كريم، محمد |
| 5 | Employee details drawer opens | **PASS** | Tabs الطبقات / سجل التعديلات |
| 6 | Seven availability layers in order | **PASS** | Layer list rendered in drawer |
| 7 | Employment / base / transfer / legacy / attendance / daily / final understandable | **PASS** | Arabic labels + values visible |
| 8 | Blocking / applied / overridden badges match API | **PASS** | Status chips consistent with board |
| 9 | All effective windows render | **PASS** | After ADD_WINDOW: `09:00–10:00` + afternoon/overnight window |
| 10 | Gap periods render | **PASS** | Timeline / gap between windows after multi-window |
| 11 | Runtime-ready message | **PASS** | Appeared once multiple windows present (`النوافذ المستخدمة في الحجز والطابور` / runtime copy) |
| 12 | Create `ADD_WINDOW` via modal | **PASS** | احمد `09:00–10:00`, reason `[P3C-ACC browser] add window` |
| 13 | Board refreshes without full reload | **PASS** | Card updated to two windows; modal closed |
| 14 | Ops board invalidation / next poll | **NOT SEPARATELY VERIFIED** | Workforce live refresh verified; `/operations` poll not exercised this session |
| 15 | Cancel adjustment | **PASS** | Confirm `إلغاء التعديل` |
| 16 | Cancelled record in **السجل** | **PASS** | `إضافة فترة عمل` / `ملغي` / `[P3C-ACC browser] add window` |
| 17 | Unauthorized role denied | **PASS** | Redirect `/403` — `غير مصرح بالوصول` |
| 18 | No payroll / salary / customer / secret data | **PASS** | No salary/payroll/phone secrets in page text |

---

## Permission-role browser results

| Role / actor | Browser result |
|--------------|----------------|
| `super_admin` / admin session (Tarek) | Full page + mutation + history **PASS** |
| `partner` (mr.ziad) | Page denied **PASS** |
| `admin` / `manager` / `receptionist` page grants | Seed/verify **PASS** (`grantedRoles` includes all four) |
| Dedicated manager / receptionist browser logins | **Not available** in current `TblUser` set — not claimed as separate browser sessions |

`hr.workforce_availability` page grant does not replace attendance / transfer / weekly-schedule action permissions (unchanged product rule; not bypassed in UI walkthrough).

---

## Mutation artifacts

| Artifact | Cleanup |
|----------|---------|
| AdjustmentID 31 — `[P3C-ACC browser] add window` on GLEEM emp 18 | Soft-cancelled via UI; `IsActive=0`, `CancelledAt` set |
| No customer PII logged | Guest names only used in API acceptance harness with run tags |

---

## Final browser verdict

```text
BROWSER WORKFORCE UI WALKTHROUGH PASSED
```

Residual: ops-board poll invalidation not separately exercised (documented; not treated as Phase 3C logic failure when workforce refresh + history passed).
