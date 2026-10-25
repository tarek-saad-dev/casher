# Core Tenant Shell — active Location contract (issue #114)

`GET /api/tenant/context` already returns brand, tenant, installed applications and commercial subscription from the authenticated staff session. It now also returns `tenant.activeLocation` as the canonical `TenantLocationRef` with:
- `locationId` (DRVO UUID)
- `legacyBranchId` (compatibility numeric ID)
- `branchCode`
- `timezone`

The value comes directly from `authenticateTenantShell().tenant.activeLocation`, which resolves active membership and current Location inside the same Tenant. No browser-supplied branchCode, client `tenantId`, new SQL lookup or fallback to GLEEM/CASHER_BOOT is introduced.

Consumer guidance: Agent 4 may use this field to display the selected workspace/branch in the owner UI. App services must **not** use `activeLocation` in browser JSON as permission proof; their server handlers continue to use verified staff TenantContext and location grants. This is view metadata, not an authorization change.

The type extends the existing `TenantShellSnapshot`; no route changes to current POS, Booking, Payroll or Clinics. No migration, production mutation or new feature gate. Tests in `scripts/drvo/__tests__/coreTenantWorkspaceLocation.test.ts` verify binding and unauthenticated rejection. A full first-run UI and staging two-tenant smoke remain Agent 4/Agent 5 handoffs.
