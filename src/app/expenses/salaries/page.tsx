'use client';

import { useState } from 'react';
import { Banknote, Users, CalendarCheck, Wallet } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import PayrollSummaryTab   from '@/components/payroll/PayrollSummaryTab';
import PayrollSettingsTab  from '@/components/payroll/PayrollSettingsTab';
import AttendanceTab       from '@/components/payroll/AttendanceTab';
import AdvancesTab         from '@/components/payroll/AdvancesTab';

const TABS = [
  { id: 'summary',    label: 'ملخص المرتبات',      icon: Banknote },
  { id: 'settings',   label: 'إعدادات الموظفين',    icon: Users },
  { id: 'attendance', label: 'الحضور والانصراف',    icon: CalendarCheck },
  { id: 'advances',   label: 'السلف والخصومات',      icon: Wallet },
] as const;

type TabId = typeof TABS[number]['id'];

export default function SalariesPage() {
  const [activeTab, setActiveTab] = useState<TabId>('summary');

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5" dir="rtl">
      <PageHeader
        title="مرتبات العاملين"
        description="إدارة الرواتب والتارجت والحضور والسلف للموظفين"
      />

      {/* ── Tabs ── */}
      <div className="flex gap-1 p-1 bg-zinc-900/60 border border-zinc-800/60 rounded-xl w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === id
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/60'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      {activeTab === 'summary'    && <PayrollSummaryTab />}
      {activeTab === 'settings'   && <PayrollSettingsTab />}
      {activeTab === 'attendance' && <AttendanceTab />}
      {activeTab === 'advances'   && <AdvancesTab />}
    </div>
  );
}
