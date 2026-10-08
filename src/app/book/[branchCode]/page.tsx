import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadHostedBookingPage } from '@/lib/booking/hostedBookingPage';
import HostedBookingFlow from './HostedBookingFlow';

type PageProps = { params: Promise<{ branchCode: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { branchCode } = await params;
  const data = await loadHostedBookingPage(branchCode);
  if (!data) return { title: 'غير موجود' };
  return { title: `احجز موعدك — ${data.brand.displayName}` };
}

/**
 * DRVO-019 hosted tenant booking page. Unknown / inactive / non-public branch, or a tenant without
 * the booking app, answers 404 (same outcome as the public booking APIs).
 */
export default async function HostedBookingPage({ params }: PageProps) {
  const { branchCode } = await params;
  const data = await loadHostedBookingPage(branchCode);
  if (!data) notFound();
  return <HostedBookingFlow data={data} />;
}
