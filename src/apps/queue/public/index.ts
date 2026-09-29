/** DRVO-005 — queue application boundary. */
export const APP_CODE = 'queue' as const;

export type { QueueSchedulingPorts } from './ports';

export { createQueueTicket } from '../application/createQueueTicket';
export { cancelQueueTicket } from '../application/cancelQueueTicket';
export { isQueueSchedulingPortEnabled } from '../internal/queuePortFlag';
