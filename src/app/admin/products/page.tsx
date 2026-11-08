'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Package, Plus, Edit2, Loader2, Search, X, Check, Eye, EyeOff, Upload, Download,
  ImageIcon, ChevronDown, ChevronUp, FileSpreadsheet, RotateCcw, AlertTriangle,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { movementTypeLabel } from '@/lib/inventory/movementLabels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

interface Product {
  productId: number;
  productCode: string | null;
  barcode: string | null;
  nameAr: string;
  nameEn: string | null;
  catId: number | null;
  catName: string | null;
  brand: string | null;
  description: string | null;
  imageUrl: string | null;
  stockUnit: string | null;
  unitsPerPack: number | null;
  supplierRef: string | null;
  purchaseCost: number;
  sellingPrice: number;
  suggestedRetailPrice: number | null;
  minStockThreshold: number | null;
  isActive: boolean;
}

interface Category { CatID: number; CatName: string }

type StockStatus = 'ok' | 'low' | 'out';
interface StockInfo { qty: number; status: StockStatus }

interface BranchStockRow { branchId: number; branchName: string; branchCode: string | null; qtyOnHand: number; reorderLevel: number | null }
interface MovementRow {
  movementId: number; branchId: number; quantityDelta: number; quantityBefore: number | null;
  quantityAfter: number | null; movementType: string; referenceType: string | null;
  referenceId: number | null; reason: string | null; createdAt: string;
}

interface ImportRow {
  code: string; nameAr: string; consumerPrice: number; netSupplierCost: number; unit: string;
  status: 'new' | 'existing' | 'invalid' | 'duplicate';
  existingProductId?: number; message?: string;
  proposedChanges?: Record<string, unknown>;
}
interface ImportSummary { new: number; existing: number; invalid: number; duplicate: number }

interface FormState {
  productCode: string; nameAr: string; sellingPrice: string; purchaseCost: string; catId: string;
  barcode: string; brand: string; description: string; stockUnit: string; unitsPerPack: string;
  suggestedRetailPrice: string; minStockThreshold: string; supplierRef: string; imageUrl: string;
}

const EMPTY_FORM: FormState = {
  productCode: '', nameAr: '', sellingPrice: '', purchaseCost: '', catId: 'none',
  barcode: '', brand: '', description: '', stockUnit: '', unitsPerPack: '',
  suggestedRetailPrice: '', minStockThreshold: '', supplierRef: '', imageUrl: '',
};

const FALLBACK_IMAGE = '/services/basic.jpeg';

const STOCK_LABEL: Record<StockStatus, string> = { ok: 'متوفر', low: 'منخفض', out: 'نفد' };
const STOCK_BADGE: Record<StockStatus, string> = {
  ok: 'border-emerald-500/40 text-emerald-400',
  low: 'border-amber-500/40 text-amber-400',
  out: 'border-rose-500/40 text-rose-400',
};



const IMPORT_STATUS_LABEL: Record<ImportRow['status'], string> = {
  new: 'جديد', existing: 'موجود', invalid: 'غير صالح', duplicate: 'مكرر',
};
const IMPORT_STATUS_BADGE: Record<ImportRow['status'], string> = {
  new: 'border-emerald-500/40 text-emerald-400',
  existing: 'border-sky-500/40 text-sky-400',
  invalid: 'border-rose-500/40 text-rose-400',
  duplicate: 'border-amber-500/40 text-amber-400',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const money = (n: number | null | undefined) =>
  n == null ? '—' : `${Number(n).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;

const numOrNull = (v: string): number | null => {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseImportText(text: string): Array<{
  code: string; nameAr?: string; consumerPrice?: number; netSupplierCost?: number; unit?: string;
}> {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^code\s*[,\t;]/i.test(l))
    .map((line) => {
      const [code, nameAr, consumer, cost, unit] = line.split(/[,\t;]/).map((c) => c.trim());
      return {
        code: code ?? '',
        nameAr: nameAr || undefined,
        consumerPrice: consumer ? Number(consumer) : undefined,
        netSupplierCost: cost ? Number(cost) : undefined,
        unit: unit || undefined,
      };
    });
}

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stock, setStock] = useState<Record<number, StockInfo>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active');
  const [catFilter, setCatFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | StockStatus>('all');

  // Add / Edit dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Toggle
  const [toggling, setToggling] = useState<number | null>(null);

  // Detail dialog
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detail, setDetail] = useState<{
    product: Product; stockByBranch: BranchStockRow[]; movements: MovementRow[];
  } | null>(null);

  // Import dialog
  const [importOpen, setImportOpen] = useState(false);
  const [importUseReference, setImportUseReference] = useState(true);
  const [importCategoryName, setImportCategoryName] = useState('');
  const [importBrand, setImportBrand] = useState('');
  const [importText, setImportText] = useState('');
  const [importUpdateExisting, setImportUpdateExisting] = useState(false);
  const [importBusy, setImportBusy] = useState<'preview' | 'commit' | null>(null);
  const [importError, setImportError] = useState('');
  const [importPreview, setImportPreview] = useState<ImportRow[] | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);

  // Debounce search → server query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('q', debouncedSearch);
      if (statusFilter === 'active') params.set('active', 'true');
      const res = await fetch(`/api/admin/products?${params.toString()}`, { cache: 'no-store' });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'تعذر تحميل المنتجات');
      setProducts(Array.isArray(data.products) ? data.products : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل المنتجات');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter]);

  const loadStock = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory/branch', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await readJson(res);
      const map: Record<number, StockInfo> = {};
      for (const it of Array.isArray(data.items) ? data.items : []) {
        map[Number(it.productId)] = {
          qty: Number(it.inventory?.qtyOnHand ?? 0),
          status: it.stockStatus === 'out' || it.stockStatus === 'low' ? it.stockStatus : 'ok',
        };
      }
      setStock(map);
    } catch {
      /* stock is optional on this page */
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/services/categories');
      if (!res.ok) return;
      const data = await readJson(res);
      if (Array.isArray(data)) setCategories(data);
    } catch {
      /* categories fall back to those derived from products */
    }
  }, []);

  useEffect(() => { void loadProducts(); }, [loadProducts]);
  useEffect(() => { void loadStock(); void loadCategories(); }, [loadStock, loadCategories]);

  // Category options: API list merged with categories seen on products.
  const categoryOptions = useMemo(() => {
    const map = new Map<number, string>();
    categories.forEach((c) => map.set(c.CatID, c.CatName));
    products.forEach((p) => { if (p.catId != null && p.catName) map.set(p.catId, p.catName); });
    return Array.from(map, ([CatID, CatName]) => ({ CatID, CatName }))
      .sort((a, b) => a.CatName.localeCompare(b.CatName, 'ar'));
  }, [categories, products]);

  const brandOptions = useMemo(
    () => Array.from(new Set(products.map((p) => p.brand?.trim()).filter((b): b is string => !!b)))
      .sort((a, b) => a.localeCompare(b, 'ar')),
    [products],
  );

  const displayed = useMemo(() => products.filter((p) => {
    if (statusFilter === 'inactive' && p.isActive) return false;
    if (catFilter !== 'all' && String(p.catId ?? '') !== catFilter) return false;
    if (brandFilter !== 'all' && (p.brand ?? '') !== brandFilter) return false;
    if (stockFilter !== 'all') {
      const s = stock[p.productId];
      const status: StockStatus = s ? s.status : 'out';
      if (status !== stockFilter) return false;
    }
    return true;
  }), [products, statusFilter, catFilter, brandFilter, stockFilter, stock]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3500);
  };

  // ── Add / Edit ─────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowAdvanced(false);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      productCode: p.productCode ?? '',
      nameAr: p.nameAr ?? '',
      sellingPrice: String(p.sellingPrice ?? ''),
      purchaseCost: p.purchaseCost ? String(p.purchaseCost) : '',
      catId: p.catId != null ? String(p.catId) : 'none',
      barcode: p.barcode ?? '',
      brand: p.brand ?? '',
      description: p.description ?? '',
      stockUnit: p.stockUnit ?? '',
      unitsPerPack: p.unitsPerPack != null ? String(p.unitsPerPack) : '',
      suggestedRetailPrice: p.suggestedRetailPrice != null ? String(p.suggestedRetailPrice) : '',
      minStockThreshold: p.minStockThreshold != null ? String(p.minStockThreshold) : '',
      supplierRef: p.supplierRef ?? '',
      imageUrl: p.imageUrl ?? '',
    });
    setShowAdvanced(
      !!(p.barcode || p.brand || p.description || p.stockUnit || p.unitsPerPack ||
        p.suggestedRetailPrice || p.minStockThreshold || p.supplierRef || p.imageUrl),
    );
    setFormError('');
    setFormOpen(true);
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFormError('');
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setFormError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (editing) fd.append('productId', String(editing.productId));
      const res = await fetch('/api/admin/products/upload-image', { method: 'POST', body: fd });
      const data = await readJson(res);
      if (!res.ok || !data.ok) throw new Error(data.error || 'فشل رفع الصورة');
      setField('imageUrl', data.imageUrl);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'فشل رفع الصورة');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!form.productCode.trim()) return setFormError('كود المنتج مطلوب');
    if (!form.nameAr.trim()) return setFormError('اسم المنتج بالعربية مطلوب');
    const selling = numOrNull(form.sellingPrice);
    if (selling == null || selling < 0) return setFormError('سعر البيع غير صالح');
    const cost = numOrNull(form.purchaseCost);
    if (cost != null && cost < 0) return setFormError('سعر الشراء غير صالح');

    const payload = {
      productCode: form.productCode.trim(),
      nameAr: form.nameAr.trim(),
      sellingPrice: selling,
      purchaseCost: cost ?? 0,
      catId: form.catId === 'none' ? null : Number(form.catId),
      barcode: form.barcode.trim() || null,
      brand: form.brand.trim() || null,
      description: form.description.trim() || null,
      stockUnit: form.stockUnit.trim() || null,
      unitsPerPack: numOrNull(form.unitsPerPack),
      suggestedRetailPrice: numOrNull(form.suggestedRetailPrice),
      minStockThreshold: numOrNull(form.minStockThreshold),
      supplierRef: form.supplierRef.trim() || null,
      imageUrl: form.imageUrl.trim() || null,
    };

    setSaving(true);
    setFormError('');
    try {
      const res = await fetch(
        editing ? `/api/admin/products/${editing.productId}` : '/api/admin/products',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'فشل الحفظ');
      setFormOpen(false);
      flash(editing ? 'تم تحديث المنتج' : 'تمت إضافة المنتج');
      await Promise.all([loadProducts(), loadStock()]);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  // ── Disable / reactivate ───────────────────────────────────────────────────

  const handleToggle = async (p: Product) => {
    const next = !p.isActive;
    const msg = next
      ? `سيتم تفعيل المنتج "${p.nameAr}" وإعادة ظهوره في نقطة البيع. هل تريد المتابعة؟`
      : `سيتم إيقاف المنتج "${p.nameAr}" وإخفاؤه من نقطة البيع، مع بقاء سجل المخزون والحركات. هل تريد المتابعة؟`;
    if (!confirm(msg)) return;
    setToggling(p.productId);
    setError('');
    try {
      const res = await fetch(`/api/admin/products/${p.productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: next }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'فشل تحديث الحالة');
      setProducts((prev) => prev.map((x) => (x.productId === p.productId ? { ...x, isActive: next } : x)));
      flash(next ? 'تم تفعيل المنتج' : 'تم إيقاف المنتج');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل تحديث الحالة');
    } finally {
      setToggling(null);
    }
  };

  // ── Details ────────────────────────────────────────────────────────────────

  const openDetail = async (p: Product) => {
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const res = await fetch(`/api/admin/products/${p.productId}`, { cache: 'no-store' });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'تعذر تحميل التفاصيل');
      setDetail({
        product: data.product,
        stockByBranch: data.stockByBranch ?? [],
        movements: data.movements ?? [],
      });
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'تعذر تحميل التفاصيل');
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = () => {
    const header = [
      'الكود', 'الباركود', 'الاسم', 'التصنيف', 'العلامة التجارية', 'سعر البيع', 'سعر الشراء',
      'السعر المقترح', 'وحدة المخزون', 'وحدات في العبوة', 'حد إعادة الطلب', 'المورد', 'الكمية المتاحة', 'الحالة',
    ];
    const rows = displayed.map((p) => [
      p.productCode, p.barcode, p.nameAr, p.catName, p.brand, p.sellingPrice, p.purchaseCost,
      p.suggestedRetailPrice, p.stockUnit, p.unitsPerPack, p.minStockThreshold, p.supplierRef,
      stock[p.productId]?.qty ?? '', p.isActive ? 'نشط' : 'متوقف',
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ── Import ─────────────────────────────────────────────────────────────────

  const openImport = () => {
    setImportPreview(null);
    setImportSummary(null);
    setImportResult(null);
    setImportError('');
    setImportOpen(true);
  };

  const runImport = async (mode: 'preview' | 'commit') => {
    setImportBusy(mode);
    setImportError('');
    try {
      const rows = importUseReference ? undefined : parseImportText(importText);
      if (!importUseReference && (!rows || rows.length === 0)) {
        throw new Error('ألصق صفوف الاستيراد أو فعّل كتالوج المورد المرجعي');
      }
      const res = await fetch('/api/admin/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          useReference: importUseReference,
          updateExisting: importUpdateExisting,
          categoryName: importCategoryName.trim(),
          brand: importBrand.trim(),
          ...(rows ? { rows } : {}),
          ...(mode === 'commit' && importPreview ? { confirmedRows: importPreview } : {}),
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'فشل الاستيراد');
      if (mode === 'preview') {
        setImportPreview(data.preview ?? []);
        setImportSummary(data.summary ?? null);
        setImportResult(null);
      } else {
        setImportResult({ created: data.created ?? 0, updated: data.updated ?? 0, skipped: data.skipped ?? 0 });
        setImportPreview(null);
        setImportSummary(null);
        await Promise.all([loadProducts(), loadStock()]);
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'فشل الاستيراد');
    } finally {
      setImportBusy(null);
    }
  };

  const importableCount = importPreview
    ? importPreview.filter((r) => r.status === 'new' || (r.status === 'existing' && importUpdateExisting)).length
    : 0;

  const activeCount = products.filter((p) => p.isActive).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" dir="rtl">
      <PageHeader
        title="المنتجات"
        description="كتالوج منتجات التجزئة — الأسعار، الصور، والمخزون"
      >
        <Button variant="outline" className="gap-2 border-zinc-700" onClick={handleExport} disabled={displayed.length === 0}>
          <Download className="w-4 h-4" />
          تصدير CSV
        </Button>
        <Button variant="outline" className="gap-2 border-zinc-700" onClick={openImport}>
          <FileSpreadsheet className="w-4 h-4" />
          استيراد
        </Button>
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700" onClick={openCreate}>
          <Plus className="w-4 h-4" />
          منتج جديد
        </Button>
      </PageHeader>

      {/* Filters */}
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

        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-40 bg-zinc-900 border-zinc-700 text-white"><SelectValue placeholder="التصنيف" /></SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700">
            <SelectItem value="all">كل التصنيفات</SelectItem>
            {categoryOptions.map((c) => (
              <SelectItem key={c.CatID} value={String(c.CatID)}>{c.CatName}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger className="w-40 bg-zinc-900 border-zinc-700 text-white"><SelectValue placeholder="العلامة" /></SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700">
            <SelectItem value="all">كل العلامات</SelectItem>
            {brandOptions.map((b) => (<SelectItem key={b} value={b}>{b}</SelectItem>))}
          </SelectContent>
        </Select>

        <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as 'all' | StockStatus)}>
          <SelectTrigger className="w-40 bg-zinc-900 border-zinc-700 text-white"><SelectValue placeholder="المخزون" /></SelectTrigger>
          <SelectContent className="bg-zinc-800 border-zinc-700">
            <SelectItem value="all">كل حالات المخزون</SelectItem>
            <SelectItem value="ok">متوفر</SelectItem>
            <SelectItem value="low">منخفض</SelectItem>
            <SelectItem value="out">نفد</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5 text-xs mr-auto">
          {(['active', 'inactive', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg border transition-colors font-medium ${
                statusFilter === f
                  ? f === 'active'
                    ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
                    : 'bg-zinc-700/60 border-zinc-600 text-zinc-300'
                  : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'
              }`}
            >
              {f === 'active' ? 'نشط' : f === 'inactive' ? 'متوقف' : 'الكل'}
            </button>
          ))}
        </div>
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

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500 gap-3">
          <Loader2 className="w-6 h-6 animate-spin" />
          جاري التحميل...
        </div>
      ) : displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
          <Package className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">لا توجد منتجات مطابقة</p>
          <Button size="sm" className="mt-4 bg-amber-600 hover:bg-amber-700" onClick={openCreate}>
            <Plus className="w-4 h-4 ml-1" />
            إضافة منتج
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-right text-zinc-400 w-16">الصورة</TableHead>
                <TableHead className="text-right text-zinc-400">المنتج</TableHead>
                <TableHead className="text-right text-zinc-400">الكود</TableHead>
                <TableHead className="text-right text-zinc-400">التصنيف</TableHead>
                <TableHead className="text-right text-zinc-400">سعر البيع</TableHead>
                <TableHead className="text-right text-zinc-400">سعر الشراء</TableHead>
                <TableHead className="text-right text-zinc-400">المخزون</TableHead>
                <TableHead className="text-right text-zinc-400">الحالة</TableHead>
                <TableHead className="text-right text-zinc-400 w-40">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.map((p) => {
                const s = stock[p.productId];
                return (
                  <TableRow key={p.productId} className={`border-zinc-800 ${p.isActive ? '' : 'opacity-60'}`}>
                    <TableCell>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.imageUrl || FALLBACK_IMAGE}
                        alt={p.nameAr}
                        loading="lazy"
                        onError={(e) => {
                          if (!e.currentTarget.src.endsWith(FALLBACK_IMAGE)) e.currentTarget.src = FALLBACK_IMAGE;
                        }}
                        className="w-11 h-11 rounded-lg object-cover border border-zinc-700 bg-zinc-800"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium text-white">{p.nameAr}</div>
                      {p.brand && <div className="text-[11px] text-zinc-500">{p.brand}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-zinc-300" dir="ltr">
                      <div className="text-right">{p.productCode ?? '—'}</div>
                      {p.barcode && <div className="text-right text-[10px] text-zinc-500">{p.barcode}</div>}
                    </TableCell>
                    <TableCell className="text-sm text-zinc-300">{p.catName ?? '—'}</TableCell>
                    <TableCell className="text-sm font-semibold text-amber-400">{money(p.sellingPrice)}</TableCell>
                    <TableCell className="text-sm text-zinc-400">{money(p.purchaseCost)}</TableCell>
                    <TableCell>
                      {s ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-white">{s.qty}</span>
                          <Badge variant="outline" className={`text-[10px] ${STOCK_BADGE[s.status]}`}>
                            {STOCK_LABEL[s.status]}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                        p.isActive
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                          : 'bg-zinc-700/30 border-zinc-700 text-zinc-500'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${p.isActive ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                        {p.isActive ? 'نشط' : 'متوقف'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-400 hover:text-sky-400"
                          title="التفاصيل والحركات" onClick={() => openDetail(p)}>
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-400 hover:text-amber-400"
                          title="تعديل" onClick={() => openEdit(p)}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          className={`h-7 px-2 text-xs gap-1 ${p.isActive
                            ? 'text-zinc-400 hover:text-rose-400 hover:bg-rose-400/10'
                            : 'text-zinc-500 hover:text-emerald-400 hover:bg-emerald-400/10'}`}
                          onClick={() => handleToggle(p)}
                          disabled={toggling === p.productId}
                          title={p.isActive ? 'إيقاف المنتج' : 'إعادة تفعيل المنتج'}
                        >
                          {toggling === p.productId ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : p.isActive ? (
                            <><EyeOff className="w-3.5 h-3.5" />إيقاف</>
                          ) : (
                            <><RotateCcw className="w-3.5 h-3.5" />تفعيل</>
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="px-4 py-2 text-xs text-zinc-500 border-t border-zinc-800">
            عرض {displayed.length} من {products.length} منتج — النشط: {activeCount}
          </div>
        </div>
      )}

      {/* ───────── Add / Edit dialog ───────── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? 'تعديل المنتج' : 'منتج جديد'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pCode" className="text-zinc-300">كود المنتج *</Label>
                <Input id="pCode" dir="ltr" value={form.productCode} onChange={(e) => setField('productCode', e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white mt-1 font-mono" placeholder="LH.5097" autoFocus />
              </div>
              <div>
                <Label className="text-zinc-300">التصنيف</Label>
                <Select value={form.catId} onValueChange={(v) => setField('catId', v)}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="none">بدون تصنيف</SelectItem>
                    {categoryOptions.map((c) => (
                      <SelectItem key={c.CatID} value={String(c.CatID)}>{c.CatName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="pName" className="text-zinc-300">اسم المنتج (عربي) *</Label>
              <Input id="pName" value={form.nameAr} onChange={(e) => setField('nameAr', e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-white mt-1" placeholder="مثال: شامبو للعناية بالشعر" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="pSell" className="text-zinc-300">سعر البيع (ج.م) *</Label>
                <Input id="pSell" type="number" min="0" step="0.01" inputMode="decimal" value={form.sellingPrice}
                  onChange={(e) => setField('sellingPrice', e.target.value)} className="bg-zinc-800 border-zinc-700 text-white mt-1" />
              </div>
              <div>
                <Label htmlFor="pCost" className="text-zinc-300">سعر الشراء (ج.م)</Label>
                <Input id="pCost" type="number" min="0" step="0.01" inputMode="decimal" value={form.purchaseCost}
                  onChange={(e) => setField('purchaseCost', e.target.value)} className="bg-zinc-800 border-zinc-700 text-white mt-1" />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300"
            >
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {showAdvanced ? 'إخفاء الخيارات المتقدمة' : 'خيارات متقدمة (باركود، علامة، صورة، حد إعادة الطلب...)'}
            </button>

            {showAdvanced && (
              <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-zinc-300">الباركود</Label>
                    <Input dir="ltr" value={form.barcode} onChange={(e) => setField('barcode', e.target.value)}
                      className="bg-zinc-800 border-zinc-700 text-white mt-1 font-mono" />
                  </div>
                  <div>
                    <Label className="text-zinc-300">العلامة التجارية</Label>
                    <Input value={form.brand} onChange={(e) => setField('brand', e.target.value)}
                      className="bg-zinc-800 border-zinc-700 text-white mt-1" list="brand-suggestions" />
                    <datalist id="brand-suggestions">
                      {brandOptions.map((b) => (<option key={b} value={b} />))}
                    </datalist>
                  </div>
                </div>

                <div>
                  <Label className="text-zinc-300">الوصف</Label>
                  <Textarea value={form.description} onChange={(e) => setField('description', e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-white mt-1 min-h-[64px]" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-zinc-300">وحدة المخزون</Label>
                    <Input value={form.stockUnit} onChange={(e) => setField('stockUnit', e.target.value)}
                      className="bg-zinc-800 border-zinc-700 text-white mt-1" placeholder="قطعة / علبة / كارت" list="unit-suggestions" />
                    <datalist id="unit-suggestions">
                      <option value="قطعة" /><option value="علبة" /><option value="كارت" /><option value="كرتونة" />
                    </datalist>
                  </div>
                  <div>
                    <Label className="text-zinc-300">عدد الوحدات في العبوة</Label>
                    <Input type="number" min="0" step="1" value={form.unitsPerPack}
                      onChange={(e) => setField('unitsPerPack', e.target.value)} className="bg-zinc-800 border-zinc-700 text-white mt-1" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-zinc-300">السعر المقترح للمستهلك</Label>
                    <Input type="number" min="0" step="0.01" value={form.suggestedRetailPrice}
                      onChange={(e) => setField('suggestedRetailPrice', e.target.value)} className="bg-zinc-800 border-zinc-700 text-white mt-1" />
                  </div>
                  <div>
                    <Label className="text-zinc-300">حد إعادة الطلب</Label>
                    <Input type="number" min="0" step="1" value={form.minStockThreshold}
                      onChange={(e) => setField('minStockThreshold', e.target.value)} className="bg-zinc-800 border-zinc-700 text-white mt-1" />
                  </div>
                </div>

                <div>
                  <Label className="text-zinc-300">مرجع المورد</Label>
                  <Input value={form.supplierRef} onChange={(e) => setField('supplierRef', e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-white mt-1" />
                </div>

                <div>
                  <Label className="text-zinc-300">صورة المنتج</Label>
                  <div className="mt-1 flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={form.imageUrl || FALLBACK_IMAGE}
                      alt="معاينة"
                      className="w-16 h-16 rounded-lg object-cover border border-zinc-700 bg-zinc-800"
                    />
                    <div className="flex-1 space-y-2">
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => handleUpload(e.target.files?.[0])}
                      />
                      <Button type="button" variant="outline" size="sm" className="border-zinc-700 gap-1.5"
                        onClick={() => fileRef.current?.click()} disabled={uploading}>
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                        {uploading ? 'جاري الرفع...' : 'رفع صورة'}
                      </Button>
                      <Input dir="ltr" value={form.imageUrl} onChange={(e) => setField('imageUrl', e.target.value)}
                        placeholder="أو الصق رابط الصورة" className="bg-zinc-800 border-zinc-700 text-white text-xs" />
                      <p className="text-[11px] text-zinc-500 flex items-center gap-1">
                        <ImageIcon className="w-3 h-3" />JPG / PNG / WebP — حتى 5 ميجابايت
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {formError && (
              <p className="text-sm text-rose-400 flex items-center gap-1">
                <X className="w-3.5 h-3.5" />{formError}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" className="border-zinc-700" onClick={() => setFormOpen(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button
              className={editing ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}
              onClick={handleSave}
              disabled={saving || uploading}
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin ml-1" />جاري الحفظ...</>
                : <><Check className="w-4 h-4 ml-1" />{editing ? 'حفظ التعديل' : 'إضافة'}</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ───────── Detail dialog ───────── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{detail?.product.nameAr ?? 'تفاصيل المنتج'}</DialogTitle>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center py-12 text-zinc-500 gap-3">
              <Loader2 className="w-5 h-5 animate-spin" />جاري التحميل...
            </div>
          ) : detailError ? (
            <p className="text-sm text-rose-400">{detailError}</p>
          ) : detail ? (
            <div className="space-y-5 pt-2">
              <div className="flex gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={detail.product.imageUrl || FALLBACK_IMAGE} alt={detail.product.nameAr}
                  className="w-24 h-24 rounded-xl object-cover border border-zinc-700 bg-zinc-800" />
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm flex-1">
                  <Info label="الكود" value={detail.product.productCode} mono />
                  <Info label="الباركود" value={detail.product.barcode} mono />
                  <Info label="التصنيف" value={detail.product.catName} />
                  <Info label="العلامة" value={detail.product.brand} />
                  <Info label="سعر البيع" value={money(detail.product.sellingPrice)} />
                  <Info label="سعر الشراء" value={money(detail.product.purchaseCost)} />
                  <Info label="حد إعادة الطلب" value={detail.product.minStockThreshold} />
                  <Info label="وحدة المخزون" value={detail.product.stockUnit} />
                  <Info label="المورد" value={detail.product.supplierRef} />
                </div>
              </div>

              <section>
                <h3 className="text-sm font-semibold text-zinc-300 mb-2">المخزون حسب الفرع</h3>
                <div className="rounded-lg border border-zinc-800 overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="text-right text-zinc-400 h-9">الفرع</TableHead>
                        <TableHead className="text-right text-zinc-400 h-9">الكمية</TableHead>
                        <TableHead className="text-right text-zinc-400 h-9">حد إعادة الطلب</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.stockByBranch.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="text-center text-zinc-500 text-sm">لا توجد فروع</TableCell></TableRow>
                      ) : detail.stockByBranch.map((b) => (
                        <TableRow key={b.branchId} className="border-zinc-800">
                          <TableCell className="py-2 text-sm">{b.branchName}</TableCell>
                          <TableCell className={`py-2 text-sm font-semibold ${Number(b.qtyOnHand) <= 0 ? 'text-rose-400' : 'text-white'}`}>
                            {Number(b.qtyOnHand)}
                          </TableCell>
                          <TableCell className="py-2 text-sm text-zinc-400">{b.reorderLevel ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-zinc-300 mb-2">آخر حركات المخزون</h3>
                <div className="rounded-lg border border-zinc-800 overflow-hidden max-h-72 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800 hover:bg-transparent">
                        <TableHead className="text-right text-zinc-400 h-9">التاريخ</TableHead>
                        <TableHead className="text-right text-zinc-400 h-9">النوع</TableHead>
                        <TableHead className="text-right text-zinc-400 h-9">التغيير</TableHead>
                        <TableHead className="text-right text-zinc-400 h-9">الرصيد بعد</TableHead>
                        <TableHead className="text-right text-zinc-400 h-9">السبب</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.movements.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center text-zinc-500 text-sm">لا توجد حركات</TableCell></TableRow>
                      ) : detail.movements.map((m) => (
                        <TableRow key={m.movementId} className="border-zinc-800">
                          <TableCell className="py-2 text-xs text-zinc-400">{formatDate(m.createdAt)}</TableCell>
                          <TableCell className="py-2 text-xs">{movementTypeLabel(m.movementType)}</TableCell>
                          <TableCell className={`py-2 text-sm font-semibold ${Number(m.quantityDelta) < 0 ? 'text-rose-400' : 'text-emerald-400'}`} dir="ltr">
                            <span className="block text-right">{Number(m.quantityDelta) > 0 ? '+' : ''}{Number(m.quantityDelta)}</span>
                          </TableCell>
                          <TableCell className="py-2 text-sm">{m.quantityAfter ?? '—'}</TableCell>
                          <TableCell className="py-2 text-xs text-zinc-400">{m.reason ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ───────── Import dialog ───────── */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>استيراد كتالوج المنتجات</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-300 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>ابدأ بالمعاينة أولًا. لا يتم تعديل أي بيانات إلا بعد الضغط على «تأكيد الاستيراد». الاستيراد لا يسجّل أرصدة مخزون.</span>
            </div>

            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input type="checkbox" className="accent-amber-500 w-4 h-4" checked={importUseReference}
                onChange={(e) => { setImportUseReference(e.target.checked); setImportPreview(null); setImportSummary(null); }} />
              استخدام كتالوج المورد المرجعي (19 صنفًا)
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-zinc-300">تصنيف كل المنتجات في الدفعة</Label>
                <Input
                  value={importCategoryName}
                  onChange={(e) => { setImportCategoryName(e.target.value); setImportPreview(null); setImportSummary(null); }}
                  placeholder="مثال: شركة لورد"
                  maxLength={100}
                  className="bg-zinc-800 border-zinc-700 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-zinc-300">العلامة التجارية (اختياري)</Label>
                <Input
                  value={importBrand}
                  onChange={(e) => { setImportBrand(e.target.value); setImportPreview(null); setImportSummary(null); }}
                  placeholder="مثال: Lord"
                  maxLength={100}
                  className="bg-zinc-800 border-zinc-700 text-white mt-1"
                />
              </div>
            </div>
            <p className="text-xs text-zinc-400">
              التصنيف والبراند المختاران يطبقان على كل صفوف الاستيراد. يُنشأ تصنيف المنتجات عند التأكيد فقط إن لم يكن موجوداً.
            </p>

            {!importUseReference && (
              <div>
                <Label className="text-zinc-300">الصفوف (كود، اسم، سعر البيع، تكلفة المورد، الوحدة)</Label>
                <Textarea
                  dir="ltr"
                  value={importText}
                  onChange={(e) => { setImportText(e.target.value); setImportPreview(null); setImportSummary(null); }}
                  className="bg-zinc-800 border-zinc-700 text-white mt-1 min-h-[120px] font-mono text-xs"
                  placeholder={'LH.5097, ماكينة حلاقة لورد, 625, 250, card\nML147#, شفرات لورد, 200, 81, piece'}
                />
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
              <input type="checkbox" className="accent-amber-500 w-4 h-4" checked={importUpdateExisting}
                onChange={(e) => setImportUpdateExisting(e.target.checked)} />
              تحديث الأسعار للمنتجات الموجودة
            </label>

            {importError && (
              <p className="text-sm text-rose-400 flex items-center gap-1"><X className="w-3.5 h-3.5" />{importError}</p>
            )}

            {importResult && (
              <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-sm">
                تم الاستيراد: {importResult.created} جديد، {importResult.updated} محدّث، {importResult.skipped} متجاهَل.
              </div>
            )}

            {importSummary && (
              <div className="flex flex-wrap gap-2 text-xs">
                {(['new', 'existing', 'duplicate', 'invalid'] as const).map((k) => (
                  <Badge key={k} variant="outline" className={IMPORT_STATUS_BADGE[k]}>
                    {IMPORT_STATUS_LABEL[k]}: {importSummary[k]}
                  </Badge>
                ))}
              </div>
            )}

            {importPreview && (
              <div className="rounded-lg border border-zinc-800 overflow-hidden max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                      <TableHead className="text-right text-zinc-400 h-9">الكود</TableHead>
                      <TableHead className="text-right text-zinc-400 h-9">الاسم</TableHead>
                      <TableHead className="text-right text-zinc-400 h-9">سعر البيع</TableHead>
                      <TableHead className="text-right text-zinc-400 h-9">التكلفة</TableHead>
                      <TableHead className="text-right text-zinc-400 h-9">الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.map((r, i) => (
                      <TableRow key={`${r.code}-${i}`} className="border-zinc-800">
                        <TableCell className="py-2 font-mono text-xs" dir="ltr"><span className="block text-right">{r.code}</span></TableCell>
                        <TableCell className="py-2 text-sm">{r.nameAr}</TableCell>
                        <TableCell className="py-2 text-sm">{money(r.consumerPrice)}</TableCell>
                        <TableCell className="py-2 text-sm text-zinc-400">{money(r.netSupplierCost)}</TableCell>
                        <TableCell className="py-2">
                          <Badge variant="outline" className={`text-[10px] ${IMPORT_STATUS_BADGE[r.status]}`}>
                            {IMPORT_STATUS_LABEL[r.status]}
                          </Badge>
                          {r.message && <div className="text-[10px] text-zinc-500 mt-0.5">{r.message}</div>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" className="border-zinc-700" onClick={() => setImportOpen(false)} disabled={importBusy !== null}>
              إغلاق
            </Button>
            <Button variant="outline" className="border-zinc-700 gap-1.5" onClick={() => runImport('preview')} disabled={importBusy !== null}>
              {importBusy === 'preview' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              معاينة
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 gap-1.5"
              onClick={() => {
                if (confirm(`سيتم استيراد ${importableCount} صنف. هل تريد التأكيد؟`)) void runImport('commit');
              }}
              disabled={importBusy !== null || !importPreview || importableCount === 0}
            >
              {importBusy === 'commit' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              تأكيد الاستيراد{importPreview ? ` (${importableCount})` : ''}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={`text-sm text-zinc-200 truncate ${mono ? 'font-mono' : ''}`} dir={mono ? 'ltr' : undefined}>
        {value == null || value === '' ? '—' : value}
      </div>
    </div>
  );
}
