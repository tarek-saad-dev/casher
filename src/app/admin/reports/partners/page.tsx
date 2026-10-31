'use client';

import PartnersReportPageView from '@/components/reports/partners/PartnersReportPageView';

export default function PartnersReportPage() {
  return (
    <PartnersReportPageView
      title="تقرير الشركاء"
      subtitle="ملخص الأداء المالي الشهري"
      apiPath="/api/admin/reports/partners"
    />
  );
}
