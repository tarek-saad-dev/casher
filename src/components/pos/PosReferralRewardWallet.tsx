'use client';

import { useEffect, useState } from 'react';
import { Gift, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type PosRewardWalletItem = {
  voucherId: number;
  discountPercent: 20;
  issuedAtUtc: string;
  expiresAtUtc: string | null;
};

type WalletState = {
  loading: boolean;
  error: string | null;
  items: PosRewardWalletItem[];
};

function validateWalletResponse(data: unknown, clientId: number): PosRewardWalletItem[] {
  if (!data || typeof data !== 'object') throw new Error('invalid');
  const body = data as Record<string, unknown>;
  if (body.ok !== true || body.previewOnly !== true || body.clientId !== clientId ||
      !Array.isArray(body.vouchers) || body.vouchers.length > 100) throw new Error('invalid');
  return body.vouchers.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('invalid');
    const v = item as Record<string, unknown>;
    if (!Number.isSafeInteger(v.voucherId) || Number(v.voucherId) < 1 ||
        v.discountPercent !== 20 ||
        typeof v.issuedAtUtc !== 'string' ||
        !(v.expiresAtUtc === null || typeof v.expiresAtUtc === 'string')) throw new Error('invalid');
    return {
      voucherId: Number(v.voucherId),
      discountPercent: 20 as const,
      issuedAtUtc: v.issuedAtUtc,
      expiresAtUtc: v.expiresAtUtc as string | null,
    };
  });
}

/**
 * Uses only staff-authenticated READ-ONLY wallet GET. No pre-consumption call.
 * The parent is keyed by selected clientId, and server validates voucher
 * ownership/status/payment before the sale transaction marks anything USED.
 */
export default function PosReferralRewardWallet({
  clientId, appliedVoucherId, canApply, onApply, onRemove,
}: {
  clientId: number;
  appliedVoucherId?: number | null;
  canApply: boolean;
  onApply: (voucherId: number, clientId: number) => void;
  onRemove: () => void;
}) {
  const [wallet, setWallet] = useState<WalletState>({ loading: true, error: null, items: [] });

  useEffect(() => {
    const controller = new AbortController();
    setWallet({ loading: true, error: null, items: [] });
    (async () => {
      try {
        const response = await fetch(
          `/api/pos/referrals/wallet?clientId=${encodeURIComponent(String(clientId))}`,
          { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal },
        );
        if (!response.ok) throw new Error('unavailable');
        const body = await response.json() as unknown;
        const items = validateWalletResponse(body, clientId);
        if (!controller.signal.aborted) setWallet({ loading: false, error: null, items });
      } catch {
        if (!controller.signal.aborted) setWallet({
          loading: false, error: 'تعذر تحميل محفظة الإحالات؛ مفيش مكافأة هتتطبق.',
          items: [],
        });
      }
    })();
    return () => controller.abort();
  }, [clientId]);

  return (
    <section data-testid="pos-referral-reward-wallet"
      className="rounded-lg border border-border bg-card p-3 space-y-3" dir="rtl"
      aria-label="محفظة مكافآت الإحالات">
      <div className="flex items-center gap-2">
        <Gift className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">مكافآت إحالات العميل</h3>
        <span className="text-[10px] rounded bg-muted px-2 py-0.5 text-muted-foreground">20%</span>
      </div>

      {wallet.loading && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> جاري تحميل المكافآت
        </p>
      )}
      {wallet.error && (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {wallet.error}
        </p>
      )}
      {!wallet.loading && !wallet.error && wallet.items.length === 0 && !appliedVoucherId && (
        <p className="text-xs text-muted-foreground" data-testid="wallet-empty">
          مفيش مكافآت 20% متاحة للعميل حاليًا.
        </p>
      )}
      {appliedVoucherId ? (
        <div className="space-y-2">
          <p role="status" className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            اتطبق خصم المكافأة 20% على مسودة الفاتورة. هيتأكد عند الدفع.
          </p>
          <Button type="button" variant="outline" className="w-full"
            data-testid="wallet-remove" onClick={onRemove}>إلغاء المكافأة</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {wallet.items.map(item => (
            <div key={item.voucherId} className="flex items-center justify-between gap-3 rounded-md border p-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">مكافأة خصم 20%</p>
                <p className="text-xs text-muted-foreground">
                  {item.expiresAtUtc ? 'صلاحيتها محدودة' : 'بدون تاريخ انتهاء محدد'}
                </p>
              </div>
              <Button type="button" variant="outline" size="sm"
                data-testid={`wallet-apply-${item.voucherId}`}
                disabled={!canApply}
                onClick={() => onApply(item.voucherId, clientId)}>
                تطبيق
              </Button>
            </div>
          ))}
          {!canApply && wallet.items.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              لازم الخدمات تكون بالسعر الكامل من غير أي خصم يدوي أو كود إحالة 50%.
            </p>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        فحص المحفظة لا يستهلك المكافأة؛ الصرف بيتم مرة واحدة بعد حفظ فاتورة مدفوعة.
      </p>
    </section>
  );
}
