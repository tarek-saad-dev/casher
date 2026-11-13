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
        'List sales invoices (invType=مبيعات) after an append-only sinceInvId cursor. Composite key is invType+invID. Pass includeInactive=true during sync so cancelled/voided rows (legacy isActive=yes) are returned for CRM mirror invalidation. sinceInvId does not re-emit late cancellations of already-seen IDs.',
      mode: 'READ',
      approval: 'AUTO',
      inputSchema: {
        type: 'object',
        properties: {
          sinceInvId: {
            type: 'number',
            description:
              'Append-only high-water mark: return rows with invID > sinceInvId ordered ASC. Does not replay updates to older IDs.',
          },
          limit: { type: 'number' },
          includeInactive: {
            type: 'boolean',
            description:
              'When true, include cancelled sales so CRM can mark mirrors invalid. Recommended true for sync.',
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
