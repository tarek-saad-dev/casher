import type { DrvowaToolResult } from '../types';
import { toolErr } from '../result';
import { executeCatalogListServices } from './catalogListServices';
import { executeCustomerListChanges } from './customerListChanges';
import { executeInvoiceListChanges } from './invoiceListChanges';
import { executeInvoiceListDeletions } from './invoiceListDeletions';

const CRM_TOOL_HANDLERS: Record<
  string,
  (input: Record<string, unknown>) => Promise<DrvowaToolResult>
> = {
  'customer.list_changes': executeCustomerListChanges,
  'invoice.list_changes': executeInvoiceListChanges,
  'invoice.list_deletions': executeInvoiceListDeletions,
  'catalog.list_services': executeCatalogListServices,
};

export function isDrvowaCrmSyncTool(tool: string): boolean {
  return Object.prototype.hasOwnProperty.call(CRM_TOOL_HANDLERS, tool);
}

export async function executeDrvowaCrmTool(
  tool: string,
  input: Record<string, unknown>,
): Promise<DrvowaToolResult> {
  const handler = CRM_TOOL_HANDLERS[tool];
  if (!handler) {
    return toolErr(tool, 'UNKNOWN_TOOL', `Unknown tool: ${tool}`);
  }
  return handler(input ?? {});
}

export function listImplementedDrvowaCrmTools(): string[] {
  return Object.keys(CRM_TOOL_HANDLERS);
}
