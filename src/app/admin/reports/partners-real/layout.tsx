import PageGuard from '@/components/guards/PageGuard';

export default function PartnersRealReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageGuard requiredPagePath="/admin/reports/partners-real">
      <div className="-m-6 w-auto min-w-0 overflow-x-hidden">
        {children}
      </div>
    </PageGuard>
  );
}
