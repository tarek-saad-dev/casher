# Receipt Studio — Operational rollout

See [architecture](./ARCHITECTURE.md). The studio is at
`/admin/settings/printing/studio` and is **admin-only**. It edits validated
JSON, not arbitrary HTML or CSS.

## What's included

- Tenant-wide default or current branch-only templates.
- Draft save with optimistic revision checks; immutable published version
  history; rollback creates a **new** published version.
- Small PNG uploads (<=150 KiB, <=576×1200 px) stored in SQL under the
  tenant ID, embedded as inline PNG on the Windows agent, avoiding remote
  asset fetching.
- Thermal proof and a manual, short demo print via
  `printHtmlViaLocalService({ receiptType:'other' })`. An explicit on-screen
  physical-result confirmation is required before publishing.
- Actual sale invoices resolve the signed-in tenant and active branch's
  published receipt, and fall back to the original invoice if there is no
  published template or the optional backend is unavailable.
- Real services, package print lines, employee attribution, discounts, payment
  allocations and `GrandTotal` come from the existing authenticated
  `/api/sales/[id]` response, not stored template data.

## Install required additive SQL migration

**This does not run automatically on application deploy.** Existing cashier
migration policy protects production DDL behind a verified backup.

1. Make and verify a usable SQL database backup/snapshot.
2. On the VPS under the configured `casher` account, from
   `/home/casher/app`, inspect the plan (no changes):
   ```bash
   npx tsx scripts/receipt-studio/apply-migration.ts
   ```
3. With a verified backup and approved maintenance window, run:
   ```bash
   npx tsx scripts/receipt-studio/apply-migration.ts --apply --backup-verified
   ```
   The SQL is at `db/migrations/receipt-studio-v1.sql`. It is additive and
   idempotent; it **never modifies invoice sales tables or printing services**.
4. Reload Receipt Studio. It should show a saved draft revision instead of
   the "schema not ready" error.
5. Save a draft, try the four sample cases (1/3/12 services, long English
   names), press Print Test on the **cashier Windows computer**, physically
   verify black/white text and automatic cut, then confirm and Publish.
6. Reprint **one already-recorded sale** through the normal cashier POS; check
   amounts/packages/split payments against the original. Roll back using the
   history selector if needed. No new sale required.
7. Sign in at the second branch and verify that branch override isolation
   works and a tenant default is used when no branch override exists.

## Thermal safety

- Paper roll: 80mm; printed canvas: **72mm**.
- Receipt has automatic dynamic height, optional **minimum** only.
- The local ESC/POS agent rejects any screenshot exceeding **576×4800 dots**.
- The local Windows agent's cut, spool status, receipt-type switches and printer
  name remain workstation-local. None are changed by the Studio.
- **Never use Chrome's XP-80 3276mm browser print setting.**
- A successful agent response only confirms spool acceptance. Physically
  confirm output, paper feed and cut.
- A 12-item sample or many PNGs can exceed the safe raster height; such jobs
  are rejected rather than truncated.

## Recovery

- Published versions are immutable; use `استعادة إصدار سابق` to create a
  new version with a previously published layout.
- When SQL is unavailable or no published template is found, actual sale
  invoices still use the original production receipt HTML.
- PNG uploads are tenant-scoped and bounded in file size and pixel count.
- No shared admin endpoint can select another branch by passing an arbitrary
  branch ID: branch scope always uses the authenticated user's active branch.
- Source rollback is via the usual Github PR revert if necessary.

## Remaining verification

The code and SQL migration need CI green and live DB application.
The UI can save and publish **only after** migration. Production print layout
will change **only after** an admin explicitly publishes a tested design.
