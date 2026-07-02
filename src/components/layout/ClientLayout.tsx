'use client';

import ActiveSessionBar from '@/components/session/ActiveSessionBar';
import MainNav from '@/components/layout/MainNav';
import TopNavPortal from '@/components/layout/TopNavPortal';

interface ClientLayoutProps {
  children: React.ReactNode;
}

export default function ClientLayout({ children }: ClientLayoutProps) {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <ActiveSessionBar />
      {/* TopNavPortal renders into document.body — bypasses overflow-hidden */}
      <TopNavPortal />
      <div className="flex flex-1 overflow-hidden">
        <MainNav />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
