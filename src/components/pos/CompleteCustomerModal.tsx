'use client';

import { useState } from 'react';
import { UserCog, Cake, MapPin, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Customer } from '@/lib/types';

interface CompleteCustomerModalProps {
  customer: Customer;
  onClose: () => void;
  onUpdated: (updated: Customer) => void;
}

export default function CompleteCustomerModal({
  customer,
  onClose,
  onUpdated,
}: CompleteCustomerModalProps) {
  const [birthDate, setBirthDate] = useState(
    customer.BirthDate ? customer.BirthDate.split('T')[0] : ''
  );
  const [address,   setAddress]   = useState(customer.Address   ?? '');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  const missingBirthDate = !customer.BirthDate;
  const missingAddress   = !customer.Address;

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, string | null> = {};
      if (missingBirthDate && birthDate)         payload.birthDate = birthDate;
      if (missingAddress   && address.trim())    payload.address   = address.trim();

      if (Object.keys(payload).length === 0) {
        onClose();
        return;
      }

      const res = await fetch(`/api/customers/${customer.ClientID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) { setError(data.error || 'خطأ في الحفظ'); return; }

      onUpdated(data);
    } catch {
      setError('خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" dir="rtl">
            <UserCog className="w-5 h-5 text-amber-400" />
            تكملة بيانات العميل
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1" dir="rtl">
          {/* Customer name (readonly) */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-sm font-medium">{customer.Name}</span>
          </div>

          {/* Missing fields only */}
          {(missingBirthDate || missingAddress) && (
            <div className="space-y-1.5">
              {missingBirthDate && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Cake className="w-3.5 h-3.5 text-amber-400" />
                    تاريخ الميلاد
                    <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full border border-amber-400/20">ناقص</span>
                  </label>
                  <Input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    dir="ltr"
                    className="text-left"
                  />
                </div>
              )}
              {missingAddress && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-amber-400" />
                    العنوان
                    <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full border border-amber-400/20">ناقص</span>
                  </label>
                  <Input
                    placeholder="عنوان العميل..."
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 justify-end pt-1" dir="ltr">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              إلغاء
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-amber-600 hover:bg-amber-700 gap-2"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ البيانات'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
