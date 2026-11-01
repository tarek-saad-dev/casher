# NOV-PRO600 — WhatsApp marketing template submission pack

Campaign: **NOV-PRO600** · PackageID **8** · 600 EGP · Nov 2026  
Internal template key: `whatsapp.campaign`

## Provider reality (do not over-claim)

Casher outbound path today:

1. Campaign → `TblMessageOutbox` → outbox worker  
2. `sendViaTenantChannel`  
3. Either:
   - **Bridge gateway** (`WHATSAPP_API_BASE_URL` → `POST /api/whatsapp/send`) whose readiness signals are `chromeConnected` / `whatsappReady` / `whatsappTabFound` (WhatsApp Web / Chrome-session style bridge — **not** Meta Cloud API), or
   - **DRVOWA** paired instance when active for the tenant (`deliveryProvider: DRVOWA`)

There is **no** verified Meta Graph / Cloud API template submit+send integration in this repo.  
Until CUT Salon is on an official WhatsApp Business Platform (Cloud API / BSP) with an **approved** marketing template, do **not** claim Meta-approved template delivery for bulk campaigns.

## Recommended Meta / BSP submission copy (Arabic)

**Category:** MARKETING  
**Language:** Arabic (`ar`)  
**Name (suggested):** `nov_pro600_protein_reset_v1`

**Body:**

```text
أهلاً {{1}} 👋

عرض نوفمبر في CUT Salon ({{2}}):

✨ باقة NOV-PRO600 بسعر 600 جنيه فقط
قص شعر + بروتين شعر قصير + فوطة ساخنة/باردة + ماسك عناية

مناسب للشعر القصير بعد تقييم المختص في الصالون.
احجز موعدك خلال نوفمبر.

فريق CUT Salon
```

**Variables:**

| Position | Meaning | Sample |
|----------|---------|--------|
| `{{1}}` | first_name | أحمد |
| `{{2}}` | branch_name | جليم – سابا باشا |

**Footer (optional):** العرض ساري خلال نوفمبر 2026 · يخضع للتقييم المهني

**Buttons (optional):** URL → public booking link for CUT Salon

## Casher mapping after BSP approval

| Meta / BSP | Casher |
|------------|--------|
| Approved template name | Store as active content for `whatsapp.campaign` (Admin → واتساب → القوالب) |
| `{{1}}` | `first_name` |
| `{{2}}` | `branch_name` |

Until BSP approval lands, keep NOV-PRO600 campaigns in **draft** and use allowlisted **test send** only.

## Consent gate (unchanged)

Outbound eligible recipients require rows in `TblMarketingConsentEvidence` with `Status = granted`.  
Do not backfill consent from purchases or phone possession.

Schema apply path: DRVO migration key `marketing-consent-evidence` (id 20) via the migration control plane / staging gate — not a silent production side-script.
