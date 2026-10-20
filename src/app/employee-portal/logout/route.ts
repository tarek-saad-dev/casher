import { NextResponse } from 'next/server';
import { logoutEmployee } from '@/lib/employee-portal/auth';
export async function POST() {
  await logoutEmployee();
  return NextResponse.redirect(new URL('/employee-portal', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5500'), 303);
}
export async function GET() {
  // Not a mutating logout: navigation returns to the portal instead.
  return NextResponse.redirect(new URL('/employee-portal', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:5500'), 303);
}
