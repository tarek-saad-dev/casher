import type { DrvowaToolDefinition } from './types';

export const DRVOWA_CONTRACT_VERSION = 'drvowa-erp-v1' as const;

/** CRM sync tools advertised on the shared DRVOWA ERP manifest. */
export function getDrvowaCrmSyncToolDefinitions(): DrvowaToolDefinition[] {
  return [
    {
      name: 'customer.list_changes',
      description:
        'List customers after an append-only sinceClientId cursor. Pass identitySweep=true with identitySweepSinceClientId to rotate through historical ClientIDs so name/phone/email/state updates are not permanently missed.',
      mode: 'READ',
      approval: 'AUTO',
      inputSchema: {
        type: 'object',
        properties: {
          sinceClientId: { type: 'number' },
          identitySweepSinceClientId: {
            type: 'number',
            description:
              'Rotating identity-reconcile cursor used with identitySweep=true. Wraps to 0 at end of table.',
          },
          identitySweep: {
            type: 'boolean',
            description:
              'When true, re-read historical customers (including already synced IDs) for identity updates.',
          },
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
      description:
        'List catalog services after an append-only sinceProId cursor. Pass identitySweep=true with identitySweepSinceProId to rotate through historical ProIDs so renames, category moves, and isDeleted flips are not permanently missed.',
      mode: 'READ',
      approval: 'AUTO',
      inputSchema: {
        type: 'object',
        properties: {
          sinceProId: { type: 'number' },
          identitySweepSinceProId: {
            type: 'number',
            description:
              'Rotating catalog-reconcile cursor used with identitySweep=true. Wraps to 0 at end of table.',
          },
          identitySweep: {
            type: 'boolean',
            description:
              'When true, re-read historical services (including already synced IDs) for name/delete updates.',
          },
          limit: { type: 'number' },
        },
      },
    },
  ];
}
