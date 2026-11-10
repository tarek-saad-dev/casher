# CUT Receipt Studio — Architecture & Rollout Plan (ADR-001)

Status: **proposed / implementation foundation** (2026-11-10). This document does **not** activate a new production invoice template or mutate sales.

## Why

The XP-80 physical cashier printer is working through the existing local Windows `CUT Print Agent` using ESC/POS raster and auto-cut. Browser printing through the XP-80 driver has shown a bogus fixed roll page of `80(72.1) × 3276mm`, so **new designs must never rely on Chrome's print dialog for the normal path**. Users need a visual editor to customize invoice look and length without touching HTML/CSS or losing dynamic sale data.

### Current code anchors (main, audited)
- Admin controls: `src/app/admin/settings/printing/page.tsx`, `src/lib/localPrintClient.ts`.
- Sale invoice: `src/components/pos/PrintInvoiceModal.tsx` builds HTML and calls `printHtmlViaLocalService(...receiptType:'invoice')`.
- Agent: `print-service/server.js` captures HTML with Chromium into a PNG, `print-service/escpos.js` converts it to RAW ESC/POS, respecting persisted local switches (`print-service/printSettings.js`).
- Agent safety limits: **width <= 576 raster dots, height <= 4800 raster dots**, captured at 2× device scale, printer setting and auto-cut are **workstation-local**.
- Existing UI stack: Next.js 16, React 19, Lucide, Radix; no existing Fabric/Konva dependency.
- Existing backend: SQL Server; session, tenant, branch, and admin helpers in `src/lib/api-auth.ts`, `src/lib/branch/context.ts`.
- Existing brand source: `TenantBrandProfile` / `getPrintBrandHtml()`. Existing service `ProName` is English, `ProNameAr` is optional Arabic.

## Decision: constrained visual editor, not unrestricted HTML canvas

Use **DOM/CSS as the canonical layout and render engine** with mm-sized thermal artboard, driven by a **versioned, validated JSON template**. The editor's canvas may visually support drag/drop and selectable properties, but the following mandatory business blocks flow **vertically**: invoice meta, line-items, totals and payment. Reordering is constrained to preserve logical order and prevent overlap when an invoice has 1 vs 12 services.

Only **decorative elements** (PNG logo, watermark, small caption, simple icon) get optional bounded x/y positioning inside a section; drag handles, snapping, mm guide ruler and layer ordering can follow in V2. No arbitrary HTML, CSS or script can be stored in a template. We do not introduce a heavyweight drawing library in V1.

### Screen: `/admin/settings/printing/studio`
- **Left**: presets + component palette (brand, metadata, items, totals, payment, divider, text, image, footer, QR later).
- **Center**: fixed 72mm printable artboard inside an 80mm roll outline; rulers; zoom for screen only; live sample data; actual page-length meter.
- **Right**: selected section properties (visibility for optional blocks, type size, weight, alignment, vertical spacing, image asset and placement).
- **Top**: undo/redo, autosave draft, revert, sample (1/3/12/long-title services), thermal preview, one controlled local test, publish, version history/rollback.

### Paper model
```
rollWidthMm = 80       // workstation-supported paper profile, not editable by arbitrary CSS
printableWidthMm = 72  // XP-80 hardware safe profile
heightMode = "auto"    // always computes actual DOM height + bounded feed
minHeightMm = 0..260   // optional MINIMUM only, never force a maximum with clipping
```
A user-entered 'length' is a **minimum / visual target**, not a fixed hard height. Printing a long invoice must expand naturally. Before accepting a job, measured PNG dimensions must be within `576 × 4800`; oversize jobs **fail closed**, no scaling to illegible text and no extra blank 3m paper. Add margin/blank-feed choices only within strict safe caps.

**Thermal preview** uses the same HTML->raster conversion and black/white threshold used by the local agent (currently `gray < 170`). A 10%-gray watermark may disappear, so show a real monochrome preview and warn when rasterized ink coverage is excessive. White paper has no beige ink.

## Template format

`ReceiptTemplateV1` is a strictly allowlisted, versioned JSON document (foundation implementation: `src/lib/receipt-studio/template.ts`):
- `schemaVersion: 1`, `receiptType: "invoice"`;
- `paper: { rollWidthMm: 80, printableWidthMm: 72, heightMode: "auto", minHeightMm }`;
- `blocks[]: { id, kind, enabled, style, text?, assetId? }`, order = array position.
- `kind`: `brand`, `invoice-meta`, `items`, `totals`, `payment`, `divider`, `text`, `image`, `footer`.
- `items` and `totals` mandatory, exactly once; `items` precedes `totals`.
- Only a server-owned resolver can fill **dynamic tokens** (invoice number, paid amounts, branch name, service names and totals). A template editor must not supply price calculations or client-side HTML.
- Image blocks refer to verified `assetId` from the same tenant, never external URLs from template content.
- Keep all values bounded, with schema validation on **server AND client**. No `dangerouslySetInnerHTML` from user-provided text.

### Data / ownership

**SQL Server (future additive migration, not in PR-1):**
1. `ReceiptStudioTemplate`: TemplateId, TenantId UNIQUEIDENTIFIER, BranchId INT NULL (null = tenant default), ReceiptType, DraftJson, DraftRevision, PublishedRevisionId, UpdatedByUserId, UpdatedAt, RowVersion.
2. `ReceiptStudioRevision`: immutable RevisionId, TemplateId, Version, SnapshotJson, PublishedByUserId, PublishedAt, ContentHash.
3. `ReceiptStudioAsset`: AssetId, TenantId, owner/size/dimensions/mime/approved storage key, created-at; reuse existing configured upload pipeline only after validating PNG/SVG policy, decodable pixels, dimensions, alpha and tenancy.
4. Audit event history (publish, rollback, edits) with user + tenant + branch, optionally using existing audit facilities.

**Tenant/branch rule:** every query is scoped by session-bound TenantId and validated BranchId (via `requireBranchAdminAccess` plus `branchAdminTenantScopeResponse`), not untrusted client input. Resolve *branch-specific published override* first, then *tenant default published template*, then **unchanged legacy invoice**.

**Permission rule:** editing/publishing limited to authenticated admins and explicit future Receipt Studio `canEdit/canPublish` permission. Cashiers can print but cannot edit or publish. Enforce in API handlers, not just menu visibility.

**Concurrency:** PUT draft with `expectedDraftRevision`/rowversion, respond 409 on stale edit; publishing is an atomic immutable revision update, so draft remains editable without changing active receipts.

## API endpoints (future phases)

| API | Purpose |
| --- | --- |
| GET `/api/admin/receipt-studio?branchId=...` | Draft, published snapshot metadata; admin + tenant branch scope |
| PUT `/api/admin/receipt-studio` | Validated draft, optimistic concurrency |
| POST `/api/admin/receipt-studio/publish` | Validate, persist immutable version and activate atomically |
| POST `/api/admin/receipt-studio/rollback` | Select a previously published version with audit |
| POST `/api/admin/receipt-studio/preview` | Server generates sanitized receipt HTML from sample fixture only |
| POST `/api/admin/receipt-studio/assets` | Bounded approved PNG upload, tenant-scoped; no arbitrary remote URLs |
| GET `/api/receipt-studio/invoice/[id]` | Authenticated receipt read: fetch real sale with branch scope, resolve published snapshot and server-render HTML |

For V1 proof-of-concept before SQL migration, use a **local draft in editor memory only** and an explicit non-persistent demo; never claim it is saved or published.

## Rendering and actual print flow

```
Admin edit -> Template JSON -> validation -> draft SQL
            -> sample preview -> controlled Agent test
            -> publish atomic revision in SQL
Cashier sale -> auth/session/tenant/branch
            -> fetch sale data (authoritative existing code, include packages/split payments)
            -> resolve branch published / tenant default / legacy
            -> shared deterministic HTML renderer
            -> localPrintClient (receiptType: invoice, requestId dedupe)
            -> Print Agent 127.0.0.1:7788
            -> Chromium screenshot -> size bounds -> ESC/POS RAW -> XP-80 + auto cut
```

**No remote print spooler, no arbitrary browser print in normal flow, no silent fallback when policy disables a receipt.** Local cut/on/off and printer name continue living in the workstation settings store; the central database only stores **design**. Never mix receipt-layout settings with print hardware state.

Use existing package/invoice mapping from `PrintInvoiceModal.tsx` (package child rows, subtotal/discounts, split payments) rather than recalculating totals. Validate all user strings before HTML interpolation. Keep legacy renderer as fail-closed fallback if no published design is present or a rollout is disabled. Do not put raw sensitive customer data into saved templates.

## V1 scope / incremental PRs

**PR-1 (architecture + contract):** this ADR, versioned JSON types, validator/default minimal CUT receipt, pure unit tests; no route, DB, printer or production invoice changes.

**PR-2 (editor skeleton):** `/admin/settings/printing/studio`; mobile view-only, desktop editable; preset, section reorder, text/font/spacing, auto/min length, one fixture in live preview, undo/redo. Local draft only, no publish.

**PR-3 (persistence):** additive SQL schema migration, branch/tenant access, read/save with concurrency; draft survives reload and remains unexposed to cashiers.

**PR-4 (assets + thermal parity):** bounded tenant-scoped PNG upload and gray/raster preview, print with the existing local agent as **explicit manual test only**; physical XP-80 proof for 1/3/12 services, RTL, English names, large totals, no long blank feed.

**PR-5 (publishing + integration):** immutable snapshot, publish/rollback permissions, config-gated routing into actual invoice printing; first one cashier workstation/branch; preserve legacy fallback.

**PR-6 (advanced design):** optional decor x/y drag & snap, QR, multiple paper profiles, per-branch assignment, version compare and audit UI; only after physical safety tests.

## Acceptance / hard safety gates
- Rendering a 1-item or 12-item invoice does not clip service names, amounts, dynamic totals, discounts, split payments or footer.
- Input `minHeightMm` only sets a minimum; dynamic rows grow without artificial page gaps.
- Every rendered raster <= 576 × 4800 dots; reject oversized renders *before* sending RAW.
- No Chrome print dialog in the default user path; agent sends finite job, cuts once.
- Saving a draft never changes the currently published invoice.
- Branch A cannot read/write/publish Branch B template from another tenant; users without role cannot publish.
- A bad image, stale version, missing SQL table, or unavailable local Agent does not overwrite or silently change existing production sale invoices.
- No rollout until CI green, isolated DB migration smoke, screenshot parity, and user-confirmed XP-80 print.

## Non-goals for PR-1
- No deployment, no migration or modification of currently printed templates.
- No unrestricted arbitrary HTML / CSS / JS.
- No PDF/Chrome-based production printing.
- No per-workstation hardware state stored in central SQL.
