# Premium Onboarding V3 — release QA gate (PR #372)

## Verified baseline
- Commit 091374a95ea02321dca08e6a021e093ff16fe3d9: [CI #46032693402](https://github.com/tarek-saad-dev/casher/actions/runs/46032693402) passed.
- Domain regressions: 350 passed (49 files); tenant isolation / entitlement checks: 83 passed, 1 skipped (6 files); another regression group: 7 passed. Production build compiled successfully.
- Global TypeScript validation is skipped by existing build configuration. Staging gates and browser E2E were skipped; the above is not a live-system verification.
- Follow-up fixes: match the API's currency precision in catalog readiness and exercise the actual no-OTP UI submission against a mocked endpoint. Recheck the final PR head in CI.

## Required staging smoke before production
Use an isolated staging tenant/database; never run this checklist against last132 or existing customer accounts. Verify the server OTP flag is off for this test; do not bypass an enabled verification requirement.

| Area | Acceptance |
| --- | --- |
| Registration | 320/390/768/1440 px widths, RTL, no horizontal clipping; five steps; previous/next; invalid phone/password; revisiting same industry retains selections; no OTP request when server flag is off; one actual staging registration; duplicate and error handling. |
| Identity | Name, valid HTTPS logo, colors and receipt preview; save-and-continue only after successful PUT; cancel restores saved fields; conflict and invalid URL produce usable errors. |
| Catalog | Existing names excluded; bulk selection; positive prices up to 2 decimal places; duration 5–600 minutes; partial failure/retry without overwriting existing services. |
| Team | Current branch roster/search; employee creation; optional pay and booking only for installed apps; verify no duplicate pay changes. |
| Operating | Real payment list, booking preferences save/cancel, no public booking activation; disconnected printer is not marked ready; no financial write. |
| Training | Available-app exercises; card versus cash reconciliation; reset; no operational API writes, storage or financial effects. |
| Launch | Explicit day and shift actions; no duplicate or cross-branch shift; first-sale indicator reflects actual staging invoice evidence only; sale not required for setup completion. |
| Isolation | Use two independent staging tenants; verify identity, catalog, employees and progress do not cross tenant boundaries; test unauthorized access and existing CUT exclusion. |

## Release decision
Do not represent the release as production-ready until final-head CI and staging browser smoke pass. Record evidence/screenshots for desktop and mobile. No OTP activation, production DB change, merge or deploy is authorized by this checklist. Direct logo upload remains deferred.
