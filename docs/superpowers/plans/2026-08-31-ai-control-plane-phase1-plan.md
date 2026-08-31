# CUT AI Control Plane — Phase 1 Implementation Plan

## Step 1 — Domain foundation (TDD)

| File | Purpose |
|------|---------|
| `src/modules/ai-control-plane/domain/enums.ts` | All registries |
| `src/modules/ai-control-plane/domain/types.ts` | Core records |
| `src/modules/ai-control-plane/domain/payloads.ts` | Type-specific validation |
| `src/modules/ai-control-plane/domain/authorityMatrix.ts` | Domain → authority precedence |
| `src/modules/ai-control-plane/domain/invariants.ts` | Hard invariant registry + checker |
| `src/modules/ai-control-plane/domain/normalizedKey.ts` | Key builders |

Tests: `authority.test.ts`, `invariants.test.ts`

## Step 2 — Resolvers & routers

| File | Purpose |
|------|---------|
| `application/entityResolver.ts` | BRANCH/SERVICE/EMPLOYEE lookup |
| `application/scopeResolver.ts` | Scope from artifact context |
| `application/targetLayerRouter.ts` | Artifact type → target layer |
| `application/conflictEngine.ts` | DUPLICATE/SUPERSEDES/CONTRADICTS/… |

Tests: `entityResolver.test.ts`, `conflict.test.ts`, `routing.test.ts`

## Step 3 — Interpreter

| File | Purpose |
|------|---------|
| `application/heuristicInterpreter.ts` | Deterministic corpus (tests) |
| `application/geminiLearningInterpreter.ts` | Production Gemini path |
| `application/learningInterpreter.ts` | Facade + schema validation |
| `application/analysisPipeline.ts` | Full analyze orchestration |

Tests: `interpreter.test.ts`, `corpus.test.ts`

## Step 4 — Persistence

| File | Purpose |
|------|---------|
| `db/migrations/create-tbl-ai-control-plane-phase1.sql` | Idempotent schema |
| `scripts/run-ai-control-plane-migration.ts` | Migration runner |
| `infra/memoryStore.ts` | In-memory for unit tests |
| `infra/sqlRepository.ts` | Production reads |
| `infra/sqlWrites.ts` | Production writes |

Tests: `submission.test.ts`, `approval.test.ts`, `versioning.test.ts`

## Step 5 — Services

| File | Purpose |
|------|---------|
| `application/submissionService.ts` | Create/list submissions |
| `application/approvalService.ts` | Approve/reject/disable + supersession |
| `application/auditService.ts` | Append audit events |
| `adapters/conciergeAwareness.ts` | Read fixed hours + default banned phrases |

## Step 6 — Admin API

Routes under `src/app/api/admin/ai-concierge/learning/`:

- `submissions/route.ts` — POST create
- `submissions/[id]/route.ts` — GET detail
- `submissions/[id]/analyze/route.ts` — POST analyze
- `artifacts/route.ts` — GET list
- `artifacts/[id]/approve/route.ts`
- `artifacts/[id]/reject/route.ts`
- `artifacts/[id]/disable/route.ts`
- `history/route.ts`

Auth: existing admin session pattern from `salon-concierge` routes.

## Step 7 — UI

| File | Purpose |
|------|---------|
| `src/components/admin/ai-control-plane/TeachCutAiPanel.tsx` | RTL teaching UI |
| `src/app/admin/ai-concierge/page.tsx` | Tab when `AI_CONTROL_PLANE_PHASE1` |

## Step 8 — Feature flag

`src/modules/ai-control-plane/featureFlag.ts` — `AI_CONTROL_PLANE_PHASE1`, default OFF.

## Step 9 — Test matrix

`src/modules/ai-control-plane/__tests__/*.test.ts` covering spec items 1–64.

## Step 10 — Regression

`npm test` — existing concierge/messaging/handoff tests unchanged.

## Deploy (manual)

1. Commit, push main
2. `run-ai-control-plane-migration.ts --expected-database …`
3. Enable `AI_CONTROL_PLANE_PHASE1` for admin only
4. Admin smokes A–F
