import PageGuard from '@/components/guards/PageGuard';

export default function FullDayReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageGuard requiredPagePath="/admin/reports/full-day">
      {children}
    </PageGuard>
  );
}
