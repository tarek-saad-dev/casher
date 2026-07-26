# Phase 1M — Smoke Rollback Runbook

## Before first smoke

1. Confirm backup/restore for `last132`  
2. Capture schema/migration version (1M lifecycle migration applied)  
3. Capture GLEEM fingerprints (counts/totals by BranchID)  
4. Confirm PH1GTEST baseline (inactive / SETUP, zero ownership preferred)  
5. Confirm WhatsApp master off for smoke / ExternalSideEffectsEnabled=0  
6. Dry-run: `npx tsx scripts/branch-smoke/cleanup-branch-smoke-run.ts --smoke-run-id=N`

## Levels

### Level 1 — Stop

Disable smoke access; abort run (`Status=ABORTED`).

### Level 2 — Artifact cleanup

```bash
npx tsx scripts/branch-smoke/cleanup-branch-smoke-run.ts --smoke-run-id=N --confirm
```

- Requires SmokeRunID  
- Refuses GLEEM  
- Expects PH1GTEST  
- Marks artifacts; returns branch to SETUP  

Prefer normal reversal APIs for financial artifacts before hard deletes.

### Level 3 — App rollback

Deploy previous application build if regression.

### Level 4 — DB restore

Only when proven necessary and approved. **Not** routine smoke cleanup.
