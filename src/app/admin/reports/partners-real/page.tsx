'use client';

import PartnersReportPageView from '@/components/reports/partners/PartnersReportPageView';

export default function PartnersRealReportPage() {
  return (
    <PartnersReportPageView
      title="تقرير الشهر الحقيقي"
      subtitle="ملخص الأداء المالي الشهري — أرقام النظام بدون تعديل"
      apiPath="/api/admin/reports/partners-real"
    />
  );
}
