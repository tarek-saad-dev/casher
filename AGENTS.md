<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# DRVO

Casher (`tarek-saad-dev/casher`) is a salon POS being prepared for platform extraction. DRVO-001 (`docs/drvo/DRVO-001-*.md`) is an audit with provisional labels. DRVO-002 owns final platform decisions. Cloud Agents execute tasks through the GitHub control plane in `docs/drvo/CONTROL-PLANE.md`.

GitHub issues and pull requests are the source of truth for task scope and status.

## Execution guardrails

- Base branch: `main`.
- Use the existing Cursor Managed Cloud Environment for this repository.
- Staging database only: `last132_agent`.
- Production database `last132`: no access and no mutation.
- Never deploy production. A push to `main` runs `.github/workflows/deploy-vps.yml` (`Deploy Casher to VPS`). Do not merge, do not dispatch that workflow, and do not change it unless the issue explicitly asks for a deploy-workflow edit.
- Never merge automatically. A human must approve and merge.
- Never commit secrets, credentials, or connection strings.
- One builder branch per issue. Do not reuse another task's branch.
- Implement only the scope in the originating issue.
- Prefer targeted tests plus runtime or browser smoke when the change affects running behavior.
- Separate pre-existing failures from regressions.
- Do not run broad historical suites unless the issue asks for them.

## Task lifecycle

`PLANNED -> BUILDING -> REVIEW -> FIXING -> READY_FOR_TAREK -> MERGED`

A task stays out of `READY_FOR_TAREK` until the requested scope is complete, targeted tests are green or pre-existing failures are documented, applicable smoke has passed, the PR is open, and no material review finding is unresolved. `MERGED` happens only after a human merges.

## Mobile commands

Top-level issue or PR comments may use `DRVO_ACTION: EXECUTE`, `DRVO_ACTION: REVIEW`, `DRVO_ACTION: FIX_FINDINGS`, or `DRVO_ACTION: STATUS`. Ignore every other comment. States, handoff text, and which automation handles each command are defined in `docs/drvo/CONTROL-PLANE.md`.
