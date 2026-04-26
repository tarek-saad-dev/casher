'use client';

import { useState, useEffect } from 'react';
import { UserPlus, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Customer } from '@/lib/types';

interface QuickCustomerModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (customer: Customer) => void;
  initialQuery?: string;
}

export default function QuickCustomerModal({ open, onClose, onCreated, initialQuery }: QuickCustomerModalProps) {
  const [name,      setName]      = useState('');
  const [mobile,    setMobile]    = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [address,   setAddress]   = useState('');
  const [notes,     setNotes]     = useState('');
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  // Pre-fill when modal opens — detect phone vs name
  useEffect(() => {
    if (!open) return;
    const q = initialQuery?.trim() ?? '';
    const looksLikePhone = q.length >= 6 && /^[0-9+\s-]+$/.test(q);
    setName(looksLikePhone ? '' : q);
    setMobile(looksLikePhone ? q : '');
    setBirthDate('');
    setAddress('');
    setNotes('');
    setError('');
  }, [open, initialQuery]);

  async function handleSave() {
    if (!name.trim()) { setError('الاسم مطلوب'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          mobile: mobile.trim() || null,
          birthDate: birthDate || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'خطأ في الحفظ');
        return;
      }
      const customer = await res.json();
      onCreated(customer);
      setName('');
      setMobile('');
      setBirthDate('');
      setAddress('');
      setNotes('');
    } catch {
      setError('خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            إضافة عميل جديد
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2" dir="rtl">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-sm font-medium mb-1.5 block">الاسم *</label>
              <Input
                placeholder="اسم العميل"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">رقم الموبايل</label>
              <Input
                placeholder="01xxxxxxxxx"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                dir="ltr"
                className="text-left"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">تاريخ الميلاد</label>
              <Input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                dir="ltr"
                className="text-left"
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
              العنوان
            </label>
            <Input
              placeholder="عنوان العميل..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">ملاحظات</label>
            <textarea
              placeholder="أي معلومات إضافية عن العميل..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2 justify-end" dir="ltr">
            <Button variant="outline" onClick={onClose}>إلغاء</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'حفظ واختيار'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
