# DRVO control plane

| Field | Value |
|-------|-------|
| Document | `DRVO-CTRL-001` |
| Issue | https://github.com/tarek-saad-dev/casher/issues/4 |
| Repo | `tarek-saad-dev/casher` |
| Base branch | `main` |
| Environment | Existing Cursor Managed Cloud Environment for this repo |
| Staging database | `last132_agent` only |
| Production database | `last132` — no access, no mutation |

GitHub is the source of truth. Agents do not keep a second status system. The originating issue holds the scope. The open pull request holds the execution report.

## Operating flow

1. A task is created or updated as a GitHub issue.
2. A Cloud Agent executes that issue in the managed staging environment.
3. The agent runs targeted tests and, when the change affects the running app, runtime or browser smoke.
4. The agent opens or updates one pull request against `main`.
5. Review automation reviews new commits. It does not approve and it does not merge.
6. When a failure is caused by the PR, the agent investigates and fixes it on the same branch.
7. The PR is reported `READY_FOR_TAREK` only after the gates below pass.
8. Merge and production deploy stay manual.

Pushing `main` runs `.github/workflows/deploy-vps.yml` (`Deploy Casher to VPS`). Merging is a production deploy. Agents never merge and never dispatch that workflow.

## States

| State | Meaning |
|-------|---------|
| `PLANNED` | The issue exists. No builder branch is in progress. |
| `BUILDING` | An agent is implementing the issue on its task branch. |
| `REVIEW` | A PR is open and the execution report is on that PR. Review has not finished. |
| `FIXING` | The agent is addressing review findings or a PR-caused failure on the same branch. |
| `READY_FOR_TAREK` | Scope, tests, smoke, and review gates below are satisfied. A human still must merge. |
| `MERGED` | A human merged the PR. Record this only after GitHub shows the merge. |

Allowed moves: `PLANNED -> BUILDING -> REVIEW -> FIXING -> REVIEW`, and `REVIEW -> READY_FOR_TAREK -> MERGED`. `FIXING` returns to `REVIEW` when the fix PR is updated. Do not skip from `BUILDING` to `READY_FOR_TAREK`.

`READY_FOR_TAREK` requires all of the following:

- The requested scope is complete.
- Targeted tests are green, or pre-existing failures are named and separated from regressions.
- Staging, runtime, or browser smoke passed when the change can affect them.
- The pull request is open against `main`.
- No unresolved material review finding remains.

## Commands

Post one of these as a top-level issue or PR comment. Automations ignore every other comment.

| Comment | Intended effect |
|---------|-----------------|
| `DRVO_ACTION: EXECUTE` | Build the issue scope on one new branch, test it, and open a PR in `REVIEW`. |
| `DRVO_ACTION: REVIEW` | Review the open PR. Comment findings. Do not approve or merge. |
| `DRVO_ACTION: FIX_FINDINGS` | Fix material findings on the same branch, retest, and return the PR to `REVIEW`. |
| `DRVO_ACTION: STATUS` | Read the issue and linked PR. Report the state. Do not change code. |

### Automations

| Role | Trigger | Current handling |
|------|---------|------------------|
| Command router | GitHub issue comment | **Enabled.** The automation named `DRVO Command Router` runs `EXECUTE` and `STATUS`. It ignores unrelated comments, including `REVIEW` and `FIX_FINDINGS`. |
| PR review | GitHub PR opened and PR pushed | **Not saved from this repo.** Create it in Cursor Automations on this repository and the existing cloud environment. Tools: comment on the PR. Leave approval disabled. Never merge. |
| CI completed | GitHub `CI completed` or workflow-run completed | **Documented, not wired.** Those triggers exist for GitHub-connected automations and are billed as Cloud Agent usage. This repository has no pull-request test workflow. The only Actions workflow deploys production on push to `main`. Do not attach an automation to `Deploy Casher to VPS`. Add a CI-completed automation only after a non-production PR check exists, and point it at that check. It may fix failures caused by the PR on the task branch. It must not deploy. |

`REVIEW` and `FIX_FINDINGS` are part of the command convention. They do nothing until a matching automation is saved in Cursor. Saving that automation is a dashboard action, not a git change.

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

Use `READY_FOR_TAREK` only when every gate in this document is met. Final human approval is required before merge.

## Branch and test rules

- One branch per issue, cut from current `main`.
- Commit only the requested scope. Do not commit secrets.
- Prefer a targeted test plus smoke of the behavior that changed.
- Docs-only changes do not need an app boot or a browser pass. Say that smoke was not applicable.
- If an existing test already fails on `main`, report it as pre-existing. Do not treat it as a regression from the task branch.

## Phone use

From a phone, open the GitHub issue and comment `DRVO_ACTION: EXECUTE` or `DRVO_ACTION: STATUS`. The Cloud Agent runs in the managed environment. The laptop does not need to be online. Watch the issue and the pull request for the state report. Merge still requires a person.
