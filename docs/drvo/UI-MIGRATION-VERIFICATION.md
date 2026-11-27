# DRVO UI migration — final verification handoff

Scope: #373 → #375 → #377 → #379 → #381 → #383 → #385 → final audit (#387).
Each branch contains the earlier work. All PRs target main for the existing CI trigger.
No production database access, schema migrations, API changes or deployment are part of this work.
The older #338–#343 stack must not be merged as a substitute for these reconstructed changes.

## Verification gates

- [ ] Latest final-head CI and targeted theme/permissions/payroll/booking/print checks green.
- [ ] Independent code review of cumulative diff and shared dialog behavior; resolve material findings.
- [ ] Authenticated staging UI smoke, using only the staging contract in AGENTS.md.
- [ ] Validate light, dark and system themes, initial paint and preference persistence after reload.
- [ ] Check RTL at 360, 390, 768, 1024 and 1440 CSS pixels; no unintentional page-level horizontal scrolling.
- [ ] POS: new invoice, existing invoice edit, branch and employee selection, services and discounts, payment/save/receipt and recovery warning on staging only.
- [ ] Today sales: all six views, filters, loading/error/empty state, keyboard sorting and row interaction, permission-gated delete on staging fixtures.
- [ ] Expenses/treasury: totals match before/after, form and list layout, transaction details; open/close day and shift on staging fixtures.
- [ ] Queue/bookings: desktop and mobile scheduler, create, transfer, call, cancel, calendar and availability.
- [ ] HR: attendance, daily payroll, ledger, advances, deductions and monthly report; verify existing accounting and access rules.
- [ ] Reports: partner/monthly/daily values and branch scope unchanged, print and PDF in both themes, no clipped columns.
- [ ] Admin: users, permissions, catalog, inventory and settings; verify denied users still denied and dialogs remain usable.
- [ ] Confirm final branch diff against current main, with no unintended files and no production DB access.

## Deferred / remaining scope

Employee-facing portal, branch-transfer interface, specialized CUT CLUB, WhatsApp, loyalty and accounting administration, advanced scheduler drawers, inactive placeholder routes (including payment methods), and full removal of the legacy CSS bridge are not claimed complete. Browser screenshots, interactive staging smoke and independent review were not performed by the builder. Passing CI is not a substitute for these gates.

## Merge and release

The human maintainer must approve and merge according to AGENTS.md. The earlier PRs are cumulative dependencies; merge in order only after the applicable gates, rechecking each diff/CI on current main. Alternatively the human maintainer may choose a single reviewed cumulative PR and explicitly supersede the earlier drafts. Every merge to main automatically deploys production. No agent merge or production deploy is authorized by this handoff.
