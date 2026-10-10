# DRVO control plane

| Field | Value |
|-------|-------|
| Document | `DRVO-CTRL-002` |
| Issue | https://github.com/tarek-saad-dev/casher/issues/15 |
| Repo | `tarek-saad-dev/casher` |
| Base branch | `main` |
| Environment | GitHub Actions staging gate; Cursor automations are optional and may be paused |
| Staging database | `last132_agent` only |
| Production database | `last132` — no access, no mutation |
| Reuse guide | [../agent-control-plane/INSTALL.md](../agent-control-plane/INSTALL.md) |

GitHub is the source of truth. Agents do not keep a second status system. The originating issue holds the scope. The open pull request holds the execution report.

## Merge and production semantics

- **Agents never merge.** A human must approve and merge every PR.
- **Human merge is the only production approval.** No automatic production deploy may happen before the human merge.
- In this repo, push/merge to `main` automatically triggers `.github/workflows/deploy-vps.yml` (`Deploy Casher to VPS`).
- Therefore **`READY_FOR_TAREK` means safe to merge and safe to deploy to production immediately** when Tarek merges.
- Do not describe merge and production deploy as both manual. Only merge approval is manual; production deploy is automatic on merge to `main`.
- Agents never dispatch, rerun, or trigger that production workflow.

## Operating flow

1. A task is created or updated as a GitHub issue.
2. Implementation may be performed locally or by an agent, but GitHub remains the source of truth.
3. Required DRVO database staging verification runs through the guarded GitHub Actions staging gate when Cursor/Cloud automations are unavailable.
4. The agent opens or updates one pull request against `main`.
5. Review automation reviews new commits. It does not approve and it does not merge.
6. When a failure is caused by the PR, the agent investigates and fixes it on the same branch.
7. The PR is reported `READY_FOR_TAREK` only after every gate below passes.
8. A human merges. Merge to `main` deploys production automatically.

## Lifecycle

`PLANNED -> BUILDING -> REVIEW -> FIXING -> REVIEW -> READY_FOR_TAREK -> MERGED`

Do not add extra lifecycle states.

| State | Meaning |
|-------|---------|
| `PLANNED` | The issue exists. No builder branch is in progress. |
| `BUILDING` | An agent is implementing the issue on its task branch. |
| `REVIEW` | A PR is open and the execution report is on that PR. Review has not finished. |
| `FIXING` | The agent is addressing review findings or a PR-caused failure on the same branch. |
| `READY_FOR_TAREK` | Every gate below is satisfied. Safe to merge and safe to deploy immediately. A human still must merge. |
| `MERGED` | A human merged the PR. Record this only after GitHub shows the merge. |

Allowed moves: `PLANNED -> BUILDING -> REVIEW`, `REVIEW -> FIXING -> REVIEW`, `REVIEW -> READY_FOR_TAREK -> MERGED`. Do not skip from `BUILDING` to `READY_FOR_TAREK`.

## READY_FOR_TAREK gate

Before reporting `READY_FOR_TAREK`, require all of the following:

- The requested issue scope is complete.
- Targeted tests are green, or pre-existing failures are named and separated from regressions.
- Required staging, runtime, or browser smoke passed when the change can affect them.
- Independent review reports no material findings.
- No production database access occurred during implementation.
- The pull request is open against `main`.
- The implementation is safe to deploy to production immediately when Tarek merges.

## Staging contract (Casher)

Casher retains this proven staging contract:

| Item | Value |
|------|-------|
| Database | `last132_agent` |
| Login | `drvo_agent` |
| SSH user | `drvo-tunnel` |
| Host secret | `DRVO_STAGING_SSH_HOST` |
| Key secret | `DRVO_STAGING_SSH_KEY` |
| DB password secret | `DRVO_STAGING_DB_PASSWORD` |
| Tunnel local port | `14330` |

Before any staging DB mutation, confirm:

```sql
SELECT DB_NAME() AS db, SUSER_SNAME() AS login;
-- db must be last132_agent
-- login must be drvo_agent
```

Current staging executor: `.github/workflows/drvo-staging-gate.yml`.

The workflow:
- runs only against the staging contract above;
- may reuse `VPS_HOST` only as the server address;
- requires the dedicated `DRVO_STAGING_SSH_KEY` for SSH user `drvo-tunnel`;
- requires `DRVO_STAGING_DB_PASSWORD` for SQL login `drvo_agent`;
- refuses repository/local production env files;
- proves database/login identity before mutation;
- runs migration, verify, DRVO smoke, cleanup proof and final verify;
- never uses production deploy SSH credentials or production DB credentials as staging substitutes.

Never contact production `last132` from staging executors.

## Agent model

Cursor automations are currently optional and may be paused. Do not make DRVO staging verification depend on them. GitHub Actions owns the database staging gate; human merge remains the only production deployment approval.

When Cursor automations are enabled again, keep the command convention below and do not grant them merge or production-deploy authority.

| Role | Trigger | Current handling |
|------|---------|------------------|
| Command router | GitHub issue comment | **Enabled.** The automation named `DRVO Command Router` runs `EXECUTE` and `STATUS`. It ignores unrelated comments, including `REVIEW` and `FIX_FINDINGS`. |
| PR review gate | GitHub PR opened and PR pushed | **Not saved from this repo.** Create it in Cursor Automations on this repository and the existing cloud environment. Tools: comment on the PR. Leave approval disabled. Never merge. |
| Fix agent | GitHub PR comment | **Not saved from this repo.** Wire it to `DRVO_ACTION: FIX_FINDINGS` when ready. It fixes material findings on the same branch and returns the PR to `REVIEW`. Never merge. Never deploy. |

`REVIEW` and `FIX_FINDINGS` are part of the command convention. They do nothing until a matching automation is saved in Cursor. Saving that automation is a dashboard action, not a git change.

Do not attach an automation to `Deploy Casher to VPS`. Add a CI-completed automation only after a non-production PR check exists, and point it at that check. It may fix failures caused by the PR on the task branch. It must not deploy.

## Commands

Post one of these as a top-level issue or PR comment. Automations ignore every other comment.

| Comment | Intended effect |
|---------|-----------------|
| `DRVO_ACTION: EXECUTE` | Build the issue scope on one new branch, test it, and open a PR in `REVIEW`. |
| `DRVO_ACTION: REVIEW` | Review the open PR. Comment findings. Do not approve or merge. |
| `DRVO_ACTION: FIX_FINDINGS` | Fix material findings on the same branch, retest, and return the PR to `REVIEW`. |
| `DRVO_ACTION: STATUS` | Read the issue and linked PR. Report the state. Do not change code. |

Casher keeps `DRVO_ACTION` command names so existing Cursor automations do not need dashboard reconfiguration. Other projects may use a generic prefix such as `DEV_ACTION`; see [INSTALL.md](../agent-control-plane/INSTALL.md).

## Handoff reports

`EXECUTE` puts this block in the PR description:

```text
STATE: REVIEW
SOURCE_ISSUE: <issue number and link>
TESTS: <summary>
SMOKE: <summary>
BLOCKERS: <none or details>
```

`STATUS` reports, and does not open a PR:

```text
STATE: PLANNED / BUILDING / REVIEW / FIXING / READY_FOR_TAREK / MERGED
CURRENT_PR:
LAST_VERIFICATION:
BLOCKERS:
NEXT_ACTION:
```

For a merged task, `STATUS` should also report the latest production deploy result when it can be read from GitHub Actions:

```text
STATE: MERGED
PRODUCTION_DEPLOY: SUCCESS / FAILURE / IN_PROGRESS / UNKNOWN
PRODUCTION_RUN: <GitHub Actions run URL or none>
CURRENT_PR:
LAST_VERIFICATION:
BLOCKERS:
NEXT_ACTION:
```

Reading deploy status is reporting only. The agent must never dispatch or rerun production deploy automatically.

Use `READY_FOR_TAREK` only when every gate in this document is met. Final human approval is required before merge.

## Branch and test rules

- One branch per issue, cut from current `main`.
- Commit only the requested scope. Do not commit secrets.
- Prefer a targeted test plus smoke of the behavior that changed.
- Docs-only changes do not need an app boot or a browser pass. Say that smoke was not applicable.
- If an existing test already fails on `main`, report it as pre-existing. Do not treat it as a regression from the task branch.

## Phone use

From a phone, open the GitHub issue and comment `DRVO_ACTION: EXECUTE` or `DRVO_ACTION: STATUS`. The Cloud Agent runs in the managed environment. The laptop does not need to be online. Watch the issue and the pull request for the state report. Merge still requires a person.
