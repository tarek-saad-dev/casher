'use client';

import { useMemo, useState, useDeferredValue } from 'react';
import { Plus, Search, X, Package, PackageX } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CartItem } from '@/lib/types';

export type ProductStockStatus = 'ok' | 'low' | 'out';

export interface CatalogProduct {
  ProID: number;
  ProName: string;
  ProNameAr?: string | null;
  ProductCode?: string | null;
  Barcode?: string | null;
  SPrice1: number;
  ImageUrl?: string | null;
  qtyOnHand: number;
  stockStatus: ProductStockStatus;
}

interface ProductCatalogProps {
  products: CatalogProduct[];
  onAddItem: (item: CartItem) => void;
  /** Optional toast hook — used to explain why an add was blocked. */
  onToast?: (type: 'success' | 'error' | 'info', message: string) => void;
  loading?: boolean;
}

const FALLBACK_IMAGE = '/services/basic.jpeg';
const RETAIL_EMP_NAME = 'بيع تجزئة';
/** Module-level so ids stay unique even if the component remounts while the cart persists. */
let retailLineSeq = 0;
function nextRetailLineId(proId: number): string {
  retailLineSeq += 1;
  return `retail-${proId}-${retailLineSeq}`;
}

const STATUS_META: Record<ProductStockStatus, { label: string; className: string }> = {
  ok: { label: 'متوفر', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' },
  low: { label: 'كمية منخفضة', className: 'border-amber-500/40 bg-amber-500/10 text-amber-400' },
  out: { label: 'نفد المخزون', className: 'border-rose-500/40 bg-rose-500/10 text-rose-400' },
};

function normalize(value: string | null | undefined): string {
  return (value ?? '').toString().trim().toLowerCase();
}

function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
}

export default function ProductCatalog({ products, onAddItem, onToast, loading }: ProductCatalogProps) {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = normalize(deferredQuery);
    if (!q) return products;
    return products.filter((p) =>
      normalize(p.ProductCode).includes(q) ||
      normalize(p.Barcode).includes(q) ||
      normalize(p.ProName).includes(q) ||
      normalize(p.ProNameAr).includes(q),
    );
  }, [products, deferredQuery]);

  const handleAdd = (p: CatalogProduct) => {
    if (p.stockStatus === 'out') {
      onToast?.('error', `المنتج "${p.ProNameAr || p.ProName}" غير متوفر في مخزون الفرع`);
      return;
    }
    const price = Number(p.SPrice1) || 0;
    const item: CartItem = {
      id: nextRetailLineId(p.ProID),
      ProID: p.ProID,
      ProName: p.ProNameAr || p.ProName,
      // Retail sale: no barber. EmpID 0 is the "no staff" sentinel.
      EmpID: 0,
      EmpName: RETAIL_EMP_NAME,
      SPrice: price,
      Bonus: 0,
      Qty: 1,
      Dis: 0,
      DisVal: 0,
      SPriceAfterDis: price,
    };
    onAddItem(item);
  };

  const isSearchActive = query.trim().length > 0;

  return (
    <div className="w-full" dir="rtl" data-testid="pos-product-catalog">
      <div className="mb-4 flex flex-col gap-3">
        <h3 className="text-lg font-bold text-foreground">اختر المنتج</h3>
        <div className="relative w-full min-[480px]:w-[min(100%,480px)]">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالاسم أو الكود أو الباركود..."
            aria-label="بحث في المنتجات"
            className="h-10 w-full rounded-xl border border-border bg-surface pe-10 ps-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
          />
          {isSearchActive && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="مسح البحث"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {loading && products.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">جاري تحميل المنتجات...</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-center text-muted-foreground">
          <Package className="mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">
            {isSearchActive ? 'لم نجد منتجًا مطابقًا' : 'لا توجد منتجات متاحة للبيع في هذا الفرع'}
          </p>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5 sm:gap-3">
          {filtered.map((p) => {
            const isOut = p.stockStatus === 'out';
            const status = STATUS_META[p.stockStatus];
            return (
              <div
                key={p.ProID}
                className={cn(
                  'group relative overflow-hidden rounded-xl border border-border bg-surface transition-all duration-300',
                  isOut
                    ? 'opacity-60'
                    : 'hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10',
                )}
              >
                <div className="relative h-20 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.ImageUrl || FALLBACK_IMAGE}
                    alt={p.ProNameAr || p.ProName}
                    loading="lazy"
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (!img.src.endsWith(FALLBACK_IMAGE)) img.src = FALLBACK_IMAGE;
                    }}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--surface)] via-transparent to-transparent" />
                  <span
                    className={cn(
                      'absolute right-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm',
                      status.className,
                    )}
                  >
                    {status.label}
                  </span>
                </div>

                <div className="p-2.5">
                  <h4 className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-foreground">
                    {p.ProNameAr || p.ProName}
                  </h4>
                  {p.ProductCode && (
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground" dir="ltr">
                      {p.ProductCode}
                    </p>
                  )}

                  <div className="mb-2 mt-1.5 flex items-center justify-between gap-1">
                    <span className="text-base font-bold text-primary">
                      {Number(p.SPrice1) || 0} <span className="text-xs">ج.م</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      المتاح: <span className="font-semibold text-foreground">{formatQty(p.qtyOnHand)}</span>
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleAdd(p)}
                    aria-disabled={isOut}
                    className={cn(
                      'flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all',
                      isOut
                        ? 'cursor-not-allowed bg-surface-muted text-muted-foreground/60'
                        : 'border border-primary/30 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground active:scale-95',
                    )}
                  >
                    {isOut ? <PackageX className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    {isOut ? 'غير متوفر' : 'إضافة'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
