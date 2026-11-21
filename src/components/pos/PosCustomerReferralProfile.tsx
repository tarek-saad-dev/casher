'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Gift, Loader2, Share2, Users, UserRoundCheck, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

export const POS_CUSTOMER_REFERRAL_PROFILE_UI_ENABLED =
  process.env.NEXT_PUBLIC_POS_REFERRAL_PROFILE_ENABLED === 'true';

export type CustomerReferralProfile = {
  clientId: number;
  code: string | null;
  codeActivated: boolean;
  successfulReferrals: number;
  refundedReferrals: number;
  totalRewardedReferrals: number;
  earnedRewards: number;
  availableRewards: number;
  usedRewards: number;
};

const CODE_RE = /^CUT-[0-9A-F]{24}$/;

export function parseCustomerReferralProfileResponse(
  body: unknown,
  clientId: number,
): CustomerReferralProfile {
  if (!body || typeof body !== 'object') throw new Error('INVALID_REFERRAL_PROFILE');
  const source = body as Record<string, unknown>;
  if (source.ok !== true || !source.profile || typeof source.profile !== 'object') {
    throw new Error('INVALID_REFERRAL_PROFILE');
  }
  const profile = source.profile as Record<string, unknown>;
  if (profile.clientId !== clientId ||
      typeof profile.codeActivated !== 'boolean' ||
      !(profile.code === null || (typeof profile.code === 'string' && CODE_RE.test(profile.code))) ||
      (profile.codeActivated !== (profile.code !== null))) {
    throw new Error('INVALID_REFERRAL_PROFILE');
  }
  const numericKeys = [
    'successfulReferrals', 'refundedReferrals', 'totalRewardedReferrals',
    'earnedRewards', 'availableRewards', 'usedRewards',
  ] as const;
  for (const key of numericKeys) {
    if (typeof profile[key] !== 'number' ||
        !Number.isSafeInteger(profile[key]) || Number(profile[key]) < 0) {
      throw new Error('INVALID_REFERRAL_PROFILE');
    }
  }
  const result = profile as CustomerReferralProfile;
  if (result.successfulReferrals + result.refundedReferrals !== result.totalRewardedReferrals ||
      result.availableRewards + result.usedRewards > result.earnedRewards) {
    throw new Error('INVALID_REFERRAL_PROFILE');
  }
  return result;
}

export function buildCustomerReferralWhatsAppShare(code: string): string {
  if (!CODE_RE.test(code)) throw new Error('INVALID_REFERRAL_CODE');
  const message = `حابب أشارك معاك كود الإحالة الخاص بـCut Salon ✂️\n\nالكود: ${code}\n\nلو دي أول زيارة مؤهلة ليك، اسأل موظف الكاشير عن خصم الإحالة 50% حسب شروط العرض.`;
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/**
 * Compact launcher keeps the selected-customer header small on mobile.
 * Does not fetch until staff opens; never edits invoice or reward balance.
 */
export default function PosCustomerReferralProfile({
  clientId,
}: { clientId: number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<CustomerReferralProfile | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setProfile(null);
      setError(null);
      setCopied(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setCopied(false);
    setProfile(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/pos/referrals/customer-profile?clientId=${encodeURIComponent(String(clientId))}`,
          { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal },
        );
        if (!res.ok) throw new Error('UNAVAILABLE');
        const body: unknown = await res.json();
        const parsed = parseCustomerReferralProfileResponse(body, clientId);
        if (!controller.signal.aborted) setProfile(parsed);
      } catch {
        if (!controller.signal.aborted) {
          setError('تعذر تحميل ملف الإحالات؛ جرب تفتح الملف مرة تانية.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [clientId, open]);

  const copyCode = async () => {
    if (!profile?.code) return;
    try {
      await navigator.clipboard.writeText(profile.code);
      setCopied(true);
      setError(null);
    } catch {
      setCopied(false);
      setError('النسخ غير متاح على الجهاز ده؛ انسخ الكود الظاهر يدويًا.');
    }
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline"
        data-testid="customer-referral-open"
        className="mt-2 min-h-10 w-full justify-center gap-2"
        onClick={() => setOpen(true)}>
        <Gift className="h-4 w-4" /> كود الإحالة والمكافآت
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-lg" dir="rtl"
          data-testid="customer-referral-dialog">
          <DialogHeader>
            <DialogTitle>ملف إحالات العميل</DialogTitle>
            <DialogDescription>
              كود العميل الدائم ومكافآت الإحالات المسجلة. عرض فقط، من غير أي حركة مالية.
            </DialogDescription>
          </DialogHeader>
          {loading && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin"/> جارٍ تحميل الإحالات...
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {!loading && profile && (
            <div className="space-y-4" data-testid="customer-referral-profile">
              {profile.code ? (
                <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">كود الإحالة الدائم</p>
                  <p className="break-all font-mono text-base font-bold tracking-wide"
                    data-testid="customer-referral-code" dir="ltr">{profile.code}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="secondary"
                      data-testid="customer-referral-copy" onClick={copyCode}>
                      {copied ? <Check className="ml-2 h-4 w-4" /> : <Copy className="ml-2 h-4 w-4" />}
                      {copied ? 'اتنسخ الكود' : 'نسخ الكود'}
                    </Button>
                    <Button type="button" size="sm" variant="outline"
                      render={<a href={buildCustomerReferralWhatsAppShare(profile.code)}
                        target="_blank" rel="noopener noreferrer"
                        data-testid="customer-referral-whatsapp" />}>
                      <Share2 className="ml-2 h-4 w-4"/> مشاركة WhatsApp
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/40 p-3"
                  data-testid="customer-referral-not-activated">
                  <p className="text-sm font-semibold">الكود لسه مش متفعّل</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    العميل هياخد كوده الدائم تلقائيًا بعد أول فاتورة مدفوعة ومؤهلة؛
                    مفيش كود مؤقت هيتولد من الصفحة دي.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border p-3">
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <UserRoundCheck className="h-3.5 w-3.5"/> إحالات ناجحة
                  </p>
                  <p className="mt-1 text-xl font-bold" data-testid="customer-referral-success">
                    {profile.successfulReferrals}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5"/> إجمالي الإحالات المكافأة
                  </p>
                  <p className="mt-1 text-xl font-bold" data-testid="customer-referral-total">
                    {profile.totalRewardedReferrals}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Gift className="h-3.5 w-3.5"/> مكافآت 20% المتاحة
                  </p>
                  <p className="mt-1 text-xl font-bold" data-testid="customer-referral-available">
                    {profile.availableRewards}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Check className="h-3.5 w-3.5"/> مكافآت مستخدمة
                  </p>
                  <p className="mt-1 text-xl font-bold" data-testid="customer-referral-used">
                    {profile.usedRewards}
                  </p>
                </div>
              </div>
              {profile.refundedReferrals > 0 && (
                <p className="flex gap-2 text-xs text-muted-foreground"
                  data-testid="customer-referral-refunded">
                  <XCircle className="h-4 w-4 shrink-0"/>
                  {profile.refundedReferrals} إحالة فواتيرها اتلغت؛ المكافآت اللي اتصدرت عنها تفضل صالحة حسب السياسة.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                إجمالي المكافآت الصادرة: {profile.earnedRewards} — الأرقام من سجل الإحالات،
                ومش معناها رصيد فلوس قابل للسحب.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
