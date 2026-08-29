/** Feature flag: Conversation Orchestrator V3 (current-message-first). */
export function isConversationOrchestratorV3Enabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(env.CONVERSATION_ORCHESTRATOR_V3 ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  // Default OFF until production canary; set true|1|on|yes to enable.
  if (raw === '') return false;
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}
