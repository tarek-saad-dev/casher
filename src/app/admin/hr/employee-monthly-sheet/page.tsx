import PageGuard from '@/components/guards/PageGuard';
import EmployeeMonthlySheetPanel from '@/components/hr/EmployeeMonthlySheetPanel';

export default function EmployeeMonthlySheetPage() {
  return (
    <PageGuard requiredPagePath="/admin/hr">
      <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
        <EmployeeMonthlySheetPanel />
      </div>
    </PageGuard>
  );
}
