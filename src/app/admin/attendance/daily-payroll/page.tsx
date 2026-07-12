// Legacy route — daily payroll UI moved to /admin/hr?tab=daily-payroll (Phase 4C.1)
import { redirect } from 'next/navigation';

export default function LegacyDailyPayrollPage() {
  redirect('/admin/hr?tab=daily-payroll');
}
