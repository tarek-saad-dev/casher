'use client';

import { useEffect, useState } from 'react';
import { X, Gift, Tag, Percent, Star, Package, Zap, Clock, CheckCircle, AlertTriangle } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────
interface VoucherItem {
  inventoryId: number;
  voucherCode: string;
  purchasedAt: string;
  expiresAt: string | null;
  daysUntilExpiry: number | null;
  isExpiringSoon: boolean;
  canUse: boolean;
  purchasePriceCoins: number;
  item: {
    itemId: number;
    nameAr: string;
    nameEn: string;
    itemType: string;
    value: number | null;
    serviceId: number | null;
  };
}

interface ClientVouchersModalProps {
  clientId: number;
  clientName: string;
  open: boolean;
  onClose: () => void;
  onUseVoucher?: (inventoryId: number, itemType: string, value: number | null, nameAr: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function itemTypeIcon(type: string) {
  switch (type) {
    case 'DISCOUNT_AMOUNT':  return <Tag className="w-4 h-4" />;
    case 'DISCOUNT_PERCENT': return <Percent className="w-4 h-4" />;
    case 'FREE_SERVICE':     return <Star className="w-4 h-4" />;
    case 'FREE_PRODUCT':     return <Package className="w-4 h-4" />;
    case 'BONUS_POINTS':     return <Zap className="w-4 h-4" />;
    case 'DOUBLE_POINTS':    return <Zap className="w-4 h-4" />;
    case 'MYSTERY_BOX':      return <Gift className="w-4 h-4" />;
    default:                  return <Gift className="w-4 h-4" />;
  }
}

function itemTypeBadge(type: string, value: number | null): string {
  switch (type) {
    case 'DISCOUNT_AMOUNT':  return `خصم ${value} جنيه`;
    case 'DISCOUNT_PERCENT': return `خصم ${value}%`;
    case 'FREE_SERVICE':     return 'خدمة مجانية';
    case 'FREE_PRODUCT':     return 'منتج مجاني';
    case 'BONUS_POINTS':     return `${value} نقطة إضافية`;
    case 'DOUBLE_POINTS':    return 'نقاط مضاعفة';
    case 'MYSTERY_BOX':      return 'صندوق مفاجآت';
    default:                  return type;
  }
}

function itemTypeColor(type: string): string {
  switch (type) {
    case 'DISCOUNT_AMOUNT':
    case 'DISCOUNT_PERCENT': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    case 'FREE_SERVICE':     return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
    case 'FREE_PRODUCT':     return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
    case 'BONUS_POINTS':
    case 'DOUBLE_POINTS':    return 'text-purple-400 bg-purple-500/10 border-purple-500/20';
    default:                  return 'text-muted-foreground bg-muted-foreground/10 border-muted-foreground/20';
  }
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function ClientVouchersModal({
  clientId,
  clientName,
  open,
  onClose,
  onUseVoucher,
}: ClientVouchersModalProps) {
  const [vouchers, setVouchers] = useState<VoucherItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [usingId, setUsingId] = useState<number | null>(null);
  const [usedIds, setUsedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open || !clientId) return;
    setLoading(true);
    setUsedIds(new Set());

    fetch(`/api/pos/client-inventory?clientId=${clientId}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          // Only show items that make sense to apply at POS
          const posItems = (data.activeItems as VoucherItem[]).filter(v =>
            ['DISCOUNT_AMOUNT', 'DISCOUNT_PERCENT', 'FREE_SERVICE', 'FREE_PRODUCT',
              'BONUS_POINTS', 'DOUBLE_POINTS'].includes(v.item.itemType)
          );
          setVouchers(posItems);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, clientId]);

  const handleUse = async (v: VoucherItem) => {
    setUsingId(v.inventoryId);
    try {
      const res = await fetch('/api/pos/client-inventory/use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventoryId: v.inventoryId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        console.error('[ClientVouchersModal] use failed:', data.error);
        return;
      }
      // Mark as used locally — removes it from active list
      setUsedIds(prev => new Set(prev).add(v.inventoryId));
      // Notify parent to apply discount / effect on invoice
      if (onUseVoucher) {
        onUseVoucher(v.inventoryId, v.item.itemType, v.item.value, v.item.nameAr);
      }
    } finally {
      setUsingId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" dir="rtl">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md mx-4 bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Gift className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">مكافآت النقاط</p>
              <p className="text-xs text-muted-foreground">{clientName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-surface-muted hover:bg-surface-muted/80 flex items-center justify-center transition-colors"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 max-h-[70vh] overflow-y-auto space-y-2.5">
          {loading ? (
            <div className="flex flex-col gap-2.5">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 rounded-xl bg-muted/60 animate-pulse" />
              ))}
            </div>
          ) : vouchers.length === 0 ? (
            <div className="py-10 text-center">
              <Gift className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">لا توجد مكافآت نشطة لهذا العميل</p>
            </div>
          ) : (
            vouchers.map(v => {
              const used = usedIds.has(v.inventoryId);
              return (
                <div
                  key={v.inventoryId}
                  className={`rounded-xl border p-3.5 transition-all ${
                    used
                      ? 'bg-surface-muted/30 border-border/30 opacity-50'
                      : 'bg-surface-muted/50 border-border/40 hover:border-border/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* Left: info */}
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`mt-0.5 w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${itemTypeColor(v.item.itemType)}`}>
                        {itemTypeIcon(v.item.itemType)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{v.item.nameAr}</p>
                        <p className={`text-xs font-semibold mt-0.5 ${itemTypeColor(v.item.itemType).split(' ')[0]}`}>
                          {itemTypeBadge(v.item.itemType, v.item.value)}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <code className="text-[10px] text-muted-foreground/70 bg-surface-muted px-1.5 py-0.5 rounded font-mono">
                            {v.voucherCode}
                          </code>
                          {v.expiresAt && (
                            <span className={`text-[10px] flex items-center gap-1 ${
                              v.isExpiringSoon ? 'text-warning' : 'text-muted-foreground'
                            }`}>
                              <Clock className="w-2.5 h-2.5" />
                              {v.daysUntilExpiry !== null ? `${v.daysUntilExpiry} يوم` : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: action */}
                    {used ? (
                      <div className="flex items-center gap-1 text-success text-xs shrink-0 mt-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>تم</span>
                      </div>
                    ) : onUseVoucher ? (
                      <button
                        onClick={() => handleUse(v)}
                        disabled={usingId === v.inventoryId}
                        className="shrink-0 mt-1 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-bold transition-colors disabled:opacity-50"
                      >
                        تطبيق
                      </button>
                    ) : null}
                  </div>

                  {/* Expiry warning */}
                  {v.isExpiringSoon && !used && (
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-warning bg-warning/10 rounded-lg px-2.5 py-1.5">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      ينتهي خلال {v.daysUntilExpiry} يوم — استخدمه الآن
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {vouchers.length > 0 && (
          <div className="px-5 py-3 border-t border-border flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {vouchers.filter(v => !usedIds.has(v.inventoryId)).length} مكافأة متاحة
            </p>
            <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              إغلاق
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
