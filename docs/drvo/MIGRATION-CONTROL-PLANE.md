# DRVO Production Migration Control Plane

This control plane separates migration authoring/review from production database execution.

## Trust boundaries

- Agents/Codex may create and review migration code.
- Agents/Codex must not receive production database credentials.
- Production execution happens only through `.github/workflows/drvo-production-migration.yml`.
- The executor reuses the existing production VPS and its local application environment.
- Application deployment remains a separate workflow and a separate approval.

## Lifecycle

```text
PR_WITH_MIGRATION
→ MIGRATION_PLAN
→ READY_FOR_MIGRATION_APPROVAL
→ TAREK_APPROVES_MIGRATION
→ MIGRATION_APPLY
→ MIGRATION_APPLIED
→ READY_FOR_TAREK
→ MERGE
→ APP_DEPLOY
```

A migration approval is not an application merge approval.

## PLAN

ChatGPT creates/updates `.github/drvo-migration-command.json` on the dedicated
`migration-control` branch:

```json
{
  "action": "PLAN",
  "requested_by": "tarek-saad-dev",
  "pr_number": 123,
  "target_sha": "<exact PR head sha>"
}
```

PLAN is read-only against production. It reports:

- exact source SHA
- manifest digest
- exact pending migration keys and checksums
- risk classification
- lock profile
- whether a backup reference is required
- checksum drift / unknown registry rows

PLAN never calls the migration registry ensure/apply path.

## APPLY

After Tarek explicitly approves the migration, ChatGPT copies the exact digest and
migration list from the successful PLAN into the control command:

```json
{
  "action": "APPLY",
  "requested_by": "tarek-saad-dev",
  "pr_number": 123,
  "target_sha": "<same exact PR head sha>",
  "manifest_digest": "<64 hex sha256>",
  "migrations": ["migration-one", "migration-two"],
  "backup_reference": "snapshot-or-backup-id",
  "approval": "TAREK_APPROVED_PRODUCTION_MIGRATION"
}
```

The executor refuses APPLY if any of these changed after approval:

- PR head SHA
- migration manifest digest
- pending migration set/order
- released migration checksum
- production database identity

If a pending migration declares `requiresBackup: true`, APPLY also refuses without
a non-empty backup reference.

## Production executor

The GitHub-hosted workflow:

1. validates the command actor and exact open same-repository PR head;
2. checks out the exact approved SHA;
3. stages that exact source into an isolated directory on the existing VPS;
4. copies production DB environment files only inside the VPS;
5. installs dependencies in the isolated workspace;
6. runs `scripts/drvo/production-migration-control.ts`;
7. verifies `DB_NAME() = last132`;
8. revalidates the approved plan;
9. applies the central DRVO migrations;
10. executes each migration's existing verify hook;
11. records commit SHA, approval reference, backup reference, checksum and duration;
12. comments the PR with the result;
13. deletes the isolated migration workspace.

The workflow never merges the PR and never invokes the application deploy workflow.

## Migration metadata

Every migration must declare:

- `kind`: schema / data / mixed / verification
- `risk`: LOW / MEDIUM / HIGH
- `requiresBackup`
- `lockProfile`: none / short / potentially-blocking
- `rollbackStrategy`

This metadata is included in the manifest digest, so changing risk/rollback metadata
after approval invalidates the production apply.

## Registry audit

`dbo.DrvoSchemaMigration` continues to be the immutable applied-migration registry.
The registry also records:

- `ApprovalRef`
- `BackupRef`

Older registry tables are still readable by PLAN without altering production schema.
The audit columns are added idempotently only when the normal migration runner is
allowed to mutate the database.

## Failure behavior

Any mismatch fails closed.

No production apply occurs when:

- actor/request marker is invalid;
- PR is closed, from a fork, or no longer targets `main`;
- PR head changed;
- manifest digest changed;
- pending migration set changed;
- an applied migration checksum changed;
- unknown applied registry rows exist;
- backup-required migrations have no backup reference;
- DB name is not `last132`.

A failed migration run does not authorize application merge or deploy.
