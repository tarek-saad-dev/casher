import type { ReactNode } from 'react';
import EmployeePortalNav from './EmployeePortalNav';

export default function EmployeePortalShell({ children }: { children: ReactNode }) {
  return (
    <div dir="rtl" className="flex h-full min-h-0 w-full flex-col bg-zinc-950 text-white">
      <EmployeePortalNav placement="header" />
      <main id="staff-main-content" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-5 md:px-10 md:pt-7">
        <div className="mx-auto max-w-5xl space-y-4 md:space-y-6">
          {children}
        </div>
      </main>
      <EmployeePortalNav placement="bottom" />
    </div>
  );
}
