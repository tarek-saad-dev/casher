'use client';

import { useMemo } from 'react';
import MonthlyFinancialEquations from '@/components/reports/MonthlyFinancialEquations';
import { calculateMonthlyFinancialEquations } from '@/lib/reports/monthlyFinancialEquations';
import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import { calcRemainingAfterEmployees } from './PartnersEmployeeFlowSection';
import { calcOperatingNet } from './PartnersOperatingNetFlowSection';

interface PartnersFinalSettlementSectionProps {
  year: number;
  month: number;
  totals: PartnersMonthlyReportResponse['employeeSummaryTotals'];
  filteredOperatingExpenses: number;
  loading: boolean;
  classifiedOperatingNet?: number | null;
  legacyOperatingNet?: number | null;
}

export default function PartnersFinalSettlementSection({
  year,
  month,
  totals,
  filteredOperatingExpenses,
  loading,
  classifiedOperatingNet,
}: PartnersFinalSettlementSectionProps) {
  const remainingAfterEmployees = calcRemainingAfterEmployees(
    totals.totalShopRevenue,
    totals.totalPaidSalaryAndAdvances
  );
  const operatingNet = calcOperatingNet(remainingAfterEmployees, filteredOperatingExpenses);
  const baseAmount = classifiedOperatingNet ?? operatingNet;

  const result = useMemo(
    () =>
      calculateMonthlyFinancialEquations({
        year,
        month,
        baseAmount,
        mode: 'partners',
        baseAmountAlreadyNetOfEmployees: classifiedOperatingNet == null,
        baseAmountAlreadyNetOfOperatingExpenses: classifiedOperatingNet != null,
      }),
    [year, month, baseAmount, classifiedOperatingNet]
  );

  return (
    <MonthlyFinancialEquations
      result={result}
      title="التسوية والتوزيع النهائي للشركاء"
      subtitle={
        classifiedOperatingNet != null
          ? 'تطبيق المعادلات المالية الشهرية على صافي الربح النظيف (تصنيف محاسبي)'
          : 'تطبيق المعادلات المالية الشهرية على صافي التشغيل'
      }
      baseAmountLabel={
        classifiedOperatingNet != null ? 'صافي الربح النظيف' : 'صافي التشغيل المستخدم كبداية'
      }
      distributableLabel="المبلغ النهائي القابل للتوزيع"
      lossDistributableLabel="خسارة قابلة للتوزيع"
      variant="partners"
      loading={loading}
    />
  );
}
