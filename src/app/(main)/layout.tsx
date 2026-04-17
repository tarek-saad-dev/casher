'use client';

import ActiveSessionBar from '@/components/session/ActiveSessionBar';
import MainNav from '@/components/layout/MainNav';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-zinc-950">
      <ActiveSessionBar />
      <div className="flex flex-1 overflow-hidden">
        <MainNav />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
