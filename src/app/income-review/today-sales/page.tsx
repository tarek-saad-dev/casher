import { redirect } from 'next/navigation';

/** Duplicate of /sales/today (routing R1). */
export default function LegacyRedirectPage() {
  redirect('/sales/today');
}
