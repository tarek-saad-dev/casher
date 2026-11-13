import type { DrvowaToolDefinition } from './types';

export const DRVOWA_CONTRACT_VERSION = 'drvowa-erp-v1' as const;

/** CRM sync tools advertised on the shared DRVOWA ERP manifest. */
export function getDrvowaCrmSyncToolDefinitions(): DrvowaToolDefinition[] {
  return [
    {
      name: 'customer.list_changes',
      description: 'List customers changed after a ClientID cursor for CRM sync',
      mode: 'READ',
      approval: 'AUTO',
      inputSchema: {
        type: 'object',
        properties: {
          sinceClientId: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
    {
      name: 'invoice.list_changes',
      description:
        'List sales invoices (invType=مبيعات). Default mode uses append-only sinceInvId. Pass includeInactive=true so newly inserted cancelled rows (legacy isActive=yes) are returned. Pass statusSweep=true with statusSweepSinceInvId to rotate through historical headers so late cancellations of already-synced IDs are not permanently missed. Composite key is invType+invID.',
      mode: 'READ',
      approval: 'AUTO',
      inputSchema: {
        type: 'object',
        properties: {
          sinceInvId: {
            type: 'number',
            description:
              'Append-only high-water mark: return rows with invID > sinceInvId ordered ASC.',
          },
          statusSweepSinceInvId: {
            type: 'number',
            description:
              'Rotating status-reconcile cursor used with statusSweep=true. Wraps to 0 at end of table.',
          },
          statusSweep: {
            type: 'boolean',
            description:
              'When true, re-read historical sales headers (including already synced IDs) for cancellation status.',
          },
          limit: { type: 'number' },
          includeInactive: {
            type: 'boolean',
            description:
              'When true in append mode, include cancelled sales so CRM can mark mirrors invalid. Recommended true for sync.',
          },
        },
      },
    },
    {
      name: 'catalog.list_services',
      description: 'List catalog services after a ProID cursor',
      mode: 'READ',
      approval: 'AUTO',
      inputSchema: {
        type: 'object',
        properties: {
          sinceProId: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
  ];
}
