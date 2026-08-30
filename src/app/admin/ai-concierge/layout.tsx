import PageGuard from '@/components/guards/PageGuard';

export default function AdminAiConciergeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PageGuard requiredPagePath="/admin/ai-concierge">
      {children}
    </PageGuard>
  );
}
