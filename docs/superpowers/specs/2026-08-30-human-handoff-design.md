# Human Handoff + ERP WhatsApp Inbox — Design

Date: 2026-08-30  
Flag: `HUMAN_HANDOFF_V1` (default OFF)  
Identity: `TblBotConversation.ConversationID` keyed by `(Channel, Provider, ExternalContactKey)` where ExternalContactKey is canonical phone digits, not raw LID/JID.

## Audit (current)

| Surface | Reality |
|---|---|
| Inbox | `TblMessageInbox` unique `(Provider, ProviderMessageID)` → `/api/internal/messaging/inbox/whatsapp` |
| Conversation | `TblBotConversation` already has `ControlMode IN (BOT, HUMAN, PAUSED)` |
| History | `TblBotMessage` inbound/outbound; AI context loads this timeline |
| AI skip | `scheduleAiTurnAfterInbound` inserts skipped turn when `ControlMode <> BOT` |
| Handoff intent | `looksLikeHandoff` → `HUMAN_HANDOFF_REQUEST` → kernel reply, **does not change ControlMode** |
| Outbox | `TblMessageOutbox` + `ProviderMessageID` after gateway send |
| Gateway | External WhatsApp bot (`/api/whatsapp/send`). **fromMe is not ingested today** |
| Auth | `requireAdmin` + `PageGuard` `/admin/whatsapp` |
| Workers | inbox-worker, outbox-worker, ai-worker |

## Ownership SoT

Extend `TblBotConversation` (do not create a parallel owner). Add version, lease, takeover metadata, unread.

Modes (V1): `BOT` | `HUMAN_REQUESTED` | `HUMAN`  
Keep `PAUSED` in CHECK for backward compatibility; V1 never writes it.

`ControlVersion` increments on every ownership change. Optimistic: updates require matching expected version.

Append-only `TblBotConversationControlEvent` (no message bodies).

## Customer request

When flag ON and kernel intent is `HUMAN_HANDOFF_REQUEST`:

1. Atomic `BOT → HUMAN_REQUESTED` (or no-op if already HUMAN_REQUESTED/HUMAN)
2. Lease = now + `HUMAN_HANDOFF_LEASE_MINUTES` (default 15)
3. Enqueue **one** HANDOFF_ACK (origin `HANDOFF_ACK`)
4. Ack text: `أكيد يا فندم، هخلي حد من الاستقبال يكمل مع حضرتك.`
5. Do not mutate booking plan
6. Subsequent AI turns remain skipped while not BOT
7. Repeat request: no second ack

Flag OFF: current kernel reply + no ownership change.

## ERP takeover / send / return

Reuse WhatsApp admin auth (`requireWhatsAppTemplateAdmin` / `/admin/whatsapp` page guard).

- Takeover: `BOT|HUMAN_REQUESTED → HUMAN`, source `ERP`, `TakenOverByUserID = session user`
- Conflict: already HUMAN owned by another user → 409, no steal
- Send: must own; origin `HUMAN_ERP`; outbox; lease refresh
- Return: `HUMAN|HUMAN_REQUESTED → BOT`; silent unless unanswered customer turn

## WhatsApp manual (fromMe)

Baileys `fromMe=true` is **not** proof of human. Correlation:

1. Before gateway send: insert `TblWhatsAppOutboundCorrelation` (OutboxID, origin, conversation, expected ControlVersion, phone)
2. After send: stamp ProviderMessageID
3. Gateway posts observed outbound to `/api/internal/messaging/outbound-observed/whatsapp` (same inbox webhook token)

Classification:

- Known ProviderMessageID + origin BOT/HANDOFF_ACK → not takeover
- Known HUMAN_ERP → extend HUMAN lease
- Unknown + no pending correlation for that phone in 30s window → `WHATSAPP_MANUAL` takeover
- Ambiguous (pending send, no ID yet) → log `manual_fromme_ambiguous`, **do not** takeover

Gateway change (minimum): forward fromMe 1:1 events to the new webhook. If gateway is not updated, ERP takeover still works; phone takeover stays unproven.

## AI suppression + send gates

While HUMAN / HUMAN_REQUESTED:

- Inbox + TblBotMessage still persist; UnreadCount++
- `scheduleAiTurn` still skipped via ControlMode (existing path)
- processAiTurn: re-read live ControlMode before enqueue; skip if not BOT (except completing HANDOFF_ACK already decided)
- Outbox `processOutboxTick`: if metadata.origin is BOT and live mode is not BOT **or** ControlVersion mismatch → fail/suppress without sending (`bot_outbound_suppressed_control_version`)
- HUMAN_ERP / HUMAN_WHATSAPP / HANDOFF_ACK are not gated by BOT mode

## Lease + resume

Reconciler on inbox-worker tick: expired HUMAN / HUMAN_REQUESTED → BOT + audit.

Unanswered customer turn: latest inbound after latest meaningful outbound (BOT, HUMAN_ERP, HUMAN_WHATSAPP, HANDOFF_ACK). The original request that already got HANDOFF_ACK is not reanswered.

Resume claim unique: `(ConversationID, LatestCustomerMessageID)` in `TblBotConversationResumeClaim`. One AI schedule.

Customer inbound does **not** extend lease.

## Inbox UI

Route: `/admin/whatsapp/inbox` (layout PageGuard). Link from existing WhatsApp admin page.

RTL, list + thread, 3s poll. Filters: all / needs takeover / with employee / bot / unread. Composer locked until takeover.

## Out of scope

Cancel/reschedule, analytics, sentiment escalation, websockets, canned replies, departments.
