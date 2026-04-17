import { redirect } from 'next/navigation';

export default function DailyCloseRedirect() {
  redirect('/treasury/daily');
}
