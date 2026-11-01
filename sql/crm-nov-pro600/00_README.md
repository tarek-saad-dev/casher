# NOV-PRO600 — November 2026 CRM segmentation (READ-ONLY)

Campaign: `NOV-PRO600` / PackageID **8** (November Protein Reset, 600 EGP).  
As-of default: `2026-11-01` (Africa/Cairo). Override with `@AsOfDate`.

## Safety

- Scripts are **SELECT-only**. Do not wrap in write transactions that mutate production.
- Do **not** `PRINT` / export full phone lists to shared logs.
- Recipient-level extracts (contract in `09_audience_data_contract.sql`) are for **authorized staff** to a **secured local path** only.
- Do **not** send WhatsApp or run unofficial automation from these scripts.

## Live schema anchors (verified)

| Entity | Table(s) |
|--------|----------|
| Customers | `dbo.TblClient` |
| Paid invoices | `dbo.TblinvServHead` + `dbo.TblinvServDetail` (`invType=N'مبيعات'`, `ISNULL(isActive,'no')='no'`) |
| Services | `dbo.TblPro` — Hair Cut **9**, Short Hair Protein **15**, Hot/Cold Towel **43**; other protein SKUs **16, 1077, 1113** |
| Packages | `dbo.TblServicePackage` / `TblServicePackageItem` — NOV-PRO600 PackageID **8** |
| Bookings | `dbo.Bookings` / `BookingServices` — package stamp in `Notes`: `[groomPackage] packageId=8;...` |
| Branches | `dbo.TblBranch` — operational: `GLEEM` (1), `CAMP_CAESAR` (3) |
| Follow-up / complaints | `dbo.TblCustomerFollowUp` (`ResultType='complaint'`) |
| Messaging history | `dbo.TblMessageOutbox`, `dbo.TblMessageInbox`, `dbo.TblBotMessage`, `dbo.TblBotConversation` |

## Consent blocker

**No marketing consent / WhatsApp opt-in / opt-out tables or `TblClient` columns exist.**  
Existing campaign audience builder (`src/modules/messaging/campaigns`) also does not check consent.  
Per policy: **do not infer consent from purchases, bookings, or phone possession.**  
Outbound marketing eligibility = **0** until a verified consent integration exists.

## Mutual exclusivity priority

Assigned once, first match wins:

1. `VIP`
2. `HAIR_CARE`
3. `HAIRCUT_REGULAR`
4. `INTERESTED_LEADS`
5. `LAPSED`

## Files

| File | Purpose |
|------|---------|
| `01_eligible_segment_counts.sql` | Aggregate report (no PII) |
| `02_haircut_regular.sql` | Segment A detail (masked phone) |
| `03_hair_care.sql` | Segment B |
| `04_lapsed.sql` | Segment C |
| `05_vip.sql` | Segment D |
| `06_interested_leads.sql` | Segment E |
| `07_suppression_exclusion_audit.sql` | Exclusion funnel |
| `08_overlap_duplicate_detection.sql` | Overlaps + phone dupes |
| `09_audience_data_contract.sql` | Secure recipient contract shape |
| `10_shared_params.sql` | Parameter declarations + constants |

## Snapshot results (as-of 2026-11-01, DB `last132`, READ-ONLY)

| Segment | Matching | Marketing consented | Final eligible (outbound) | Structural eligible* | Avg invoice | Avg days since visit | Prior revenue |
|---------|----------|---------------------|---------------------------|----------------------|-------------|----------------------|---------------|
| VIP | 187 | 0 | 0 | 187 | 196.59 | 81.8 | 368,840 |
| HAIR_CARE | 15 | 0 | 0 | 15 | 670.05 | 147.1 | 30,463 |
| HAIRCUT_REGULAR | 66 | 0 | 0 | 66 | 222.10 | 56.6 | 44,599 |
| LAPSED | 669 | 0 | 0 | 669 | 240.05 | 149.3 | 287,636 |
| INTERESTED_LEADS | 0 | 0 | 0 | 0 | — | — | — |
| **TOTAL** | **937** | **0** | **0** | **937** | — | — | — |

\*Structural eligible = matching after booking/complaint/frequency/phone exclusions, **before** consent gate.

**Outbound send-list status: BLOCKED** — missing verified WhatsApp marketing consent integration.
