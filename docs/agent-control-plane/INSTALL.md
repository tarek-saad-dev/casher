# Agent control plane — minimum install

This is the smallest reusable setup for running Cloud Agents against a GitHub repo with human merge as the final gate. It is intentionally small: no installer CLI, no template repository, and no large config framework.

Casher uses the DRVO variant documented in [CONTROL-PLANE.md](../drvo/CONTROL-PLANE.md). This file describes what to copy to another project.

## 1. Add one `AGENTS.md`

At the repository root, add one `AGENTS.md` that states:

- How to run, test, and lint the project.
- Staging rules (database name, credentials via secrets, never touch production).
- Safety rules: agents never merge, never dispatch production deploy, never commit secrets.
- Deploy semantics for that project:
  - **Option A (Casher today):** human merge to `main` triggers production deploy immediately.
  - **Option B (future):** human merge to `main` goes to preview/staging first; production is a later manual step.

Link to the project-specific control-plane doc (for Casher: `docs/drvo/CONTROL-PLANE.md`).

## 2. Create one Cursor Cloud Environment

In Cursor, create one Cloud Environment for the repo. Add only the runtime secrets the agents need (staging DB, SSH tunnel, API keys for smoke tests). Do not store production credentials unless a future workflow explicitly requires them and humans approve that risk.

## 3. Create the same three automations

Copy the three-agent model:

| Automation | Typical trigger | Commands |
|------------|-----------------|----------|
| Command router | Issue comment | `EXECUTE`, `STATUS` |
| PR review gate | PR opened / pushed | `REVIEW` |
| Fix agent | PR comment | `FIX_FINDINGS` |

Each automation prompt should restate: never merge, never approve, never dispatch production deploy.

**Casher:** keep the live automation names and `DRVO_ACTION: ...` triggers so the Cursor dashboard does not need reconfiguration.

**Other projects:** use a generic prefix in prompts and comments, for example:

```text
DEV_ACTION: EXECUTE
DEV_ACTION: STATUS
DEV_ACTION: REVIEW
DEV_ACTION: FIX_FINDINGS
```

The prefix can differ; the lifecycle and gates stay the same.

## 4. GitHub as source of truth

- **Issue** = task scope and acceptance criteria.
- **Pull request** = implementation, test report, review thread, and readiness for merge.

Lifecycle:

`PLANNED -> BUILDING -> REVIEW -> FIXING -> REVIEW -> READY_FOR_TAREK -> MERGED`

`READY_FOR_TAREK` means the change is safe for the human to merge under that project's deploy model (immediate production for Casher).

## 5. Human merge stays final

Agents open PRs, test, review, and fix. A human always merges.

For merge-to-production repos (Casher): merging to `main` deploys production automatically. Agents must not merge and must not trigger deploy workflows.

For preview-first repos (future option): merging to `main` may only update preview; document that in `AGENTS.md` and the control-plane doc so agents and humans share the same expectation.

## What not to build here

- Installer CLI
- Template monorepo
- Many YAML config files
- Extra lifecycle states
- Automatic production approval or auto-merge

Add preview VPS, Vercel preview, or rollback automation only in a dedicated later issue.
