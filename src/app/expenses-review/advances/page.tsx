import { redirect } from 'next/navigation';

/** Placeholder page retired (routing R1) — employee advances live in HR. */
export default function LegacyRedirectPage() {
  redirect('/admin/hr');
}
