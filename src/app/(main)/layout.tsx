import ClientLayout from '@/components/layout/ClientLayout';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return <ClientLayout>{children}</ClientLayout>;
}
