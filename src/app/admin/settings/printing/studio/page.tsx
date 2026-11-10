import { notFound } from 'next/navigation';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import ReceiptStudioEditor from '@/components/receipt-studio/ReceiptStudioEditor';

export const dynamic = 'force-dynamic';

/** Admin-only experimental editor. It has no DB writes or production print calls. */
export default async function ReceiptStudioPage() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) notFound();
  return <ReceiptStudioEditor />;
}
