'use client';

import { useEffect, useState } from 'react';
import { Loader2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export const POS_WHATSAPP_WELCOME_MESSAGE = 'أهلا بك في Cut Salon';

interface QuickWhatsAppModalProps {
  open: boolean;
  onClose: () => void;
  defaultPhone?: string | null;
  defaultCustomerName?: string | null;
  onSent?: () => void;
}

function sanitizePhoneInput(raw: string): string {
  return raw.replace(/[^\d+\s-]/g, '').trim();
}

export default function QuickWhatsAppModal({
  open,
  onClose,
  defaultPhone,
  defaultCustomerName,
  onSent,
}: QuickWhatsAppModalProps) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPhone((defaultPhone ?? '').trim());
    setError('');
    setSending(false);
  }, [open, defaultPhone]);

  async function handleSend() {
    const cleaned = sanitizePhoneInput(phone);
    if (cleaned.replace(/\D/g, '').length < 8) {
      setError('أدخل رقم واتساب صحيح');
      return;
    }

    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/pos/whatsapp/quick-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleaned,
          customerName: defaultCustomerName?.trim() || 'عميل',
          message: POS_WHATSAPP_WELCOME_MESSAGE,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || 'فشل إرسال الرسالة');
        return;
      }
      onSent?.();
      onClose();
    } catch {
      setError('فشل الاتصال بالخادم');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !sending) onClose(); }}>
      <DialogContent className="border-border bg-surface sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <MessageCircle className="h-5 w-5 text-primary" />
            إرسال رسالة واتساب سريعة
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            تُرسل عبر سكربت الواتساب المستخدم في البيع والحجز
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="pos-wa-phone" className="text-xs font-medium text-muted-foreground">
              رقم الواتساب
            </label>
            <Input
              id="pos-wa-phone"
              inputMode="tel"
              dir="ltr"
              className="text-left"
              placeholder="01xxxxxxxxx"
              value={phone}
              disabled={sending}
              onChange={(e) => {
                setPhone(e.target.value);
                if (error) setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              autoFocus
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">الرسالة</p>
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-foreground">
              {POS_WHATSAPP_WELCOME_MESSAGE}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={sending}
            className="border-border bg-surface-muted text-foreground hover:bg-surface-muted/80"
          >
            إلغاء
          </Button>
          <Button type="button" onClick={() => void handleSend()} disabled={sending} className="gap-2">
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MessageCircle className="h-4 w-4" />
            )}
            {sending ? 'جاري الإرسال…' : 'إرسال'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
