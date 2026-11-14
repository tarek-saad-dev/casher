# CUT Classic — protected original invoice design

Status: **source snapshot + editable Studio preset**. Adding the preset does not publish a new invoice or change the current Windows print flow.

## Original master design

The printed receipt from CUT Salon (14 Nov 2026) is the existing **legacy printed receipt** produced by
`src/components/pos/PrintInvoiceModal.tsx`. It includes:

- Double outlined receipt frame on 80mm thermal paper, 72mm printable area
- Striped barber-pole ornaments and a circular CUT logo
- "CUT SALON", Arabic subtitle and phone
- Decorated receipt title, invoice number, date, time, customer and payment
- Bordered service/barber/price table
- Outlined totals with bold grand total
- Gift panel "اسأل على هديتك"
- Thank-you message, footer phone and lower ornaments

**Preservation strategy:** `src/lib/receipt-studio/classicStyle.ts` stores the original *verbatim* production thermal CSS. `PrintInvoiceModal.tsx` imports that same CSS as the existing legacy fallback. The original printed HTML structure remains in the legacy printer flow, with no automatic migration or replacement.

`CUT_CLASSIC_ORIGINAL_V1` in `src/lib/receipt-studio/template.ts` is the stable protected Studio preset. `newCutClassicEditableCopy()` creates a separate, editable validated JSON clone. Editing labels, sections and decorations through Receipt Studio must not mutate the master. Static copy contains **no customer or transaction data**: these values always come from the authenticated sales record.

## Using the template

1. Open `/admin/settings/printing/studio` as an administrator and select the desired branch or tenant scope.
2. Click **نسخة قابلة للتعديل من CUT Classic**. Edit the copy's layers, labels, text, font and spacing; the master remains available through **استعادة الأصل**.
3. Review a sample with 1, 3, 12 services and long titles; the editor uses the same sanitized renderer used for a published Studio invoice.
4. Click **حفظ المسودة** (requires the optional Receipt Studio SQL migration). Draft edits do **not** change the cash register's live printout.
5. Send exactly **one** manual paper test and verify layout, Arabic/English legibility, paper length and cutter.
6. Only then click **اعتماد التصميم** to publish a versioned snapshot. Roll back to a previously published version using the Studio history.

## Caveats

The classic Studio renderer reuses the **same original CSS**, but is a constrained validated **block-based reconstruction** of the legacy HTML. Preview and physical print can differ slightly from the existing live legacy receipt because the Studio's dynamic sale model and grouping differ. Do not claim pixel-for-pixel identity until an XP-80 physical proof. The original legacy receipt remains unchanged until an administrator intentionally publishes.

Do not embed customer names/phone numbers from a photographed invoice into a preset or repository file. Source version history and `CUT_CLASSIC_ORIGINAL_V1` protect the baseline; SQL published-history rollback protects separately published versions.
