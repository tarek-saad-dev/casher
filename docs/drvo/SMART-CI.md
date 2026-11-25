# Change-based CI (issue #346)

## PR checks

The existing three check names are retained for branch protection compatibility. Every PR still runs the main DRVO check; it always requires successful change selection, the selector tests, tenant isolation/API entitlement regression, database safety guard, deploy script syntax and the production build. The legacy global typecheck debt is unchanged.

The selector compares the PR base SHA to the checked-out GitHub merge commit with a NUL-delimited, no-rename Git diff. It selects the union of affected groups. Deletions and both sides of renames count. Unclassified/shared paths (including database, tenant/auth, workflow files, migrations, lockfiles and shared layouts), missing/empty diffs and selector input errors select all groups. A failed selector job fails the main check. A narrow allowlist of docs changes skips domain groups, not core gates. When adding a new module, add a conservative selector rule and test; until then the default is full.

The regression inventory contains every previously configured unit/contract suite. Domain tests run in a single Vitest invocation; changed test files are also included unless deleted or DB integration tests. The optional selfServiceJourney suite is included once the onboarding PR introduces it. Printer jobs still use the same job IDs and names but are skipped when the printing group is not selected. Payroll rehearsal syntax/path checks run for payroll or full mode.

## Full regression

The same CI workflow runs its full retained regression inventory on schedule (02:17 UTC daily) and via manual workflow_dispatch. This is the existing safe CI inventory, **not** all historical tests or live database integration suites. No production deploy or database access is part of CI. Staging gates and deployment workflows are unchanged.

## Rollout

Check existing required checks/rulesets in GitHub before merging: the integration could not read branch protection (HTTP 403), and did not change it. Keep the main DRVO validation check required. The print checks retain their names and report skipped when irrelevant. This PR itself runs full mode because CI files changed. Compare its full run and a subsequent targeted PR to measure runtime improvement. If #345 is still open, update it against main and resolve the CI file overlap by retaining the new workflow and its onboarding coverage. Do not remove staging/review requirements.
