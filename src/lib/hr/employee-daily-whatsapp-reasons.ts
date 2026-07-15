/** Arabic labels for daily WhatsApp skip/fail reasons. */

export const DAILY_WA_REASON_AR: Record<string, string> = {
  no_phone: 'مفيش رقم واتساب/موبايل مسجّل للموظف',
  inactive: 'الموظف غير نشط',
  day_off_empty: 'يوم راحة بدون حضور — اتتخطى في الإرسال الجماعي',
  future: 'تاريخ مستقبلي',
  not_found: 'الموظف غير موجود',
  no_payload: 'مفيش بيانات للإرسال',
  development_only:
    'تكامل واتساب مقفول — لازم NODE_ENV=development و WHATSAPP_INTEGRATION_ENABLED=true',
  message_type_disabled: 'نوع employee_daily_report معطّل في الإعدادات',
  missing_phone: 'رقم الواتساب فاضي',
  missing_customer_name: 'اسم الموظف فاضي',
  invalid_payload: 'بيانات الرسالة غير صالحة',
  invalid_phone: 'رقم الواتساب غير صالح',
  whatsapp_not_ready: 'بوت الواتساب مش جاهز (WhatsApp Web مش متصل)',
  timeout: 'انتهت مهلة الاتصال ببوت الواتساب على :3000',
  connection_failed: 'مفيش اتصال ببوت الواتساب — هل http://localhost:3000 شغّال؟',
  remote_error: 'خطأ من بوت الواتساب',
  invalid_response: 'رد غير مفهوم من بوت الواتساب',
  dry_run: 'تجربة بدون إرسال',
};

export function dailyWaReasonAr(reason: string | null | undefined): string {
  if (!reason) return 'غير معروف';
  return DAILY_WA_REASON_AR[reason] ?? reason;
}
