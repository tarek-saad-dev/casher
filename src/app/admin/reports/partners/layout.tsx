import PageGuard from '@/components/guards/PageGuard';

export default function PartnersReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageGuard requiredPagePath="/admin/reports/partners">
      {children}
    </PageGuard>
  );
}
