# Cut Salon — Financial Intelligence MVP

This is an incremental management-risk dashboard, not a replacement for the existing accounting or month close.

## Scope delivered

- Role-gated page: `/admin/financial-intelligence` (manager can view; admin/accountant can add commitments, record settlements, and save snapshots).
- Branch-scoped/all-branches reads, with the existing report-permission checks plus explicit tenant-to-location validation.
- MTD service revenue, treasury movement, accrued salary/commission entries, and all-time *book* treasury movement.
- One-time/monthly recurring commitments with optional final due date, partial settlement records, overdue alerts, 7/14/30-day dues.
- A manager-confirmed available-liquidity snapshot per branch and day (separate from book treasury). The 30-day indicative cash line **requires a confirmed same-day amount for every included branch**, plus 7 distinct observed activity days within the last 14 per branch; otherwise it reports an incomplete forecast and hides the chart.
- Manual immutable dated snapshot.
- Optional Gemini analysis. All calculated metrics stay server-authoritative; AI sees only aggregated metrics and type/due/amount (no customer or employee IDs).

## Required migration

After a verified SQL Server backup and staging verification, run:

`scripts/financial-intelligence/001-create-tables.sql`

This creates 4 isolated dbo tables; it does **not** mutate old cash/employee/budget tables. The UI intentionally fails with `FINANCE_SCHEMA_REQUIRED` until the schema is installed.

Register/sync the new page in `TblSystemPages` and assigned role permissions through the existing pages-registry sync. The registry change includes manager read-access and admin/accountant read/write (mutation checked separately).

## Gemini configuration

Server-only environment variables:

- `GEMINI_API_KEY` (or `GOOGLE_GENAI_API_KEY`)
- `FINANCIAL_INSIGHTS_AI_ENABLED=true` (feature disabled until explicitly enabled)
- optional `FINANCIAL_INSIGHTS_GEMINI_MODEL=gemini-2.5-flash`

No API key is sent to the browser. Do not add the key to `NEXT_PUBLIC_*` variables.

## Source of truth and accuracy warnings

- Book treasury balance is the net signed movement of **all time** by branch; it is **not reconciled available cash**. A manager must confirm available liquidity separately for each branch. This is a manual input and should be checked against cash, bank and wallet records.
- MTD service revenue excludes products and potentially non-service revenue.
- Treasury movement includes transfers, borrowing, settlements and other non-profit flows, so treasury net is **not** net profit.
- Payroll accrued is read from the employee ledger and is **not** the exact unpaid payroll liability.
- The 14-day running-outflow trend can already include periodic obligations. Subtracting separately registered future dues may double-count those categories. This is a preliminary *conservative indicator*, not an audited cash forecast.
- Manual settlements **do not create a cash movement**; they only reduce the tracked scheduled obligation. First reconcile actual settlement against the operational treasury to avoid overstating available funds.
- Unentered rent, supplier invoices, installments, staff liabilities and other expenses cannot be predicted. Reports explicitly warn when no obligations are registered.
- Each saved snapshot is an immutable per-scope/per-Cairo-calendar-day JSON report. Automated saves at 7/14/21/28 and year-end/month-end locking are **not yet implemented**.

## Validate

- `npx vitest run src/lib/financial-intelligence/__tests__/forecast.test.ts`
- `npx tsc --noEmit`
- `npm run lint`
- Staging smoke test after migration: log in as manager/admin/accountant; check one branch vs all, tenant isolation, confirm cash available for each branch, add rent monthly, add partial settlement, save snapshot, try duplicate save, verify disabled AI, then test with a limited-scope Gemini key.
- Never enable on production before reconciliation and authorization smoke tests.

## Next phase

- Strict treasury-linked settlements and reconciliation UI.
- Salary due/paid split and cost classification without double-counting.
- Save automatically at 7/14/21/28 plus month-end, with idempotent per-tenant scoped job and audit events.
- Independent baseline/best/worst scenario forecasts, more reliable expense segmentation and cash safety buffer.
- Historical comparisons and decision follow-up tracking.

