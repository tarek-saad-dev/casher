import { redirect } from 'next/navigation';

/** Legacy standalone URL → HR tab. */
export default async function EmployeeMonthlySheetRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = new URLSearchParams();
  q.set('tab', 'employee-monthly-sheet');
  for (const key of ['employeeId', 'year', 'month'] as const) {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) q.set(key, value);
  }
  redirect(`/admin/hr?${q.toString()}`);
}
