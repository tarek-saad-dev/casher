// Legacy route kept temporarily for backwards compatibility after HR consolidation.
import { redirect } from 'next/navigation';

export default function LegacyEmployeesPage() {
  redirect('/admin/hr?tab=employees');
}
