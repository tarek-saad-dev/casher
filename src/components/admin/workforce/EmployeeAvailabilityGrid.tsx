'use client';

import {
  EmployeeAvailabilityCard,
  type EmployeeCardModel,
} from '@/components/admin/workforce/EmployeeAvailabilityCard';
import type { DailyAdjustmentType } from '@/lib/availability/dailyAdjustments';

export function EmployeeAvailabilityGrid({
  employees,
  onAction,
  onExplain,
}: {
  employees: EmployeeCardModel[];
  onAction: (emp: EmployeeCardModel, type: DailyAdjustmentType) => void;
  onExplain: (emp: EmployeeCardModel) => void;
}) {
  if (!employees.length) {
    return (
      <div
        className="rounded-xl border border-dashed border-zinc-700 p-10 text-center text-sm text-zinc-400"
        role="status"
      >
        لا يوجد موظفون معيَّنون على هذا الفرع لهذا اليوم.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
      {employees.map((emp) => (
        <EmployeeAvailabilityCard
          key={emp.employeeId}
          employee={emp}
          onAction={(type) => onAction(emp, type)}
          onExplain={() => onExplain(emp)}
        />
      ))}
    </div>
  );
}
