'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Package, Plus, Edit2, Trash2, Loader2, Search, Clock, Crown,
  RotateCcw, X, Check, Scissors,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { PackageKind } from '@/lib/migrations/ensureServicePackages';
import type { PackageItemRow, ServicePackageRow } from '@/lib/catalog/servicePackages.types';

interface ServiceOption {
  ProID: number;
  ProName: string;
  ProNameAr: string | null;
  SPrice1: number;
  DurationMinutes: number | null;
  isDeleted?: boolean | number;
}

interface FormItem {
  ProID: number;
  ProName: string;
  Qty: number;
  IsOptional: boolean;
}

interface PackageForm {
  NameEn: string;
  NameAr: string;
  PackageKind: PackageKind;
  PackagePrice: number;
  OriginalPrice: string;
  DurationMinutes: string;
  Bonus: number;
  ImageUrl: string;
  DescriptionAr: string;
  DescriptionEn: string;
  SortOrder: number;
  IsPopular: boolean;
  isActive: boolean;
  DepositAmount: string;
  IncludesTrial: boolean;
  SessionCount: string;
  NotesAr: string;
  items: FormItem[];
}

const emptyForm = (kind: PackageKind): PackageForm => ({
  NameEn: '',
  NameAr: '',
  PackageKind: kind,
  PackagePrice: 0,
  OriginalPrice: '',
  DurationMinutes: '',
  Bonus: 0,
  ImageUrl: '',
  DescriptionAr: '',
  DescriptionEn: '',
  SortOrder: 0,
  IsPopular: false,
  isActive: true,
  DepositAmount: '',
  IncludesTrial: false,
  SessionCount: '',
  NotesAr: '',
  items: [],
});

function displayName(pkg: ServicePackageRow) {
  return pkg.NameAr?.trim() || pkg.NameEn;
}

function isSoftDeleted(pkg: ServicePackageRow) {
  return Boolean(pkg.isDeleted);
}

export default function PackagesManagementPage() {
  const [packages, setPackages] = useState<ServicePackageRow[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<PackageKind>('regular');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ServicePackageRow | null>(null);
  const [form, setForm] = useState<PackageForm>(emptyForm('regular'));
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [pkgRes, svcRes] = await Promise.all([
        fetch('/api/packages'),
        fetch('/api/services'),
      ]);
      const pkgData = await pkgRes.json();
      const svcData = await svcRes.json();
      if (!pkgRes.ok) throw new Error(pkgData.error || 'فشل تحميل الباكدجات');
      if (!svcRes.ok) throw new Error(svcData.error || 'فشل تحميل الخدمات');
      setPackages(Array.isArray(pkgData) ? pkgData : []);
      setServices(Array.isArray(svcData) ? svcData : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(tab));
    setServiceSearch('');
    setModalError('');
    setModalOpen(true);
  };

  const openEdit = async (pkg: ServicePackageRow) => {
    setModalError('');
    setServiceSearch('');
    setEditing(pkg);
    setModalOpen(true);
    try {
      const res = await fetch(`/api/packages/${pkg.PackageID}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل تحميل الباكدج');
      const items: FormItem[] = ((data.items as PackageItemRow[]) ?? []).map((it) => ({
        ProID: it.ProID,
        ProName: it.ProNameAr?.trim() || it.ProName || `خدمة #${it.ProID}`,
        Qty: Number(it.Qty) || 1,
        IsOptional: Boolean(it.IsOptional),
      }));
      setForm({
        NameEn: data.NameEn ?? '',
        NameAr: data.NameAr ?? '',
        PackageKind: data.PackageKind === 'groom' ? 'groom' : 'regular',
        PackagePrice: Number(data.PackagePrice) || 0,
        OriginalPrice: data.OriginalPrice != null ? String(data.OriginalPrice) : '',
        DurationMinutes: data.DurationMinutes != null ? String(data.DurationMinutes) : '',
        Bonus: Number(data.Bonus) || 0,
        ImageUrl: data.ImageUrl ?? '',
        DescriptionAr: data.DescriptionAr ?? '',
        DescriptionEn: data.DescriptionEn ?? '',
        SortOrder: Number(data.SortOrder) || 0,
        IsPopular: Boolean(data.IsPopular),
        isActive: !data.isDeleted,
        DepositAmount: data.DepositAmount != null ? String(data.DepositAmount) : '',
        IncludesTrial: Boolean(data.IncludesTrial),
        SessionCount: data.SessionCount != null ? String(data.SessionCount) : '',
        NotesAr: data.NotesAr ?? '',
        items,
      });
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : 'فشل التحميل');
    }
  };

  const addServiceItem = (svc: ServiceOption) => {
    if (form.items.some((i) => i.ProID === svc.ProID)) return;
    setForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          ProID: svc.ProID,
          ProName: svc.ProNameAr?.trim() || svc.ProName,
          Qty: 1,
          IsOptional: false,
        },
      ],
    }));
  };

  const removeServiceItem = (proId: number) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.filter((i) => i.ProID !== proId),
    }));
  };

  const handleSave = async () => {
    if (!form.NameEn.trim()) {
      setModalError('اسم الباكدج (إنجليزي) مطلوب');
      return;
    }
    if (form.PackagePrice < 0 || Number.isNaN(form.PackagePrice)) {
      setModalError('السعر غير صالح');
      return;
    }
    const durationNum = Number(form.DurationMinutes);
    if (form.DurationMinutes === '' || !Number.isInteger(durationNum) || durationNum <= 0) {
      setModalError('مدة الحجز (بالدقائق) مطلوبة');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const payload = {
        NameEn: form.NameEn.trim(),
        NameAr: form.NameAr.trim() || null,
        PackageKind: form.PackageKind,
        PackagePrice: Number(form.PackagePrice),
        OriginalPrice: form.OriginalPrice === '' ? null : Number(form.OriginalPrice),
        DurationMinutes: form.DurationMinutes === '' ? null : Number(form.DurationMinutes),
        Bonus: Number(form.Bonus) || 0,
        ImageUrl: form.ImageUrl.trim() || null,
        DescriptionAr: form.DescriptionAr.trim() || null,
        DescriptionEn: form.DescriptionEn.trim() || null,
        SortOrder: Number(form.SortOrder) || 0,
        IsPopular: form.IsPopular,
        isActive: form.isActive,
        DepositAmount: form.DepositAmount === '' ? null : Number(form.DepositAmount),
        IncludesTrial: form.IncludesTrial,
        SessionCount: form.SessionCount === '' ? null : Number(form.SessionCount),
        NotesAr: form.NotesAr.trim() || null,
        items: form.items.map((it, idx) => ({
          ProID: it.ProID,
          Qty: it.Qty,
          SortOrder: (idx + 1) * 10,
          IsOptional: it.IsOptional,
        })),
      };

      const url = editing ? `/api/packages/${editing.PackageID}` : '/api/packages';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحفظ');
      setModalOpen(false);
      await load();
    } catch (e: unknown) {
      setModalError(e instanceof Error ? e.message : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (pkg: ServicePackageRow) => {
    if (!confirm(`هل تريد إيقاف الباكدج «${displayName(pkg)}»؟`)) return;
    setDeletingId(pkg.PackageID);
    setError('');
    try {
      const res = await fetch(`/api/packages/${pkg.PackageID}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحذف');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل الحذف');
    } finally {
      setDeletingId(null);
    }
  };

  const handleRestore = async (pkg: ServicePackageRow) => {
    setDeletingId(pkg.PackageID);
    setError('');
    try {
      const res = await fetch(`/api/packages/${pkg.PackageID}/restore`, { method: 'PATCH' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الاستعادة');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل الاستعادة');
    } finally {
      setDeletingId(null);
    }
  };

  const ofTab = packages.filter((p) => p.PackageKind === tab);
  const displayed = ofTab.filter((p) => {
    if (statusFilter === 'active' && isSoftDeleted(p)) return false;
    if (statusFilter === 'inactive' && !isSoftDeleted(p)) return false;
    if (!searchTerm.trim()) return true;
    const q = searchTerm.trim().toLowerCase();
    return (
      p.NameEn.toLowerCase().includes(q) ||
      (p.NameAr ?? '').toLowerCase().includes(q)
    );
  });

  const regularCount = packages.filter((p) => p.PackageKind === 'regular').length;
  const groomCount = packages.filter((p) => p.PackageKind === 'groom').length;
  const activeCount = ofTab.filter((p) => !isSoftDeleted(p)).length;
  const inactiveCount = ofTab.filter((p) => isSoftDeleted(p)).length;

  const availableServices = services.filter((s) => {
    if (Number(s.isDeleted) === 1) return false;
    if (form.items.some((i) => i.ProID === s.ProID)) return false;
    if (!serviceSearch.trim()) return true;
    const q = serviceSearch.trim().toLowerCase();
    return (
      s.ProName.toLowerCase().includes(q) ||
      (s.ProNameAr ?? '').toLowerCase().includes(q)
    );
  }).slice(0, 12);

  return (
    <div className="min-w-0 p-3 sm:p-6 max-w-6xl mx-auto space-y-6" dir="rtl">
      <PageHeader
        title="إدارة الباكدجات"
        description="باكدج عادية وباكدج عريس — إنشاء وتعديل الخدمات المضمّنة"
      >
        <Button className="gap-2 bg-primary hover:bg-primary/85 text-primary-foreground" onClick={openCreate}>
          <Plus className="w-4 h-4" />
          باكدج جديد
        </Button>
      </PageHeader>

      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab('regular')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              tab === 'regular'
                ? 'bg-warning-soft border-warning/50 text-warning'
                : 'border-border text-muted-foreground hover:border-border'
            }`}
          >
            <Package className="w-4 h-4" />
            باكدج عادية ({regularCount})
          </button>
          <button
            type="button"
            onClick={() => setTab('groom')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              tab === 'groom'
                ? 'bg-info-soft border-info/50 text-info'
                : 'border-border text-muted-foreground hover:border-border'
            }`}
          >
            <Crown className="w-4 h-4" />
            باكدج عريس ({groomCount})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث..."
              className="h-9 w-44 pr-8 bg-card border-border"
            />
          </div>
          {(['all', 'active', 'inactive'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                statusFilter === f
                  ? f === 'active'
                    ? 'bg-success-soft border-success/40 text-success'
                    : f === 'inactive'
                      ? 'bg-muted border-border text-foreground'
                      : 'bg-muted border-border text-foreground'
                  : 'border-border text-muted-foreground hover:border-border'
              }`}
            >
              {f === 'all'
                ? `الكل (${ofTab.length})`
                : f === 'active'
                  ? `نشط (${activeCount})`
                  : `متوقف (${inactiveCount})`}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive-soft text-destructive text-sm">
          <X className="w-4 h-4 shrink-0" />
          {error}
          <button type="button" onClick={() => setError('')} className="mr-auto opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-3">
          <Loader2 className="w-6 h-6 animate-spin" />
          جاري التحميل...
        </div>
      ) : displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Package className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">
            لا توجد {tab === 'groom' ? 'باكدجات عريس' : 'باكدجات عادية'} بعد
          </p>
          <Button size="sm" className="mt-4 bg-primary hover:bg-primary/85 text-primary-foreground" onClick={openCreate}>
            <Plus className="w-4 h-4 ml-1" />
            إضافة باكدج
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {displayed.map((pkg) => {
            const inactive = isSoftDeleted(pkg);
            return (
              <div
                key={pkg.PackageID}
                className={`flex flex-col gap-3 rounded-xl px-4 py-3 border transition-colors ${
                  inactive
                    ? 'bg-background border-border opacity-60'
                    : 'bg-card border-border hover:border-border'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground truncate">{displayName(pkg)}</h3>
                    {pkg.NameAr && pkg.NameEn && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{pkg.NameEn}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {pkg.IsPopular && (
                      <Badge className="bg-warning-soft text-warning border-warning/30 text-[10px]">
                        مميز
                      </Badge>
                    )}
                    {inactive ? (
                      <Badge className="bg-muted text-muted-foreground border-border text-[10px]">متوقف</Badge>
                    ) : (
                      <Badge className="bg-success-soft text-success border-success/30 text-[10px]">نشط</Badge>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-sm">
                  <span className="font-bold text-warning">{pkg.PackagePrice} ج.م</span>
                  {pkg.OriginalPrice != null && pkg.OriginalPrice > pkg.PackagePrice && (
                    <span className="text-xs text-muted-foreground line-through">{pkg.OriginalPrice} ج.م</span>
                  )}
                  {pkg.DurationMinutes != null && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {pkg.DurationMinutes} د
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Scissors className="w-3 h-3" />
                  {pkg.ItemCount ?? 0} خدمة مضمّنة
                  {tab === 'groom' && pkg.DepositAmount != null && (
                    <span className="mr-auto text-info">عربون {pkg.DepositAmount} ج.م</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 pt-1 border-t border-border">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-foreground hover:text-foreground"
                    onClick={() => openEdit(pkg)}
                  >
                    <Edit2 className="w-3.5 h-3.5 ml-1" />
                    تعديل
                  </Button>
                  {inactive ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-success hover:text-success"
                      disabled={deletingId === pkg.PackageID}
                      onClick={() => handleRestore(pkg)}
                    >
                      {deletingId === pkg.PackageID ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <>
                          <RotateCcw className="w-3.5 h-3.5 ml-1" />
                          استعادة
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-destructive hover:text-destructive"
                      disabled={deletingId === pkg.PackageID}
                      onClick={() => handleDelete(pkg)}
                    >
                      {deletingId === pkg.PackageID ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <>
                          <Trash2 className="w-3.5 h-3.5 ml-1" />
                          إيقاف
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Package className="w-5 h-5 text-warning" />
              {editing ? 'تعديل باكدج' : 'باكدج جديد'}
            </DialogTitle>
          </DialogHeader>

          {modalError && (
            <div className="p-2.5 rounded-lg border border-destructive/30 bg-destructive-soft text-destructive text-sm">
              {modalError}
            </div>
          )}

          <div className="space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, PackageKind: 'regular' }))}
                className={`flex-1 py-2 rounded-lg text-sm border ${
                  form.PackageKind === 'regular'
                    ? 'bg-warning-soft border-warning/50 text-warning'
                    : 'border-border text-muted-foreground'
                }`}
              >
                باكدج عادية
              </button>
              <button
                type="button"
                onClick={() => setForm((p) => ({ ...p, PackageKind: 'groom' }))}
                className={`flex-1 py-2 rounded-lg text-sm border ${
                  form.PackageKind === 'groom'
                    ? 'bg-info-soft border-info/50 text-info'
                    : 'border-border text-muted-foreground'
                }`}
              >
                باكدج عريس
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>الاسم بالإنجليزي *</Label>
                <Input
                  value={form.NameEn}
                  onChange={(e) => setForm((p) => ({ ...p, NameEn: e.target.value }))}
                  className="bg-background border-border"
                  placeholder="Groom Package"
                />
              </div>
              <div className="space-y-1.5">
                <Label>الاسم بالعربي</Label>
                <Input
                  value={form.NameAr}
                  onChange={(e) => setForm((p) => ({ ...p, NameAr: e.target.value }))}
                  className="bg-background border-border"
                  placeholder="باكدج عريس"
                />
              </div>
              <div className="space-y-1.5">
                <Label>سعر الباكدج *</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.PackagePrice}
                  onChange={(e) => setForm((p) => ({ ...p, PackagePrice: Number(e.target.value) }))}
                  className="bg-background border-border"
                />
              </div>
              <div className="space-y-1.5">
                <Label>السعر الأصلي (قبل الخصم)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.OriginalPrice}
                  onChange={(e) => setForm((p) => ({ ...p, OriginalPrice: e.target.value }))}
                  className="bg-background border-border"
                  placeholder="اختياري"
                />
              </div>
              <div className="space-y-1.5">
                <Label>مدة الحجز (دقيقة) *</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.DurationMinutes}
                  onChange={(e) => setForm((p) => ({ ...p, DurationMinutes: e.target.value }))}
                  className="bg-background border-border"
                  placeholder="مثلاً 60"
                />
                <p className="text-[11px] text-muted-foreground">
                  الوقت اللي بيتحجز للباكدج — مش مجموع مدد الخدمات
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>بونص الصنايعي</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.Bonus}
                  onChange={(e) => setForm((p) => ({ ...p, Bonus: Number(e.target.value) }))}
                  className="bg-background border-border"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>رابط الصورة</Label>
                <Input
                  value={form.ImageUrl}
                  onChange={(e) => setForm((p) => ({ ...p, ImageUrl: e.target.value }))}
                  className="bg-background border-border"
                  placeholder="https://..."
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>وصف عربي</Label>
                <Textarea
                  value={form.DescriptionAr}
                  onChange={(e) => setForm((p) => ({ ...p, DescriptionAr: e.target.value }))}
                  className="bg-background border-border min-h-[70px]"
                />
              </div>
            </div>

            {form.PackageKind === 'groom' && (
              <div className="rounded-xl border border-info/20 bg-info-soft p-3 space-y-3">
                <p className="text-xs font-medium text-info">إعدادات باكدج العريس</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>مبلغ العربون</Label>
                    <Input
                      type="number"
                      min={0}
                      value={form.DepositAmount}
                      onChange={(e) => setForm((p) => ({ ...p, DepositAmount: e.target.value }))}
                      className="bg-background border-border"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>عدد الجلسات</Label>
                    <Input
                      type="number"
                      min={0}
                      value={form.SessionCount}
                      onChange={(e) => setForm((p) => ({ ...p, SessionCount: e.target.value }))}
                      className="bg-background border-border"
                    />
                  </div>
                  <div className="flex items-center justify-between sm:col-span-2 rounded-lg border border-border px-3 py-2">
                    <Label>يشمل جلسة تجريبية</Label>
                    <Switch
                      checked={form.IncludesTrial}
                      onCheckedChange={(v) => setForm((p) => ({ ...p, IncludesTrial: v }))}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>ملاحظات للعميل</Label>
                    <Textarea
                      value={form.NotesAr}
                      onChange={(e) => setForm((p) => ({ ...p, NotesAr: e.target.value }))}
                      className="bg-background border-border min-h-[60px]"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.IsPopular}
                  onCheckedChange={(v) => setForm((p) => ({ ...p, IsPopular: v }))}
                />
                <Label>باكدج مميز</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm((p) => ({ ...p, isActive: v }))}
                />
                <Label>نشط</Label>
              </div>
            </div>

            <div className="space-y-2 border-t border-border pt-4">
              <Label className="text-base">الخدمات المضمّنة</Label>
              {form.items.length === 0 ? (
                <p className="text-xs text-muted-foreground">لم تُضف خدمات بعد — ابحث وأضف من القائمة</p>
              ) : (
                <div className="space-y-1.5">
                  {form.items.map((it) => (
                    <div
                      key={it.ProID}
                      className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2"
                    >
                      <span className="flex-1 text-sm truncate">{it.ProName}</span>
                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={it.IsOptional}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              items: p.items.map((x) =>
                                x.ProID === it.ProID ? { ...x, IsOptional: e.target.checked } : x,
                              ),
                            }))
                          }
                        />
                        اختياري
                      </label>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={it.Qty}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            items: p.items.map((x) =>
                              x.ProID === it.ProID
                                ? { ...x, Qty: Math.max(1, Number(e.target.value) || 1) }
                                : x,
                            ),
                          }))
                        }
                        className="h-7 w-16 bg-card border-border text-center"
                      />
                      <button
                        type="button"
                        onClick={() => removeServiceItem(it.ProID)}
                        className="text-destructive hover:text-destructive p-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="relative mt-2">
                <Search className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={serviceSearch}
                  onChange={(e) => setServiceSearch(e.target.value)}
                  placeholder="ابحث عن خدمة لإضافتها..."
                  className="h-9 pr-8 bg-background border-border"
                />
              </div>
              {availableServices.length > 0 && (
                <div className="max-h-36 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {availableServices.map((svc) => (
                    <button
                      key={svc.ProID}
                      type="button"
                      onClick={() => addServiceItem(svc)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-right hover:bg-surface-muted"
                    >
                      <span className="truncate">{svc.ProNameAr?.trim() || svc.ProName}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{svc.SPrice1} ج.م</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => setModalOpen(false)}
                disabled={saving}
                className="text-muted-foreground"
              >
                إلغاء
              </Button>
              <Button
                className="gap-2 bg-primary hover:bg-primary/85 text-primary-foreground"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                حفظ
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
