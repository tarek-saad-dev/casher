import { redirect } from 'next/navigation';

export default function NewExpenseRedirect() {
  redirect('/expenses');
}
