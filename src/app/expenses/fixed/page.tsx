import { redirect } from 'next/navigation';

/** Placeholder page retired (routing R1) — fixed expenses are recorded from /expenses. */
export default function LegacyRedirectPage() {
  redirect('/expenses');
}
