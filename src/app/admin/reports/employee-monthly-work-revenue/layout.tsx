import PageGuard from '@/components/guards/PageGuard';

export default function EmployeeMonthlyWorkRevenueLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageGuard requiredPagePath="/admin/reports/employee-monthly-work-revenue">
      {children}
    </PageGuard>
  );
}
