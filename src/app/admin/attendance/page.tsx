// Legacy route — attendance UI moved to /admin/hr?tab=attendance (Phase 4A.1)
import { redirect } from 'next/navigation';

export default function LegacyAttendancePage() {
  redirect('/admin/hr?tab=attendance');
}
