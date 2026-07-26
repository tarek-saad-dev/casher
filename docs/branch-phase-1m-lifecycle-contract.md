# Phase 1M-B — Branch Lifecycle Contract

## Persisted statuses

```text
SETUP
SMOKE_TEST
INTERNAL_LIVE
PUBLIC_LIVE
SUSPENDED
```

`READY` is **calculated** by `evaluateBranchReadiness` (not persisted).

`IsActive` is synced from lifecycle capabilities for backward compatibility with nightly (`listActiveBranches`) and the switcher.

---

## Capability matrix

| Status | Internal access | Normal ops | Public booking | Nightly production | External notifications | IsActive |
|---|---|---|---|---|---|---|
| SETUP | Admin only | No | No | No | No | 0 |
| SMOKE_TEST | Allowlisted / admin smoke APIs | Controlled runner | No | Explicit smoke only | No | 0 |
| INTERNAL_LIVE | Authorized staff | Yes | No | Yes | Policy-gated | 1 |
| PUBLIC_LIVE | Authorized staff | Yes | Yes | Yes | Yes | 1 |
| SUSPENDED | Admin read-only | No | No | No | No | 0 |

---

## SETUP

- Branch row exists; configuration editable.  
- No customer/financial production transactions via normal ops (IsActive=0).  
- Hidden from public website and normal switcher.  
- Not in production nightly.  
- No real WhatsApp / printing expectations.

## SMOKE_TEST

- Visible only via admin smoke tooling / allowlist.  
- No public website.  
- ExternalSideEffectsEnabled=0 on smoke runs.  
- Artifacts registered for cleanup.  
- GLEEM must remain unchanged by smoke artifacts.

## INTERNAL_LIVE

- Staff operations allowed (IsActive=1).  
- Public booking still disabled (`PublicBookingEnabled=0`, settings BookingEnabled=0).  
- Nightly included.

## PUBLIC_LIVE

- Public discovery enabled.  
- Public booking enabled.  
- Full production behavior.

## SUSPENDED

- New mutations blocked via inactive branch.  
- History readable by authorized admins.  
- Public booking off.

---

## Forbidden transitions

```text
SETUP → PUBLIC_LIVE
SMOKE_TEST → PUBLIC_LIVE
SUSPENDED → PUBLIC_LIVE (without returning through readiness + INTERNAL_LIVE)
```

Required happy path:

```text
SETUP → (READY calc) → SMOKE_TEST → smoke PASS → INTERNAL_LIVE → validation → PUBLIC_LIVE
```

---

## Implementation

- `src/lib/branch/lifecycle.ts`  
- `src/lib/branch/branchLifecycleTransition.ts`  
- Audit: `TblBranchLifecycleAudit`  
