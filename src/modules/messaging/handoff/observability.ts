export function logHandoffEvent(
  type:
    | 'conversation_control_changed'
    | 'human_handoff_requested'
    | 'human_takeover_erp'
    | 'human_takeover_whatsapp'
    | 'human_lease_extended'
    | 'human_lease_expired'
    | 'conversation_returned_to_bot'
    | 'resume_unanswered_claimed'
    | 'resume_no_unanswered_message'
    | 'bot_outbound_suppressed_control_version'
    | 'manual_fromme_classified'
    | 'manual_fromme_ambiguous',
  payload: Record<string, unknown>,
): void {
  console.log(JSON.stringify({ type, ...payload }));
}
