import { redirect } from 'next/navigation';

/** One-off migration screen retired (routing R1); the API stays development-admin only. */
export default function LegacyRedirectPage() {
  redirect('/admin/hr');
}
