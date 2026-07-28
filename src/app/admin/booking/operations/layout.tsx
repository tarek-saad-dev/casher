import PageGuard from '@/components/guards/PageGuard';

export default function BookingOperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageGuard requiredPagePath="/admin/booking/operations">
      {children}
    </PageGuard>
  );
}
