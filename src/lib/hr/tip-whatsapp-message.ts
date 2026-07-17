export function composeEmployeeTipWhatsAppMessage(input: {
  employeeName: string;
  tipAmount: number;
  invoiceTotal: number;
  amountPaid: number;
  newBalance: number;
  paymentMethod?: string;
}): string {
  const paymentPart = input.paymentMethod?.trim()
    ? `\nطريقة الدفع: ${input.paymentMethod.trim()}`
    : '';

  return [
    `مرحباً ${input.employeeName.trim()}`,
    '',
    `تم إضافة تبس لحسابك بقيمة ${input.tipAmount.toFixed(2)} ج.م.`,
    `رصيدك الحالي في الحساب: ${input.newBalance.toFixed(2)} ج.م.${paymentPart}`,
  ].join('\n');
}