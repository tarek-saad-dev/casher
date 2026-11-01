# Booking Flow — November Protein Reset (عرض بروتين نوفمبر)

| | |
|---|---|
| الباكدج | November Protein Reset / عرض بروتين نوفمبر |
| Internal code | `NOV-PRO600` |
| PackageID | **Assigned at seed time** — read from seed output / `GET /api/public/client/packages`. Do **not** hardcode. |
| PackageKind | `regular` |
| السعر | **600 EGP** TOTAL (included lines are not charged again) |
| الحملة | 2026-11-01 → 2026-11-30 (`Africa/Cairo`) |
| الخدمات المتوقعة | ProIDs `9` Hair Cut، `15` Short Hair Protein، `43` Hot / Cold Towel، Care Mask (**created or reused by seed**) |
| المدة | مجموع مدد كتالوج الفرع (حوالي 100 دقيقة: 30+60+5+5) — تُخزَّن في `DurationMinutes` |
| الفروع | `GLEEM` (جليم / سابا باشا) و`CAMP_CAESAR` — حسب توفر الخدمات والbarbber |
| العمولة | `Bonus = 0` على سطور الباكدج في الـPOS (لا تُضاعَف عمولات الخدمات الأربع) |

`NotesAr` يحمل `[seed:NOV-PRO600]` و`[campaign:code=NOV-PRO600;from=2026-11-01;to=2026-11-30;tz=Africa/Cairo]`.

## Seed

```bash
npx tsx scripts/seed-november-protein-package.ts --dry-run --cloud
npx tsx scripts/seed-november-protein-package.ts --apply --cloud
# production last132 requires explicit human flag:
npx tsx scripts/seed-november-protein-package.ts --apply --cloud --allow-production
```

Idempotent: re-running updates the same package row; does not duplicate items.

October Package (`REGULAR_OCTOBER_2026` / historically PackageID `7`) is **soft-deleted** for new bookings. Historical bookings, invoices, and payments stay. POS handoff from an old October booking still works via `allowInactive` on `/api/pos/groom-packages/from-booking/[id]`.

## Website / API

1. `GET /api/public/client/packages` — lists active packages in the campaign window (October hidden; November shown 1–30 Nov Cairo).
2. Plan / check-slot / create with the **real** `packageId` from the catalog:
   - `POST /api/public/booking/plan` `{ packageId, date, … }`
   - `POST /api/public/booking/check-slot`
   - `POST /api/public/booking/create`
3. Dates outside 2026-11-01…2026-11-30 → `PACKAGE_OUTSIDE_CAMPAIGN_WINDOW`.
4. Soft-deleted / ended packages → `PACKAGE_NOT_ACTIVE` or omitted from catalog.

## POS

- `GET /api/pos/packages` / `POST /api/pos/packages/resolve`
- Invoice shows package name; commercial total = **600**; included lines at 0; paid extras remain separate.
- Revenue counted once via package price on the anchor line.

## Commercial / ops notes

- Short hair only at 600 EGP; longer/thicker hair must be quoted — no silent price increase in this package.
- Care Mask type (face vs hair) is TBD — generic service; remap package item when confirmed.
- Do not claim a 1,000 EGP “was” price unless verified; `OriginalPrice` is the live standalone sum at seed.
- Protein **material inventory** is not deducted for service ProID 15 (services are not stock-tracked). Track consumption outside POS stock movements if needed.
- Camp Caesar “first visit” marketing discount is **not** auto-applied; cashiers can still add a manual discount — avoid stacking with this promo by policy.

## Tests

- Unit: `src/lib/__tests__/packageCampaignWindow.test.ts`
- Existing package booking unit tests remain authoritative for price/duration split
- Seed dry-run / apply verification prints PackageID and service mapping
