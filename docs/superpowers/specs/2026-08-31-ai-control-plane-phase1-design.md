# CUT AI Control Plane — Phase 1 Design

## Purpose

Phase 1 builds the **Learning Kernel & Behavior Compiler foundation** above existing runtime layers (V4 kernel, Salon Concierge, Booking Management, Human Handoff). Admins teach the bot in natural Arabic; the system structures, validates, conflicts-checks, and approves — without changing live customer runtime (Phase 2).

## Architecture map (current → control plane)

| Current source | Domain | Authority | Runtime consumer |
|----------------|--------|-----------|------------------|
| `TblSalonKnowledge` | FAQ/policies | OWNER_CURATED | `salonConcierge/lookup` |
| `TblSalonBrandVoice` + examples | Brand voice | OWNER_CURATED | `brandVoice.ts`, `voiceExamples.ts` |
| `TblSalonCapability` | Capabilities | OWNER_CURATED | `lookup.ts` |
| `TblSalonOffer` | Offers | OWNER_CURATED | `listActiveOffers` |
| `CONCIERGE_FIXED_BRANCH_HOURS` | Opening hours (customer-facing) | OWNER_CURATED | `branchBusinessHours.ts` |
| ERP services/prices | Prices | LIVE_ERP | AI tools / planner |
| Booking DB | Committed bookings | LIVE_TRANSACTIONAL | Booking Management |
| `ConversationControl` | Human ownership | SYSTEM_INVARIANT | Human Handoff |
| Gemini structured output | Conversation | GENERAL_MODEL | `processAiTurn` |

**Phase 1 does not dual-write** to `TblSalon*` or runtime prompts. Approved artifacts live in `TblAiLearning*` and are consumed in Phase 2.

## Module layout

```
src/modules/ai-control-plane/
  featureFlag.ts
  domain/          types, enums, payloads, authority, invariants, scopes, layers
  application/     entityResolver, conflictEngine, interpreter, pipeline, approval, audit
  infra/           memoryStore (tests), sqlRepository, sqlWrites
  adapters/        conciergeAwareness (read-only conflict hints)
```

## Data model

- **TblAiLearningSubmission** — raw Arabic input, lifecycle, interpreter metadata
- **TblAiLearningArtifact** — structured proposals/approved truth (relational columns + `StructuredPayloadJson`)
- **TblAiLearningConflict** — detected conflicts at analysis time
- **TblAiLearningAuditEvent** — append-only audit

## Flow

```
Admin Arabic input
  → LearningSubmission (RECEIVED)
  → Interpreter (advisory, schema-validated)
  → EntityResolver (deterministic IDs)
  → TargetLayerRouter + ScopeResolver
  → AuthorityEngine + InvariantEngine
  → ConflictEngine (vs approved artifacts + concierge awareness)
  → NEEDS_REVIEW preview (Arabic UI)
  → Admin approve/reject (server-side revalidation)
  → APPROVED artifact(s) in Control Plane registry only
```

## Non-goals (Phase 1)

Runtime compilation, prompt injection, conversation replay, auto-publish, fine-tuning, knowledge-gap automation.

## Safety

- Model never sets BranchID/EmpID/ServiceID
- Model never approves or bypasses invariants
- Human approval always required
- Customer WhatsApp path unchanged (zero new latency)
