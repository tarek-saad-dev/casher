/**
 * Phase 1O — receipt / WhatsApp identity payload builder (mock; no real print/send).
 */
import type { BranchDisplayIdentity } from './branchDisplayIdentity';
import { buildBranchMessageIdentity } from './branchDisplayIdentity';

export type BranchReceiptPayload = {
  mode: 'mock-no-print';
  branchId: number;
  branchCode: string;
  branchDisplayName: string;
  englishDisplayName: string | null;
  phone: string | null;
  address: string | null;
  invoiceId?: number | null;
  containsGleemName: boolean;
  productionPrintJobs: number;
};

export type BranchWhatsAppRenderProof = {
  template: string;
  branchDisplayName: string;
  phone: string | null;
  containsGleemName: boolean;
  realSends: number;
};

const GLEEM_NAME_MARKERS = ['جليم', 'GLEEM', 'Saba Pasha', 'سابا باشا'];

export function buildMockBranchReceiptPayload(
  identity: BranchDisplayIdentity,
  invoiceId?: number | null,
): BranchReceiptPayload {
  const msg = buildBranchMessageIdentity(identity);
  const blob = `${msg.branchDisplayName}|${msg.englishDisplayName ?? ''}|${msg.address ?? ''}`;
  return {
    mode: 'mock-no-print',
    branchId: msg.branchId,
    branchCode: msg.branchCode,
    branchDisplayName: msg.branchDisplayName,
    englishDisplayName: msg.englishDisplayName,
    phone: msg.phone,
    address: msg.address,
    invoiceId: invoiceId ?? null,
    containsGleemName: GLEEM_NAME_MARKERS.some((m) => blob.includes(m)),
    productionPrintJobs: 0,
  };
}

export function renderWhatsAppTemplateProof(
  identity: BranchDisplayIdentity,
  template:
    | 'booking_confirmation'
    | 'upcoming_booking'
    | 'sale_message'
    | 'employee_daily_report'
    | 'owner_report',
): BranchWhatsAppRenderProof {
  const msg = buildBranchMessageIdentity(identity);
  const body = `[${template}] ${msg.branchDisplayName} ${msg.phone ?? ''} ${msg.address ?? ''}`;
  return {
    template,
    branchDisplayName: msg.branchDisplayName,
    phone: msg.phone,
    containsGleemName: GLEEM_NAME_MARKERS.some((m) => body.includes(m)),
    realSends: 0,
  };
}
