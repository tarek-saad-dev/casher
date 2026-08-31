export function logHandoffEvent(
  type:
    | 'conversation_control_changed'
    | 'human_handoff_requested'
    | 'human_takeover_erp'
    | 'human_takeover_whatsapp'
    | 'human_takeover_committed'
    | 'human_manual_whatsapp_detected'
    | 'human_lease_extended'
    | 'human_lease_expired'
    | 'conversation_returned_to_bot'
    | 'bot_control_restored'
    | 'resume_unanswered_claimed'
    | 'resume_no_unanswered_message'
    | 'bot_outbound_suppressed_control_version'
    | 'ai_outbound_suppressed_before_enqueue'
    | 'ai_outbound_suppressed_before_provider_send'
    | 'manual_fromme_classified'
    | 'manual_fromme_ambiguous',
  payload: Record<string, unknown>,
): void {
  console.log(JSON.stringify({ type, ...payload }));
}
