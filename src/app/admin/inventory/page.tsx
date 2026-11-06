'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes, Loader2, Search, X, Check, SlidersHorizontal, ClipboardCheck, ArrowLeftRight,
  ShieldCheck, ShoppingCart, Plus, Trash2, RefreshCw, AlertTriangle, PackageX, TrendingUp, Wallet,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

// ── Types ────────────────────────────────────────────────────────────────────

type StockStatus = 'ok' | 'low' | 'out';

interface StockItem {
  productId: number;
  name: string;
  productCode: string | null;
  barcode: string | null;
  imageUrl: string | null;
  basePrice: number | null;
  sellingPrice: number | null;
  brand: string | null;
  stockUnit: string | null;
  catName: string | null;
  stockStatus: StockStatus;
  inventory: { branchId: number; qtyOnHand: number; reorderLevel: number | null; lastMovementAt: string | null };
}

interface StockPolicy {
  allowNegativeStock: boolean;
  openingStockRegistered: boolean;
  negativeBalancesReconciled: boolean;
  strictModeActivatedAt: string | null;
  notes: string | null;
}

interface NegativeBalance { branchId: number; branchName: string; proId: number; productName: string; qtyOnHand: number }

interface Dashboard {
  branchName: string | null;
  branchCode: string | null;
  policy: StockPolicy | null;
  kpis: {
    activeProducts: number; unitsAvailable: number; unitsAvailableCompany: number;
    inventoryValueAtCost: number; inventoryValueAtCostCompany: number;
    lowStock: number; outOfStock: number; productSalesThisMonth: number; productGrossProfitThisMonth: number;
  };
}

interface Transfer {
  transferId: number; fromBranchId: number; fromBranchName: string | null;
  toBranchId: number; toBranchName: string | null; status: string; notes: string | null;
  createdAt: string; postedAt: string | null; receivedAt: string | null;
}

interface Branch { branchId: number; branchName: string; branchCode: string; isActive: boolean }

interface PurchaseRow { invID: number; invDate: string; GrandTotal: number; PostStatus: string; Notes: string | null }

interface LineDraft { proId: string; qty: string; unitPrice: string }

type Tab = 'stock' | 'transfers' | 'policy' | 'purchases';

const STATUS_LABEL: Record<StockStatus, string> = { ok: 'متوفر', low: 'منخفض', out: 'نفد' };
const STATUS_BADGE: Record<StockStatus, string> = {
  ok: 'border-emerald-500/40 text-emerald-400',
  low: 'border-amber-500/40 text-amber-400',
  out: 'border-rose-500/40 text-rose-400',
};

const TRANSFER_STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'مسودة', cls: 'border-zinc-600 text-zinc-300' },
  IN_TRANSIT: { label: 'في الطريق', cls: 'border-amber-500/40 text-amber-400' },
  POSTED: { label: 'في الطريق', cls: 'border-amber-500/40 text-amber-400' },
  RECEIVED: { label: 'تم الاستلام', cls: 'border-emerald-500/40 text-emerald-400' },
  CANCELLED: { label: 'ملغي', cls: 'border-rose-500/40 text-rose-400' },
};

const money = (n: number | null | undefined) =>
  `${Number(n ?? 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

const emptyLine = (): LineDraft => ({ proId: '', qty: '', unitPrice: '' });

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminInventoryPage() {
  const [tab, setTab] = useState<Tab>('stock');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  const [stockLoading, setStockLoading] = useState(true);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3500);
  };

  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/inventory/dashboard', { cache: 'no-store' });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'تعذر تحميل المؤشرات');
      setDashboard(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل المؤشرات');
    }
  }, []);

  const loadStock = useCallback(async () => {
    setStockLoading(true);
    try {
      const res = await fetch('/api/inventory/branch', { cache: 'no-store' });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'تعذر تحميل المخزون');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل المخزون');
    } finally {
      setStockLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setError('');
    await Promise.all([loadDashboard(), loadStock()]);
  }, [loadDashboard, loadStock]);

  useEffect(() => { void refreshAll(); }, [refreshAll]);

  const kpis = dashboard?.kpis;

  const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
    { key: 'stock', label: 'أرصدة المخزون', icon: <Boxes className="w-4 h-4" /> },
    { key: 'transfers', label: 'التحويلات', icon: <ArrowLeftRight className="w-4 h-4" /> },
    { key: 'purchases', label: 'المشتريات', icon: <ShoppingCart className="w-4 h-4" /> },
    { key: 'policy', label: 'سياسة المخزون', icon: <ShieldCheck className="w-4 h-4" /> },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" dir="rtl">
      <PageHeader
        title="المخزون"
        description={
          dashboard?.branchName
            ? `مخزون منتجات التجزئة — فرع ${dashboard.branchName}`
            : 'مخزون منتجات التجزئة للفرع النشط'
        }
      >
        <Button variant="outline" className="gap-2 border-zinc-700" onClick={() => void refreshAll()}>
          <RefreshCw className="w-4 h-4" />
          تحديث
        </Button>
      </PageHeader>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard title="المنتجات المتتبَّعة" value={kpis?.activeProducts ?? '—'} icon={<Boxes className="w-4 h-4" />} />
        <KpiCard
          title="الوحدات المتاحة (الفرع)"
          value={kpis ? kpis.unitsAvailable.toLocaleString('ar-EG') : '—'}
          subtitle={kpis ? `إجمالي الشركة: ${kpis.unitsAvailableCompany.toLocaleString('ar-EG')}` : undefined}
          variant="info"
        />
        <KpiCard
          title="قيمة المخزون بالتكلفة"
          value={kpis ? money(kpis.inventoryValueAtCost) : '—'}
          subtitle={kpis ? `إجمالي الشركة: ${money(kpis.inventoryValueAtCostCompany)}` : undefined}
          icon={<Wallet className="w-4 h-4" />}
          variant="primary"
        />
        <KpiCard
          title="مبيعات المنتجات هذا الشهر"
          value={kpis ? money(kpis.productSalesThisMonth) : '—'}
          subtitle={kpis ? `إجمالي الربح: ${money(kpis.productGrossProfitThisMonth)}` : undefined}
          icon={<TrendingUp className="w-4 h-4" />}
          variant="success"
        />
        <KpiCard title="مخزون منخفض" value={kpis?.lowStock ?? '—'} icon={<AlertTriangle className="w-4 h-4" />} variant="warning" />
        <KpiCard title="نفد المخزون" value={kpis?.outOfStock ?? '—'} icon={<PackageX className="w-4 h-4" />} variant="danger" />
        <KpiCard
          title="الوضع الصارم"
          value={dashboard?.policy ? (dashboard.policy.allowNegativeStock ? 'غير مفعّل' : 'مفعّل') : '—'}
          subtitle={dashboard?.policy?.allowNegativeStock ? 'السماح بالرصيد السالب' : 'منع البيع عند نفاد الرصيد'}
          icon={<ShieldCheck className="w-4 h-4" />}
          variant={dashboard?.policy?.allowNegativeStock ? 'warning' : 'success'}
        />
      </div>

      {notice && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-sm">
          <Check className="w-4 h-4 shrink-0" />{notice}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-rose-500/30 bg-rose-500/5 text-rose-400 text-sm">
          <X className="w-4 h-4 shrink-0" />
          {error}
          <button type="button" onClick={() => setError('')} className="mr-auto opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              tab === t.key
                ? 'bg-amber-600/20 border-amber-500/50 text-amber-300'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === 'stock' && (
        <StockPanel
          items={items}
          loading={stockLoading}
          onChanged={async (msg) => { flash(msg); await refreshAll(); }}
        />
      )}
      {tab === 'transfers' && (
        <TransfersPanel
          items={items}
          onChanged={async (msg) => { flash(msg); await refreshAll(); }}
          onError={setError}
        />
      )}
      {tab === 'purchases' && (
        <PurchasesPanel
          items={items}
          onChanged={async (msg) => { flash(msg); await refreshAll(); }}
        />
      )}
      {tab === 'policy' && (
        <PolicyPanel
          onChanged={async (msg) => { flash(msg); await loadDashboard(); }}
        />
      )}
    </div>
  );
}

// ── Stock panel ──────────────────────────────────────────────────────────────

function StockPanel({
  items, loading, onChanged,
}: {
  items: StockItem[];
  loading: boolean;
  onChanged: (msg: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<{ mode: 'adjust' | 'count'; item: StockItem } | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');

  const counts = useMemo(() => ({
    all: items.length,
    low: items.filter((i) => i.stockStatus === 'low').length,
    out: items.filter((i) => i.stockStatus === 'out').length,
  }), [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (filter === 'low' && i.stockStatus !== 'low') return false;
      if (filter === 'out' && i.stockStatus !== 'out') return false;
      if (!q) return true;
      return [i.name, i.productCode, i.barcode, i.brand].some((f) => (f ?? '').toLowerCase().includes(q));
    });
  }, [items, filter, search]);

  const open = (mode: 'adjust' | 'count', item: StockItem) => {
    setDialog({ mode, item });
    setValue('');
    setReason('');
    setDialogError('');
  };

  const submit = async () => {
    if (!dialog) return;
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n)) return setDialogError('أدخل رقمًا صحيحًا');
    if (dialog.mode === 'adjust' && n === 0) return setDialogError('قيمة التعديل يجب ألا تساوي صفرًا');
    if (dialog.mode === 'count' && n < 0) return setDialogError('الكمية المعدودة لا يمكن أن تكون سالبة');
    if (!reason.trim()) return setDialogError('السبب مطلوب');

    setBusy(true);
    setDialogError('');
    try {
      // Never send BranchID — the server resolves the active branch from the session.
      const body = dialog.mode === 'adjust'
        ? { proId: dialog.item.productId, quantityDelta: n, reason: reason.trim() }
        : { proId: dialog.item.productId, setCountedTo: n, reason: reason.trim() };
      const res = await fetch('/api/inventory/branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'فشل تنفيذ العملية');
      setDialog(null);
      await onChanged(dialog.mode === 'adjust' ? 'تم تعديل الرصيد' : 'تم تسجيل الجرد');
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : 'فشل تنفيذ العملية');
    } finally {
      setBusy(false);
    }
  };

  const current = dialog?.item.inventory.qtyOnHand ?? 0;
  const preview = dialog && value.trim() !== '' && Number.isFinite(Number(value))
    ? dialog.mode === 'adjust' ? current + Number(value) : Number(value)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو الكود أو الباركود..."
            className="bg-zinc-900 border-zinc-700 text-white pr-9"
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          {(['all', 'low', 'out'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg border transition-colors font-medium ${
                filter === f
                  ? f === 'out'
                    ? 'bg-rose-600/20 border-rose-500/40 text-rose-300'
                    : f === 'low'
                      ? 'bg-amber-600/20 border-amber-500/40 text-amber-300'
                      : 'bg-zinc-700/60 border-zinc-600 text-zinc-200'
                  : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'
              }`}
            >
              {f === 'all' ? 'الكل' : f === 'low' ? 'منخفض' : 'نفد'} ({counts[f]})
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500 gap-3">
          <Loader2 className="w-6 h-6 animate-spin" />جاري التحميل...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
          <Boxes className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">لا توجد منتجات مطابقة</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-right text-zinc-400">المنتج</TableHead>
                <TableHead className="text-right text-zinc-400">الكود</TableHead>
                <TableHead className="text-right text-zinc-400">الكمية</TableHead>
                <TableHead className="text-right text-zinc-400">حد إعادة الطلب</TableHead>
                <TableHead className="text-right text-zinc-400">القيمة بالتكلفة</TableHead>
                <TableHead className="text-right text-zinc-400">الحالة</TableHead>
                <TableHead className="text-right text-zinc-400">آخر حركة</TableHead>
                <TableHead className="text-right text-zinc-400 w-44">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((i) => (
                <TableRow key={i.productId} className="border-zinc-800">
                  <TableCell>
                    <div className="text-sm font-medium text-white">{i.name}</div>
                    {i.brand && <div className="text-[11px] text-zinc-500">{i.brand}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-zinc-300" dir="ltr">
                    <span className="block text-right">{i.productCode ?? '—'}</span>
                  </TableCell>
                  <TableCell className={`text-sm font-bold ${i.inventory.qtyOnHand <= 0 ? 'text-rose-400' : 'text-white'}`}>
                    {i.inventory.qtyOnHand}
                    {i.stockUnit && <span className="text-[10px] font-normal text-zinc-500 mr-1">{i.stockUnit}</span>}
                  </TableCell>
                  <TableCell className="text-sm text-zinc-400">{i.inventory.reorderLevel ?? '—'}</TableCell>
                  <TableCell className="text-sm text-zinc-400">
                    {money(i.inventory.qtyOnHand * Number(i.basePrice ?? 0))}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE[i.stockStatus]}`}>
                      {STATUS_LABEL[i.stockStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500">{formatDate(i.inventory.lastMovementAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-zinc-400 hover:text-amber-400"
                        onClick={() => open('adjust', i)}>
                        <SlidersHorizontal className="w-3.5 h-3.5" />تسوية
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-zinc-400 hover:text-sky-400"
                        onClick={() => open('count', i)}>
                        <ClipboardCheck className="w-3.5 h-3.5" />جرد
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={dialog != null} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>{dialog?.mode === 'adjust' ? 'تسوية يدوية للرصيد' : 'جرد فعلي'}</DialogTitle>
          </DialogHeader>
          {dialog && (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
                <div className="font-medium">{dialog.item.name}</div>
                <div className="text-xs text-zinc-500 mt-0.5">الرصيد الحالي: <span className="text-white font-semibold">{current}</span></div>
              </div>
              <div>
                <Label className="text-zinc-300">
                  {dialog.mode === 'adjust' ? 'التغيير في الكمية (+ زيادة / − نقص) *' : 'الكمية المعدودة فعليًا *'}
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => { setValue(e.target.value); setDialogError(''); }}
                  className="bg-zinc-800 border-zinc-700 text-white mt-1"
                  placeholder={dialog.mode === 'adjust' ? 'مثال: -2 أو 5' : 'مثال: 12'}
                  autoFocus
                />
                {preview != null && (
                  <p className="text-xs text-zinc-500 mt-1">
                    الرصيد بعد التنفيذ: <span className={preview < 0 ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold'}>{preview}</span>
                  </p>
                )}
              </div>
              <div>
                <Label className="text-zinc-300">السبب *</Label>
                <Input
                  value={reason}
                  onChange={(e) => { setReason(e.target.value); setDialogError(''); }}
                  className="bg-zinc-800 border-zinc-700 text-white mt-1"
                  placeholder={dialog.mode === 'adjust' ? 'مثال: تالف، هدية، تصحيح خطأ' : 'مثال: جرد نهاية الشهر'}
                />
              </div>
              {dialogError && (
                <p className="text-sm text-rose-400 flex items-center gap-1"><X className="w-3.5 h-3.5" />{dialogError}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" className="border-zinc-700" onClick={() => setDialog(null)} disabled={busy}>إلغاء</Button>
                <Button className="bg-amber-600 hover:bg-amber-700" onClick={submit} disabled={busy}>
                  {busy ? <><Loader2 className="w-4 h-4 animate-spin ml-1" />جاري التنفيذ...</> : <><Check className="w-4 h-4 ml-1" />تنفيذ</>}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Shared line editor (transfers + purchases) ───────────────────────────────

function LineEditor({
  items, lines, onChange, withPrice,
}: {
  items: StockItem[];
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  withPrice?: boolean;
}) {
  const update = (idx: number, patch: Partial<LineDraft>) =>
    onChange(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-2">
      {lines.map((l, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <Select
            value={l.proId || undefined}
            onValueChange={(v) => {
              const prod = items.find((p) => String(p.productId) === v);
              update(idx, {
                proId: v,
                ...(withPrice && !l.unitPrice && prod?.basePrice ? { unitPrice: String(prod.basePrice) } : {}),
              });
            }}
          >
            <SelectTrigger className="flex-1 bg-zinc-800 border-zinc-700 text-white"><SelectValue placeholder="اختر المنتج" /></SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700 max-h-64">
              {items.map((p) => (
                <SelectItem key={p.productId} value={String(p.productId)}>
                  {p.name}{p.productCode ? ` — ${p.productCode}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number" min="0" step="0.01" inputMode="decimal" placeholder="الكمية"
            value={l.qty} onChange={(e) => update(idx, { qty: e.target.value })}
            className="w-24 bg-zinc-800 border-zinc-700 text-white"
          />
          {withPrice && (
            <Input
              type="number" min="0" step="0.01" inputMode="decimal" placeholder="سعر الوحدة"
              value={l.unitPrice} onChange={(e) => update(idx, { unitPrice: e.target.value })}
              className="w-28 bg-zinc-800 border-zinc-700 text-white"
            />
          )}
          <Button
            type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-zinc-500 hover:text-rose-400"
            onClick={() => onChange(lines.length > 1 ? lines.filter((_, i) => i !== idx) : [emptyLine()])}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="border-zinc-700 gap-1.5"
        onClick={() => onChange([...lines, emptyLine()])}>
        <Plus className="w-4 h-4" />إضافة بند
      </Button>
    </div>
  );
}

function validLines(lines: LineDraft[], withPrice: boolean) {
  const out: Array<{ proId: number; quantity: number; qty: number; unitPrice: number }> = [];
  for (const l of lines) {
    if (!l.proId && !l.qty) continue; // ignore fully-empty rows
    const proId = Number(l.proId);
    const qty = Number(l.qty);
    const unitPrice = withPrice ? Number(l.unitPrice) : 0;
    if (!proId || !Number.isFinite(qty) || qty <= 0) return null;
    if (withPrice && (!Number.isFinite(unitPrice) || unitPrice < 0)) return null;
    out.push({ proId, quantity: qty, qty, unitPrice });
  }
  return out.length ? out : null;
}

// ── Transfers panel ──────────────────────────────────────────────────────────

function TransfersPanel({
  items, onChanged, onError,
}: {
  items: StockItem[];
  onChanged: (msg: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<number | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [toBranch, setToBranch] = useState('');
  const [notes, setNotes] = useState('');
  const [sendNow, setSendNow] = useState(true);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [idemKey, setIdemKey] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, bRes] = await Promise.all([
        fetch('/api/inventory/transfers', { cache: 'no-store' }),
        fetch('/api/admin/branches', { cache: 'no-store' }),
      ]);
      const t = await readJson(tRes);
      if (!tRes.ok) throw new Error(t.error || 'تعذر تحميل التحويلات');
      setTransfers(Array.isArray(t.transfers) ? t.transfers : []);
      setBranchId(t.branchId ?? null);
      const b = await readJson(bRes);
      if (bRes.ok && Array.isArray(b.branches)) setBranches(b.branches);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'تعذر تحميل التحويلات');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const destinations = branches.filter((b) => b.isActive && b.branchId !== branchId);

  const openCreate = () => {
    setToBranch('');
    setNotes('');
    setSendNow(true);
    setLines([emptyLine()]);
    setIdemKey(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `tr-${Date.now()}`);
    setFormError('');
    setCreateOpen(true);
  };

  const create = async () => {
    if (!toBranch) return setFormError('اختر الفرع المستلم');
    const valid = validLines(lines, false);
    if (!valid) return setFormError('أضف بندًا واحدًا على الأقل بكمية صحيحة');
    setCreating(true);
    setFormError('');
    try {
      // fromBranch is the session's active branch (server-enforced) — not sent.
      const res = await fetch('/api/inventory/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          toBranchId: Number(toBranch),
          notes: notes.trim() || null,
          post: sendNow,
          idempotencyKey: idemKey,
          lines: valid.map((l) => ({ proId: l.proId, quantity: l.quantity })),
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'فشل إنشاء التحويل');
      setCreateOpen(false);
      await load();
      await onChanged(sendNow ? 'تم إرسال التحويل' : 'تم حفظ التحويل كمسودة');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'فشل إنشاء التحويل');
    } finally {
      setCreating(false);
    }
  };

  const act = async (t: Transfer, action: 'post' | 'receive' | 'cancel') => {
    const msg = {
      post: `سيتم خصم الكميات من مخزون هذا الفرع وإرسالها إلى ${t.toBranchName ?? 'الفرع المستلم'}. متابعة؟`,
      receive: 'سيتم إضافة الكميات إلى مخزون هذا الفرع. متابعة؟',
      cancel: 'سيتم إلغاء مسودة التحويل. متابعة؟',
    }[action];
    if (!confirm(msg)) return;
    setActionBusy(t.transferId);
    try {
      const res = await fetch('/api/inventory/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, transferId: t.transferId }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'فشل تنفيذ الإجراء');
      await load();
      await onChanged(action === 'post' ? 'تم إرسال التحويل' : action === 'receive' ? 'تم استلام التحويل' : 'تم إلغاء التحويل');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'فشل تنفيذ الإجراء');
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">تحويلات المخزون الصادرة من والواردة إلى الفرع النشط.</p>
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700" onClick={openCreate}>
          <Plus className="w-4 h-4" />تحويل جديد
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500 gap-3">
          <Loader2 className="w-5 h-5 animate-spin" />جاري التحميل...
        </div>
      ) : transfers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
          <ArrowLeftRight className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">لا توجد تحويلات بعد</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-right text-zinc-400">#</TableHead>
                <TableHead className="text-right text-zinc-400">من</TableHead>
                <TableHead className="text-right text-zinc-400">إلى</TableHead>
                <TableHead className="text-right text-zinc-400">الحالة</TableHead>
                <TableHead className="text-right text-zinc-400">التاريخ</TableHead>
                <TableHead className="text-right text-zinc-400">ملاحظات</TableHead>
                <TableHead className="text-right text-zinc-400 w-44">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.map((t) => {
                const st = TRANSFER_STATUS[t.status] ?? { label: t.status, cls: 'border-zinc-600 text-zinc-300' };
                const canPost = t.status === 'DRAFT' && t.fromBranchId === branchId;
                const canCancel = canPost;
                const canReceive = (t.status === 'IN_TRANSIT' || t.status === 'POSTED') && t.toBranchId === branchId;
                return (
                  <TableRow key={t.transferId} className="border-zinc-800">
                    <TableCell className="text-sm text-zinc-300">#{t.transferId}</TableCell>
                    <TableCell className="text-sm">{t.fromBranchName ?? t.fromBranchId}</TableCell>
                    <TableCell className="text-sm">{t.toBranchName ?? t.toBranchId}</TableCell>
                    <TableCell><Badge variant="outline" className={`text-[10px] ${st.cls}`}>{st.label}</Badge></TableCell>
                    <TableCell className="text-xs text-zinc-500">{formatDate(t.receivedAt ?? t.postedAt ?? t.createdAt)}</TableCell>
                    <TableCell className="text-xs text-zinc-400 max-w-48 truncate">{t.notes ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {actionBusy === t.transferId && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
                        {canPost && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-amber-400 hover:bg-amber-400/10"
                            disabled={actionBusy === t.transferId} onClick={() => act(t, 'post')}>إرسال</Button>
                        )}
                        {canReceive && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-emerald-400 hover:bg-emerald-400/10"
                            disabled={actionBusy === t.transferId} onClick={() => act(t, 'receive')}>استلام</Button>
                        )}
                        {canCancel && (
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-rose-400 hover:bg-rose-400/10"
                            disabled={actionBusy === t.transferId} onClick={() => act(t, 'cancel')}>إلغاء</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader><DialogTitle>تحويل مخزون جديد</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-zinc-300">الفرع المستلم *</Label>
              <Select value={toBranch || undefined} onValueChange={(v) => { setToBranch(v); setFormError(''); }}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white mt-1"><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {destinations.map((b) => (
                    <SelectItem key={b.branchId} value={String(b.branchId)}>{b.branchName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {destinations.length === 0 && (
                <p className="text-xs text-amber-400 mt-1">لا توجد فروع أخرى متاحة للتحويل.</p>
              )}
            </div>
            <div>
              <Label className="text-zinc-300">البنود *</Label>
              <div className="mt-1">
                <LineEditor items={items} lines={lines} onChange={(l) => { setLines(l); setFormError(''); }} />
              </div>
            </div>
            <div>
              <Label className="text-zinc-300">ملاحظات</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-zinc-800 border-zinc-700 text-white mt-1" />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input type="checkbox" className="accent-amber-500 w-4 h-4" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
              إرسال فورًا (خصم الكميات من مخزون هذا الفرع)
            </label>
            {formError && <p className="text-sm text-rose-400 flex items-center gap-1"><X className="w-3.5 h-3.5" />{formError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" className="border-zinc-700" onClick={() => setCreateOpen(false)} disabled={creating}>إلغاء</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={create} disabled={creating}>
                {creating ? <><Loader2 className="w-4 h-4 animate-spin ml-1" />جاري الحفظ...</> : <><Check className="w-4 h-4 ml-1" />{sendNow ? 'إرسال التحويل' : 'حفظ كمسودة'}</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Purchases panel ──────────────────────────────────────────────────────────

function PurchasesPanel({
  items, onChanged,
}: {
  items: StockItem[];
  onChanged: (msg: string) => Promise<void>;
}) {
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [notes, setNotes] = useState('');
  const [post, setPost] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [listError, setListError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const res = await fetch('/api/purchases', { cache: 'no-store' });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'تعذر تحميل المشتريات');
      setPurchases(Array.isArray(data.purchases) ? data.purchases : []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'تعذر تحميل المشتريات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);

  const openCreate = () => {
    setLines([emptyLine()]);
    setNotes('');
    setPost(true);
    setFormError('');
    setCreateOpen(true);
  };

  const submit = async () => {
    if (busy) return;
    const valid = validLines(lines, true);
    if (!valid) return setFormError('أضف بندًا واحدًا على الأقل بكمية وسعر صحيحين');
    setBusy(true);
    setFormError('');
    try {
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: valid.map((l) => ({ proId: l.proId, qty: l.qty, unitPrice: l.unitPrice })),
          notes: notes.trim() || 'مشتريات',
          post,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'فشل تسجيل المشتريات');
      setCreateOpen(false);
      await load();
      await onChanged(post ? 'تم تسجيل المشتريات وإضافتها للمخزون' : 'تم حفظ فاتورة المشتريات كمسودة');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'فشل تسجيل المشتريات');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">فواتير مشتريات الفرع النشط. الترحيل يضيف الكميات للمخزون.</p>
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700" onClick={openCreate}>
          <Plus className="w-4 h-4" />مشتريات جديدة
        </Button>
      </div>

      {listError && <p className="text-sm text-rose-400">{listError}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500 gap-3">
          <Loader2 className="w-5 h-5 animate-spin" />جاري التحميل...
        </div>
      ) : purchases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
          <ShoppingCart className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">لا توجد مشتريات مسجلة</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-right text-zinc-400">رقم الفاتورة</TableHead>
                <TableHead className="text-right text-zinc-400">التاريخ</TableHead>
                <TableHead className="text-right text-zinc-400">الإجمالي</TableHead>
                <TableHead className="text-right text-zinc-400">الحالة</TableHead>
                <TableHead className="text-right text-zinc-400">ملاحظات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.map((p) => (
                <TableRow key={p.invID} className="border-zinc-800">
                  <TableCell className="text-sm">#{p.invID}</TableCell>
                  <TableCell className="text-xs text-zinc-400">{formatDate(p.invDate)}</TableCell>
                  <TableCell className="text-sm font-semibold text-amber-400">{money(p.GrandTotal)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${
                      p.PostStatus === 'POSTED' ? 'border-emerald-500/40 text-emerald-400'
                        : p.PostStatus === 'CANCELLED' ? 'border-rose-500/40 text-rose-400'
                          : 'border-zinc-600 text-zinc-300'}`}>
                      {p.PostStatus === 'POSTED' ? 'مُرحّلة' : p.PostStatus === 'CANCELLED' ? 'ملغاة' : 'مسودة'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-zinc-400">{p.Notes ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader><DialogTitle>فاتورة مشتريات جديدة</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-zinc-300">البنود (منتج، كمية، سعر الوحدة) *</Label>
              <div className="mt-1">
                <LineEditor items={items} lines={lines} withPrice onChange={(l) => { setLines(l); setFormError(''); }} />
              </div>
              <p className="text-xs text-zinc-500 mt-2">الإجمالي: <span className="text-amber-400 font-semibold">{money(total)}</span></p>
            </div>
            <div>
              <Label className="text-zinc-300">ملاحظات</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={100}
                className="bg-zinc-800 border-zinc-700 text-white mt-1" placeholder="مثال: توريد شهر نوفمبر" />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input type="checkbox" className="accent-amber-500 w-4 h-4" checked={post} onChange={(e) => setPost(e.target.checked)} />
              ترحيل فورًا وإضافة الكميات للمخزون
            </label>
            {formError && <p className="text-sm text-rose-400 flex items-center gap-1"><X className="w-3.5 h-3.5" />{formError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" className="border-zinc-700" onClick={() => setCreateOpen(false)} disabled={busy}>إلغاء</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={submit} disabled={busy}>
                {busy ? <><Loader2 className="w-4 h-4 animate-spin ml-1" />جاري الحفظ...</> : <><Check className="w-4 h-4 ml-1" />{post ? 'تسجيل وترحيل' : 'حفظ كمسودة'}</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Policy panel ─────────────────────────────────────────────────────────────

function PolicyPanel({ onChanged }: { onChanged: (msg: string) => Promise<void> }) {
  const [policy, setPolicy] = useState<StockPolicy | null>(null);
  const [negatives, setNegatives] = useState<NegativeBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/inventory/policy', { cache: 'no-store' });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'تعذر تحميل السياسة');
      setPolicy(data.policy);
      setNegatives(Array.isArray(data.negativeBalances) ? data.negativeBalances : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل السياسة');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const post = async (body: Record<string, unknown>, successMsg: string, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/inventory/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'فشل تحديث السياسة');
      setPolicy(data.policy);
      setNegatives(Array.isArray(data.negativeBalances) ? data.negativeBalances : []);
      await onChanged(successMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل تحديث السياسة');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500 gap-3">
        <Loader2 className="w-5 h-5 animate-spin" />جاري التحميل...
      </div>
    );
  }

  const strict = policy ? !policy.allowNegativeStock : false;

  return (
    <div className="space-y-4 max-w-3xl">
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/5 text-rose-400 text-sm">
          <X className="w-4 h-4 shrink-0" />{error}
        </div>
      )}

      {policy && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 divide-y divide-zinc-800">
          <PolicyRow
            title="تسجيل المخزون الافتتاحي"
            description="أكّد أنك سجّلت الأرصدة الافتتاحية لكل المنتجات (عبر المشتريات أو الجرد) قبل تفعيل الوضع الصارم."
            checked={policy.openingStockRegistered}
            disabled={busy || strict}
            onToggle={() =>
              post(
                { openingStockRegistered: !policy.openingStockRegistered },
                !policy.openingStockRegistered ? 'تم تسجيل المخزون الافتتاحي' : 'تم إلغاء تأكيد المخزون الافتتاحي',
              )}
          />
          <PolicyRow
            title="تسوية الأرصدة السالبة"
            description={
              negatives.length > 0
                ? `يوجد ${negatives.length} رصيد سالب. صحّحها بالتسوية أو الجرد ثم أكّد إتمام التسوية.`
                : 'لا توجد أرصدة سالبة حاليًا.'
            }
            checked={policy.negativeBalancesReconciled}
            disabled={busy || strict}
            onToggle={() =>
              post(
                { negativeBalancesReconciled: !policy.negativeBalancesReconciled },
                !policy.negativeBalancesReconciled ? 'تم تأكيد تسوية الأرصدة السالبة' : 'تم إلغاء تأكيد التسوية',
              )}
          />

          <div className="p-4 flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white">الوضع الصارم (منع الرصيد السالب)</span>
                <Badge variant="outline" className={`text-[10px] ${strict ? 'border-emerald-500/40 text-emerald-400' : 'border-amber-500/40 text-amber-400'}`}>
                  {strict ? 'مفعّل' : 'غير مفعّل'}
                </Badge>
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                {strict
                  ? `مفعّل منذ ${formatDate(policy.strictModeActivatedAt)} — لا يمكن بيع منتج بكمية أكبر من المتاح.`
                  : 'عند التفعيل لن يُسمح ببيع كمية أكبر من الرصيد. يتطلب تسجيل المخزون الافتتاحي وعدم وجود أرصدة سالبة.'}
              </p>
            </div>
            {!strict && (
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 shrink-0"
                disabled={busy || !policy.openingStockRegistered || negatives.length > 0}
                onClick={() =>
                  post(
                    { activateStrictMode: true },
                    'تم تفعيل الوضع الصارم',
                    'سيتم منع أي بيع يتجاوز الرصيد المتاح. هل تريد تفعيل الوضع الصارم؟',
                  )}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <ShieldCheck className="w-4 h-4 ml-1" />}
                تفعيل
              </Button>
            )}
          </div>
        </div>
      )}

      {negatives.length > 0 && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 overflow-hidden">
          <div className="px-4 py-2 text-sm font-semibold text-rose-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />الأرصدة السالبة ({negatives.length})
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-right text-zinc-400 h-9">المنتج</TableHead>
                <TableHead className="text-right text-zinc-400 h-9">الفرع</TableHead>
                <TableHead className="text-right text-zinc-400 h-9">الرصيد</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {negatives.map((n) => (
                <TableRow key={`${n.branchId}-${n.proId}`} className="border-zinc-800">
                  <TableCell className="py-2 text-sm">{n.productName}</TableCell>
                  <TableCell className="py-2 text-sm text-zinc-400">{n.branchName}</TableCell>
                  <TableCell className="py-2 text-sm font-bold text-rose-400">{n.qtyOnHand}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}


    </div>
  );
}

function PolicyRow({
  title, description, checked, disabled, onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <label className={`p-4 flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        className="accent-amber-500 w-4 h-4 mt-1"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <div>
        <div className="text-sm font-semibold text-white">{title}</div>
        <p className="text-xs text-zinc-500 mt-1">{description}</p>
      </div>
    </label>
  );
}
