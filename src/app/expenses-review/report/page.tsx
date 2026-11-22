import { redirect } from 'next/navigation';

/** Placeholder with hard-coded zero KPIs retired (routing R1). */
export default function LegacyRedirectPage() {
  redirect('/reports/expenses/monthly');
}
