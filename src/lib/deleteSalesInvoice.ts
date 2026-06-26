/**
 * Shared helper for deleting a sales invoice.
 * Every DELETE /api/sales/[id] caller MUST go through this function
 * so the reason is always included in the request body.
 */
export interface DeleteSalesInvoiceResult {
  success: true;
  message: string;
  auditId: number;
}

export async function deleteSalesInvoice(
  invoiceId: number,
  reason: string,
): Promise<DeleteSalesInvoiceResult> {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new Error('سبب مسح فاتورة المبيعات مطلوب');
  }

  const response = await fetch(`/api/sales/${invoiceId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: normalizedReason }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || data.message || 'فشل مسح الفاتورة');
  }

  return data as DeleteSalesInvoiceResult;
}
