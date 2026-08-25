import PageGuard from '@/components/guards/PageGuard';

export default function AdminWhatsAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageGuard requiredPagePath="/admin/whatsapp">
      {children}
    </PageGuard>
  );
}
