'use client';

import { usePathname } from 'next/navigation';
import MainNav from '@/components/layout/MainNav';
import ActiveSessionBar from '@/components/session/ActiveSessionBar';

interface AuthLayoutProps {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  const pathname = usePathname();
  
  // Don't show navigation on login page
  const isLoginPage = pathname === '/login';
  
  if (isLoginPage) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {children}
      </div>
    );
  }

  return (
    <>
      <ActiveSessionBar />
      {/* Responsive layout: column on mobile (nav header on top), sidebar on desktop */}
      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        <MainNav />
        <main className="flex-1 overflow-y-auto w-full">
          {children}
        </main>
      </div>
    </>
  );
}
