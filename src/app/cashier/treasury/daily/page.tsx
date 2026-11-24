import { redirect } from 'next/navigation';

/** Legacy cashier URL — merged into /treasury/daily (routing R2); capabilities follow the user's grant. */
export default function LegacyRedirectPage() {
  redirect('/treasury/daily');
}
