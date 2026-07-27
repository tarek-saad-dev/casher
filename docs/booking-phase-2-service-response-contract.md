# Booking Phase 2 — Service response contract

```json
{
  "ok": true,
  "branch": { "branchCode": "GLEEM", "branchName": "…" },
  "currency": "EGP",
  "pricingScope": "global",
  "categories": [
    {
      "categoryId": "19",
      "nameAr": "قص الشعر",
      "nameEn": "Hair Cut",
      "sortOrder": 10,
      "services": [
        {
          "serviceId": 9,
          "id": 9,
          "nameAr": "حلاقة شعر",
          "nameEn": "Hair Cut",
          "name": "Hair Cut",
          "descriptionAr": null,
          "descriptionEn": null,
          "price": 200,
          "durationMinutes": 30,
          "sortOrder": 1,
          "bookable": true,
          "imageUrl": null,
          "categoryId": "19",
          "categoryName": "قص الشعر"
        }
      ]
    }
  ],
  "services": [ "…flat same objects…" ],
  "groups": [ "…legacy category groups…" ],
  "meta": {
    "serviceCount": 30,
    "categoryCount": 6,
    "generatedAt": "ISO",
    "catalogVersion": "…",
    "contractVersion": "v2",
    "pricingScope": "global"
  }
}
```

## Guarantees

- Numeric `price`, positive integer `durationMinutes`
- No SQL/internal fields (`PPrice`, `Bonus`, `isDeleted`, stock, …)
- Deterministic category order: `TblCat.SortOrder` → Arabic name → id
- Deterministic service order within category: Arabic name → `serviceId`
- Empty categories omitted; uncategorized → `أخرى` / `uncategorized`
- No duplicate `serviceId`
- Descriptions null until a persisted safe text column exists
- Images only when public `http(s)` URL

## Errors (nested)

`BRANCH_*`, `SERVICES_NOT_CONFIGURED`, `SERVICE_CATALOG_UNAVAILABLE` via `publicBookingErrorCatalog`.
