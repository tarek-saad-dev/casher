import PageGuard from '@/components/guards/PageGuard';

export default function PartnersAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageGuard requiredPagePath="/admin/partners">
      {children}
    </PageGuard>
  );
}
