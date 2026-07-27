# Booking Phase 2 — Services catalog audit

**Scope:** Casher backend / last132. cutsaloon.com unchanged.  
**Date:** 2026-07-24

## Schema (live)

### TblPro (service/product master — global, not branch-priced)

| Column | Meaning | Public usage | Booking relevance | Data-quality risk | Contract mapping |
|--------|---------|--------------|-------------------|-------------------|------------------|
| ProID | PK / immutable id | yes | required | low | `serviceId` / `id` |
| ProName | English/primary name | yes | required | mixed AR/EN | `nameEn` / `name` |
| ProNameAr | Arabic name | yes | preferred | often null | `nameAr` |
| SPrice1 | Sell price | yes | required | null on smoke rows | `price` (number) |
| PPrice | Purchase/cost | **never public** | no | leak risk if exposed | omitted |
| DurationMinutes | Service minutes | yes | required (>0) | 14 active rows null/0 | `durationMinutes` |
| isDeleted | Soft delete | filter out | required | 15 deleted rows | omitted when filtered |
| ProType | serv/pro | filter | classification | often null | eligibility only |
| CatID | FK → TblCat | yes | category | 2 uncategorized active | `categoryId` |
| Bonus / BonusPercent | Staff commission | **never public** | no | — | omitted |
| Qty / Barcode | Inventory | **never public** | no | — | omitted |
| ProDis / ProDisVal | Discount fields | **never public** | plan later | not descriptions | omitted |
| QuickSales | POS flag | no | low | — | omitted |
| ImageUrl | Optional image | yes if http(s) | optional | local paths unsafe | `imageUrl` or null |
| btnColor | UI color | no | no | — | omitted |

**No columns today for:** public bookable flag, service description text, service sort order, branch price.

### TblCat

| Column | Meaning | Public usage | Booking relevance | Risk | Mapping |
|--------|---------|--------------|-------------------|------|---------|
| CatID | PK | yes | category id | — | `categoryId` (string) |
| CatName | Display name | yes | AR/EN source | no CatNameAr | `nameAr`/`nameEn` (+ temp map) |
| CatType | serv/pro | filter products | high | mis-tagged cats (`معالجات شعر`=pro) | eligibility |
| SortOrder | Display order | yes | primary order | backfilled | `sortOrder` |
| btnColor | UI | no | no | — | omitted |

## Live counts (2026-07-24 probe)

| Metric | Count |
|--------|------:|
| Total TblPro rows | 59 |
| Active (`isDeleted=0`) | 44 |
| Active priced (SPrice1 or PPrice > 0) | 44 |
| Active timed (DurationMinutes > 0) | 30 |
| Legitimate public-bookable (policy approx.) | **30** |
| Retail products (ProType/CatType/name) | 10 |
| Soft-deleted | 15 |
| Invalid duration (active, duration 0/null) | 14 |
| Invalid negative price (active) | 0 |
| Uncategorized (CatID null, active) | 2 |

## Route / loader audit

| Surface | Notes |
|---------|-------|
| `GET /api/public/booking/services` | **Migrated Phase 2** — central branch context + eligibility module |
| `GET /api/services/catalog` | Nested admin/ops catalog; sales-count sort; allows null duration |
| `GET /api/services?active=true` | Flat list; `bookable=true` uses similar but not identical filters (no duration gate) |
| Admin `/admin/services` | CRUD + restore; Phase 2 badges for duration/price/product/public-bookable |
| `empServiceDuration` / `servicePlan` | Plan/slots still fall back to system default when DurationMinutes null — **mismatch** vs public catalog |
| Old public route | Used `ISNULL(DurationMinutes, fallback)` — **removed** for catalog honesty |

## Classification defect

`ProType` is frequently null. Product isolation relies on `CatType='pro'` + Arabic product category name patterns + ProType when present. Some historically service-like categories (`معالجات شعر`, `كريم شعر`) are `CatType=pro` and stay excluded — do not broadly reinterpret.

## Duration consumers (converge later)

1. Public catalog → `TblPro.DurationMinutes` only (strict)
2. `empServiceDuration` → override → service → system default
3. `servicePlan` / availability engine / available-slots → same fallback chain
4. Ops UI often shows `?? 30`

Phase 2 documents the mismatch; does not migrate slots/plan/create.
