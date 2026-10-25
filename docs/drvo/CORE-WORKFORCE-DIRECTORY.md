# Core Workforce Directory (issue #110)

## Contract
`src/shared/workforce/public/directory.ts` defines `WorkforceDirectoryPort`:
- `getEmployee(actor, employeeId, filter?)` -> employee snapshot or null
- `listEmployees(actor, filter?)` -> employee snapshots

Use `createLegacyWorkforceDirectoryAdapter()` from `@/shared/workforce/public` at a trusted composition root. Pass an authoritative `ActorContext.tenantId`. The optional location filter takes a **canonical LocationId** and an explicit ISO date. Do **not** send legacy `BranchID` or guess UTC today.

The legacy adapter reads `TblEmp` by its authoritative `TenantId`. A location-filtered query additionally requires an active `Location` of the same tenant, active `TblBranch`, and an active dated `TblEmpBranchAssignment`, filtered by `EffectiveFrom/EffectiveTo`. It returns no rows for a foreign/unassigned LocationId, and never falls back to another tenant or CUT branch.

## Important limitations

This port only exposes **employee identity and declared active branch assignment on a date**. It does **not** prove booking availability, actual operational branch after a temporary transfer, schedule, doctor licensing/medical authorization, employment permissions, attendance or payroll amounts. Salon/Clinics should use their separate scheduling/clinical checks after this directory lookup.

No schema changes, runtime route changes, legacy endpoint rewrites, writes, new env variables, or production DB access. It is intended to be adopted gradually by Agent 2/3 at each module's composition root.

## QA
Targeted tests in `scripts/drvo/__tests__/coreWorkforceDirectory.test.ts` assert parameterized tenant/location/date filtering and invalid context behavior. GitHub CI exercises this directory test via `scripts/drvo/__tests__`. Two-tenant staging validation and Cut Salon regression are still independent gates; mocked SQL tests do not prove a staging query succeeds.

Any next-stage provider that needs historical assignments or temporary transfers requires an explicit extension, rather than silently broadening directory semantics.
