import PageGuard from '@/components/guards/PageGuard';

export default function WorkforceAvailabilityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageGuard requiredPagePath="/admin/workforce/availability">
      {children}
    </PageGuard>
  );
}
