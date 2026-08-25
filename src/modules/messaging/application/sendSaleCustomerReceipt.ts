import { getWhatsAppConfig } from '@/lib/integrations/whatsapp';

import type { MessageSendResult } from '../domain/types';

import { sendTemplateMessage } from './sendTemplateMessage';

import { SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY } from '../templates/catalog';



export type SaleCustomerReceiptInput = {

  phone: string;

  customerName: string;

  invoiceId: number;

  total: number;

  paymentMethod?: string;

  services?: string[];

  employeeNames?: string[];

  branchName?: string;

  branchId?: number;

};



/**

 * Maps POS sale fields the same way the legacy typed sender + bot did.

 * employeeName falls back to customerName (bot `buildTemplateData`).

 */

export function buildSaleCustomerReceiptData(

  input: SaleCustomerReceiptInput,

): Record<string, unknown> {

  const cfg = getWhatsAppConfig();

  const customerName = input.customerName.trim();

  const uniqueEmployees = input.employeeNames

    ? [...new Set(input.employeeNames.filter(Boolean))]

    : undefined;

  const joinedEmployees =

    uniqueEmployees && uniqueEmployees.length > 0

      ? uniqueEmployees.join(' / ')

      : undefined;



  return {

    customerName,

    invoiceNumber: `INV-${input.invoiceId}`,

    total: input.total,

    paymentMethod: input.paymentMethod,

    branchName: input.branchName ?? cfg.defaultBranchName,

    employeeName: joinedEmployees || customerName,

    services: input.services && input.services.length > 0 ? input.services : undefined,

  };

}



/**

 * Convenience wrapper around sendTemplateMessage for the POS customer receipt.

 */

export async function sendSaleCustomerReceipt(

  input: SaleCustomerReceiptInput,

): Promise<MessageSendResult> {

  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';

  if (!phone) {

    console.log('[whatsapp] Sale message skipped: missing phone');

    return { sent: false, channel: 'whatsapp', reason: 'missing_phone', skipped: true };

  }



  if (!input.customerName?.trim()) {

    console.log('[whatsapp] Sale message skipped: missing customer name');

    return { sent: false, channel: 'whatsapp', reason: 'missing_customer_name', skipped: true };

  }



  const result = await sendTemplateMessage({

    templateKey: SALE_CUSTOMER_RECEIPT_TEMPLATE_KEY,

    recipient: { phone },

    variables: buildSaleCustomerReceiptData(input),

    metadata: {

      ...(typeof input.branchId === 'number' ? { branchId: input.branchId } : {}),

      ...(typeof input.invoiceId === 'number' ? { invoiceId: input.invoiceId } : {}),

    },

    context: {

      language: 'ar',

      ...(typeof input.branchId === 'number' ? { branchId: input.branchId } : {}),

    },

  });



  if (result.sent) {

    console.log(`[whatsapp] Sale message submitted for invoice INV-${input.invoiceId}`);

  }



  return result;

}


