# Manager daily workspace

Requested in #95: use existing staff login and a simple manager home for attendance edits and the existing automatic close. Manager account receives full requested administrative permissions; credentials must never enter source control.

- [x] Reuse existing attendance editor on `/manager` with the selected work date as the close date.
- [x] Block close for unsaved edits, loading, save operations, or attendance errors; freeze controls during close.
- [x] Confirm existing all-active-tenant-branches/default-fill behavior and suppress WhatsApp.
- [x] Preserve backend auth and calculation rules; report partial failures without success.
- [x] Manager role lands on `/manager` and skips cashier shift prompt; other roles retain behavior.
- [x] Use a compact authenticated manager shell; keep full administration accessible.
- [ ] Authenticated staging smoke, account provisioning, and human production merge.

## Account provisioning (not performed)

Use the existing authenticated user creation flow with login name `TT`, UserLevel `admin`, the intended tenant membership, and a valid default tenant branch. Supply the requested password privately at execution time. Grant existing `manager` and `super_admin` roles through the audited permissions flow to satisfy the requested full access and manager landing. Do not overwrite an existing TT account or reset its password without verifying ownership. Verify staff login, landing, branch access, attendance edits, and close in staging. Do not execute a live close merely to test login.

No production credentials or authenticated admin session are available in this workspace. Repository AGENTS.md prohibits direct production database operations and requires human merge for deployment. The account has NOT been created.
