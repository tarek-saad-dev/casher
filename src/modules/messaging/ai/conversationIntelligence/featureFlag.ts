/** Feature flag for Conversation Intelligence V2 dialogue improvements. */
export function isConversationIntelligenceV2Enabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(env.CONVERSATION_INTELLIGENCE_V2 ?? '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  // Default ON for new behavior once shipped; set false to rollback.
  if (raw === '') return true;
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}
