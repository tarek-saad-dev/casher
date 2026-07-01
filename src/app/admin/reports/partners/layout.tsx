import PageGuard from '@/components/guards/PageGuard';

export default function PartnersReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageGuard requiredPagePath="/admin/reports/partners">
      <div className="-m-6 w-auto min-w-0 overflow-x-hidden">
        {children}
      </div>
    </PageGuard>
  );
}
