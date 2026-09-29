/**
 * DRVO-005 rollout gate. Default on after extraction; set QUEUE_SCHEDULING_PORT=false
 * to roll back to legacy direct scheduleIntegrity calls.
 */
export function isQueueSchedulingPortEnabled(): boolean {
  return process.env.QUEUE_SCHEDULING_PORT !== 'false';
}
