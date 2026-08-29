/** Customer-Led Conversation Kernel V4 — current message is sovereign. */
export function isCustomerLedConversationV4Enabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(env.CUSTOMER_LED_CONVERSATION_V4 ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/** V4 or V3 orchestration active (confirmation gate, session memory). */
export function isConversationOrchestrationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isCustomerLedConversationV4Enabled(env) ||
    String(env.CONVERSATION_ORCHESTRATOR_V3 ?? '').trim().toLowerCase() === 'true' ||
    String(env.CONVERSATION_ORCHESTRATOR_V3 ?? '').trim().toLowerCase() === '1'
  );
}
