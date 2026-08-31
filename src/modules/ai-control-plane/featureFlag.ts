export function isAiControlPlanePhase1Enabled(): boolean {
  return process.env.AI_CONTROL_PLANE_PHASE1 === 'true';
}
