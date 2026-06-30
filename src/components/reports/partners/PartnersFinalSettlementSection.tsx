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
}

export default function PartnersFinalSettlementSection({
  year,
  month,
  totals,
  filteredOperatingExpenses,
  loading,
}: PartnersFinalSettlementSectionProps) {
  const remainingAfterEmployees = calcRemainingAfterEmployees(
    totals.totalShopRevenue,
    totals.totalPaidSalaryAndAdvances
  );
  const operatingNet = calcOperatingNet(remainingAfterEmployees, filteredOperatingExpenses);

  const result = useMemo(
    () =>
      calculateMonthlyFinancialEquations({
        year,
        month,
        baseAmount: operatingNet,
        mode: 'partners',
        baseAmountAlreadyNetOfEmployees: true,
        baseAmountAlreadyNetOfOperatingExpenses: true,
      }),
    [year, month, operatingNet]
  );

  return (
    <MonthlyFinancialEquations
      result={result}
      title="التسوية والتوزيع النهائي للشركاء"
      subtitle="تطبيق المعادلات المالية الشهرية على صافي التشغيل"
      baseAmountLabel="صافي التشغيل المستخدم كبداية"
      distributableLabel="المبلغ النهائي القابل للتوزيع"
      lossDistributableLabel="خسارة قابلة للتوزيع"
      variant="partners"
      loading={loading}
    />
  );
}
