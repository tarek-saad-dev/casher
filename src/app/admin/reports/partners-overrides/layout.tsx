import PageGuard from '@/components/guards/PageGuard';

export default function PartnersOverridesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageGuard requiredPagePath="/admin/reports/partners-overrides">
      {children}
    </PageGuard>
  );
}
