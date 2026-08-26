'use client';

import { useMemo } from 'react';
import MonthlyFinancialEquations from '@/components/reports/MonthlyFinancialEquations';
import { calculateMonthlyFinancialEquations } from '@/lib/reports/monthlyFinancialEquations';
import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import { calcRemainingAfterEmployees } from './PartnersEmployeeFlowSection';
import { calcOperatingNet } from './PartnersOperatingNetFlowSection';
import { partnersEmployeePaidTotal } from './partnersReportUtils';

interface PartnersFinalSettlementSectionProps {
  year: number;
  month: number;
  totals: PartnersMonthlyReportResponse['employeeSummaryTotals'];
  /** Effective branch partner shares from the API response (Phase 1E). */
  partners: PartnersMonthlyReportResponse['partners'];
  filteredOperatingExpenses: number;
  loading: boolean;
  classifiedOperatingNet?: number | null;
  legacyOperatingNet?: number | null;
}

export default function PartnersFinalSettlementSection({
  year,
  month,
  totals,
  partners,
  filteredOperatingExpenses,
  loading,
  classifiedOperatingNet,
}: PartnersFinalSettlementSectionProps) {
  const remainingAfterEmployees = calcRemainingAfterEmployees(
    totals.totalShopRevenue,
    partnersEmployeePaidTotal(totals)
  );
  const operatingNet = calcOperatingNet(remainingAfterEmployees, filteredOperatingExpenses);
  const baseAmount = classifiedOperatingNet ?? operatingNet;

  const result = useMemo(
    () =>
      partners.length > 0
        ? calculateMonthlyFinancialEquations({
            year,
            month,
            baseAmount,
            mode: 'partners',
            partners,
            baseAmountAlreadyNetOfEmployees: classifiedOperatingNet == null,
            baseAmountAlreadyNetOfOperatingExpenses: classifiedOperatingNet != null,
          })
        : null,
    [year, month, baseAmount, classifiedOperatingNet, partners]
  );

  if (!result) {
    return null;
  }

  return (
    <MonthlyFinancialEquations
      result={result}
      title="التسوية والتوزيع النهائي للشركاء"
      subtitle={
        classifiedOperatingNet != null
          ? 'خصم نسبة إدارة 5% من صافي الربح النظيف ثم التوزيع على الشركاء'
          : 'خصم نسبة إدارة 5% من صافي التشغيل ثم التوزيع على الشركاء'
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
