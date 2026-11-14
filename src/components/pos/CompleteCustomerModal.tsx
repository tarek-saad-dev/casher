'use client';

import { useState } from 'react';
import { UserCog, Cake, MapPin, CheckCircle, Pencil, Phone, FileText, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import CustomerSourceFields from '@/components/pos/CustomerSourceFields';
import {
  isCustomerSourceMissing,
  isKnownCustomerSource,
  validateCustomerSource,
  type CustomerSource,
} from '@/lib/customerSource';
import type { Customer } from '@/lib/types';

interface CompleteCustomerModalProps {
  customer: Customer;
  onClose: () => void;
  onUpdated: (updated: Customer) => void;
  mode?: 'complete' | 'edit';
}

export default function CompleteCustomerModal({
  customer,
  onClose,
  onUpdated,
  mode = 'complete',
}: CompleteCustomerModalProps) {
  const isEditMode = mode === 'edit';

  const [name,      setName]      = useState(customer.Name      ?? '');
  const [birthDate, setBirthDate] = useState(
    customer.BirthDate ? customer.BirthDate.split('T')[0] : ''
  );
  const [address,   setAddress]   = useState(customer.Address   ?? '');
  const [mobile,    setMobile]    = useState(customer.Mobile    ?? '');
  const [notes,     setNotes]     = useState(customer.Notes     ?? '');
  const [cameFrom, setCameFrom] = useState<CustomerSource | null>(
    isKnownCustomerSource(customer.CameFrom) ? customer.CameFrom : null
  );
  const [cameFromDetails, setCameFromDetails] = useState(customer.CameFromDetails ?? '');
  const [referralCode, setReferralCode] = useState(customer.ReferralCode ?? '');
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const [sourceChanged, setSourceChanged] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');

  const missingBirthDate = !customer.BirthDate;
  const missingAddress   = !customer.Address;
  const missingSource    = isCustomerSourceMissing(customer.CameFrom);

  async function handleSave() {
    setSaving(true);
    setError('');
    setSourceErrors({});
    try {
      const payload: Record<string, string | null> = {};

      if (isEditMode) {
        // In edit mode, update all fields that are provided
        payload.name      = name.trim() || null;
        payload.birthDate = birthDate || null;
        payload.address   = address.trim() || null;
        payload.mobile    = mobile.trim() || null;
        payload.notes     = notes.trim() || null;
      } else {
        // In complete mode, only update missing fields
        if (missingBirthDate && birthDate)         payload.birthDate = birthDate;
        if (missingAddress   && address.trim())    payload.address   = address.trim();
      }

      // Only send source fields when the user has changed them or the source is currently missing
      const shouldSendSource =
        sourceChanged ||
        (missingSource && !isCustomerSourceMissing(cameFrom));

      if (shouldSendSource) {
        const sourceValidation = validateCustomerSource(
          cameFrom,
          cameFromDetails,
          referralCode
        );
        if (Object.keys(sourceValidation.errors).length > 0) {
          setSourceErrors(sourceValidation.errors);
          setSaving(false);
          return;
        }
        payload.cameFrom = sourceValidation.cameFrom;
        payload.cameFromDetails = sourceValidation.cameFromDetails;
        payload.referralCode = sourceValidation.referralCode;
      }

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
            {isEditMode ? (
              <>
                <Pencil className="w-5 h-5 text-info" />
                تعديل بيانات العميل
              </>
            ) : (
              <>
                <UserCog className="w-5 h-5 text-warning" />
                تكملة بيانات العميل
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1" dir="rtl">
          {/* Customer name - editable in edit mode, readonly otherwise */}
          {isEditMode ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-info" />
                اسم العميل
              </label>
              <Input
                placeholder="اسم العميل..."
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border">
              <CheckCircle className="w-4 h-4 text-success shrink-0" />
              <span className="text-sm font-medium">{customer.Name}</span>
            </div>
          )}

          {/* Fields */}
          <div className="space-y-3">
            {/* Birth Date - shown in edit mode OR if missing in complete mode */}
            {(isEditMode || missingBirthDate) && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Cake className="w-3.5 h-3.5 text-warning" />
                  تاريخ الميلاد
                  {!isEditMode && missingBirthDate && (
                    <span className="text-[10px] text-warning bg-warning/10 px-1.5 py-0.5 rounded-full border border-warning/20">ناقص</span>
                  )}
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

            {/* Address - shown in edit mode OR if missing in complete mode */}
            {(isEditMode || missingAddress) && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-warning" />
                  العنوان
                  {!isEditMode && missingAddress && (
                    <span className="text-[10px] text-warning bg-warning/10 px-1.5 py-0.5 rounded-full border border-warning/20">ناقص</span>
                  )}
                </label>
                <Input
                  placeholder="عنوان العميل..."
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
            )}

            {/* Mobile - edit mode only */}
            {isEditMode && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-info" />
                  رقم الهاتف
                </label>
                <Input
                  placeholder="رقم الهاتف..."
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  dir="ltr"
                  className="text-left"
                />
              </div>
            )}

            {/* Notes - edit mode only */}
            {isEditMode && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-info" />
                  ملاحظات
                </label>
                <Input
                  placeholder="ملاحظات..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Source selection */}
          {(isEditMode || missingSource) && (
            <CustomerSourceFields
              cameFrom={cameFrom}
              cameFromDetails={cameFromDetails}
              referralCode={referralCode}
              errors={sourceErrors}
              onChange={(payload) => {
                setCameFrom(payload.cameFrom);
                setCameFromDetails(payload.cameFromDetails);
                setReferralCode(payload.referralCode);
                setSourceErrors({});
                setSourceChanged(true);
              }}
            />
          )}

          {/* Legacy source display — when the customer has an unknown non-empty value */}
          {!isEditMode && !missingSource && !isKnownCustomerSource(customer.CameFrom) && (
            <div className="px-3 py-2 rounded-lg border border-border bg-muted/40 text-sm" dir="rtl">
              <span className="text-muted-foreground">مصدر مسجل قديم:</span>{' '}
              <span className="font-medium">{customer.CameFrom}</span>
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
              className={isEditMode
                ? "bg-primary hover:bg-primary-hover gap-2"
                : "bg-primary hover:bg-primary-hover gap-2"
              }
            >
              {saving ? 'جاري الحفظ...' : (isEditMode ? 'حفظ التعديلات' : 'حفظ البيانات')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
