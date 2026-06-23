'use client';

import { CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  CUSTOMER_SOURCE_OPTIONS,
  type CustomerSource,
} from '@/lib/customerSource';

interface CustomerSourceFieldsProps {
  cameFrom: string | null;
  cameFromDetails: string;
  referralCode: string;
  errors?: Record<string, string>;
  onChange: (payload: {
    cameFrom: CustomerSource | null;
    cameFromDetails: string;
    referralCode: string;
  }) => void;
}

export default function CustomerSourceFields({
  cameFrom,
  cameFromDetails,
  referralCode,
  errors = {},
  onChange,
}: CustomerSourceFieldsProps) {
  function handleSelect(value: CustomerSource) {
    // Clear irrelevant detail fields when switching source
    onChange({
      cameFrom: value,
      cameFromDetails: value === 'word_of_mouth' ? cameFromDetails : '',
      referralCode: value === 'referral_code' ? referralCode : '',
    });
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="space-y-2">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          عرفنا منين؟
        </label>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CUSTOMER_SOURCE_OPTIONS.map((option) => {
            const selected = cameFrom === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelect(option.value)}
                className={`
                  relative flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg
                  border text-xs font-medium transition-all text-center
                  ${
                    selected
                      ? 'border-primary/60 bg-primary/15 text-primary'
                      : 'border-border bg-card hover:bg-accent/50 text-muted-foreground'
                  }
                `}
              >
                {selected && (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-primary" />
                )}
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>

        {errors.cameFrom && (
          <p className="text-xs text-destructive">{errors.cameFrom}</p>
        )}
      </div>

      {/* word_of_mouth details */}
      {cameFrom === 'word_of_mouth' && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">مين اللي قاله عنّا؟</label>
          <Input
            placeholder="اكتب اسم الشخص اللي رشّح العميل"
            value={cameFromDetails}
            onChange={(e) =>
              onChange({
                cameFrom,
                cameFromDetails: e.target.value,
                referralCode: '',
              })
            }
          />
          {errors.cameFromDetails && (
            <p className="text-xs text-destructive">{errors.cameFromDetails}</p>
          )}
        </div>
      )}

      {/* referral_code details */}
      {cameFrom === 'referral_code' && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">كود الإحالة</label>
          <Input
            placeholder="اكتب كود الإحالة"
            value={referralCode}
            onChange={(e) =>
              onChange({
                cameFrom,
                cameFromDetails: '',
                referralCode: e.target.value,
              })
            }
            dir="ltr"
            className="text-left"
          />
          {errors.referralCode && (
            <p className="text-xs text-destructive">{errors.referralCode}</p>
          )}
        </div>
      )}
    </div>
  );
}
