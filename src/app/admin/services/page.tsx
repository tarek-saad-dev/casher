'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Scissors, Plus, Edit2, Trash2, Loader2, FolderOpen,
  FolderPlus, Settings, Search, Clock, MoreVertical, Users,
  ImageIcon, X, ChevronUp, ChevronDown,
} from 'lucide-react';
import { SERVICE_IMAGE_PRESETS } from '@/lib/serviceImages';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CategoryBadge } from '@/components/shared/CategoryBadge';
import { getCategoryTheme } from '@/lib/categoryTheme';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

interface Service {
  ProID: number;
  ProName: string;
  ProNameAr: string | null;
  SPrice1: number;
  Bonus: number;
  CatID: number | null;
  CatName: string | null;
  SalesCount: number;
  isDeleted?: boolean;
  DurationMinutes: number | null;
  ImageUrl: string | null;
}

interface BarberDurationItem {
  empId: number;
  empName: string;
  overrideDurationMinutes: number | null;
  effectiveDurationMinutes: number;
  durationSource: string;
  pendingValue: string;
}

interface Category {
  CatID: number;
  CatName: string;
  ServiceCount: number;
  SortOrder: number;
}

interface ServiceFormData {
  ProName: string;
  ProNameAr: string;
  SPrice1: number;
  Bonus: number;
  CatID: number | null;
  isActive: boolean;
  ImageUrl: string;
}

interface CategoryFormData {
  CatName: string;
  Description?: string;
  isActive: boolean;
}

export default function ServicesManagementPage() {
  // State
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Service Modal State
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [serviceSaving, setServiceSaving] = useState(false);
  const [serviceFormData, setServiceFormData] = useState<ServiceFormData>({
    ProName: '',
    ProNameAr: '',
    SPrice1: 0,
    Bonus: 0,
    CatID: null,
    isActive: true,
    ImageUrl: '',
  });

  // Duration state per service (inline edit)
  const [durationEdits, setDurationEdits] = useState<Record<number, string>>({});
  const [durationSaving, setDurationSaving] = useState<Record<number, boolean>>({});

  // Barber-duration modal
  const [barberDurModal, setBarberDurModal] = useState(false);
  const [barberDurService, setBarberDurService] = useState<Service | null>(null);
  const [barberDurItems, setBarberDurItems] = useState<BarberDurationItem[]>([]);
  const [barberDurLoading, setBarberDurLoading] = useState(false);
  const [barberDurSaving, setBarberDurSaving] = useState(false);

  const openBarberDurModal = async (service: Service) => {
    setBarberDurService(service);
    setBarberDurModal(true);
    setBarberDurLoading(true);
    try {
      const res = await fetch(`/api/services/${service.ProID}/barber-durations`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل التحميل');
      setBarberDurItems(
        (data.barbers as BarberDurationItem[]).map(b => ({
          ...b,
          pendingValue: b.overrideDurationMinutes !== null ? String(b.overrideDurationMinutes) : '',
        }))
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBarberDurLoading(false);
    }
  };

  const saveBarberDurations = async () => {
    if (!barberDurService) return;
    setBarberDurSaving(true);
    try {
      const items = barberDurItems.map(b => ({
        empId: b.empId,
        durationMinutes: b.pendingValue.trim() === '' ? null : parseInt(b.pendingValue),
      }));
      const res = await fetch(`/api/services/${barberDurService.ProID}/barber-durations`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحفظ');
      setBarberDurModal(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBarberDurSaving(false);
    }
  };

  const saveDurationMinutes = async (service: Service) => {
    const raw = durationEdits[service.ProID];
    const val = raw === '' ? null : parseInt(raw);
    if (val !== null && (isNaN(val) || val < 5 || val > 240)) {
      setError('مدة الخدمة يجب أن تكون بين 5 و 240 دقيقة');
      return;
    }
    setDurationSaving(prev => ({ ...prev, [service.ProID]: true }));
    try {
      const res = await fetch(`/api/services/${service.ProID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationMinutes: val }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحفظ');
      await loadData();
      setDurationEdits(prev => { const n = { ...prev }; delete n[service.ProID]; return n; });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDurationSaving(prev => ({ ...prev, [service.ProID]: false }));
    }
  };

  // Category Modal State
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categorySaving, setCategorySaving] = useState(false);
  const [reorderSaving, setReorderSaving] = useState(false);
  /** Draft position inputs (1-based display rank) keyed by CatID */
  const [positionDrafts, setPositionDrafts] = useState<Record<number, string>>({});
  const [categoryFormData, setCategoryFormData] = useState<CategoryFormData>({
    CatName: '',
    Description: '',
    isActive: true,
  });

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [servicesRes, categoriesRes] = await Promise.all([
        fetch('/api/services'),
        fetch('/api/services/categories'),
      ]);

      const servicesData = await servicesRes.json();
      const categoriesData = await categoriesRes.json();

      if (!servicesRes.ok) throw new Error(servicesData.error || 'خطأ في تحميل الخدمات');
      if (!categoriesRes.ok) throw new Error(categoriesData.error || 'خطأ في تحميل الفئات');

      setServices(Array.isArray(servicesData) ? servicesData : []);
      setCategories(Array.isArray(categoriesData) ? categoriesData : []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter services
  const filteredServices = services.filter(service => {
    const matchesSearch = service.ProName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = !selectedCategory || selectedCategory === 'all' || service.CatID?.toString() === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Service CRUD operations
  const openServiceModal = (service?: Service) => {
    if (service) {
      setEditingService(service);
      setServiceFormData({
        ProName: service.ProName,
        ProNameAr: service.ProNameAr || '',
        SPrice1: service.SPrice1,
        Bonus: service.Bonus,
        CatID: service.CatID,
        isActive: !service.isDeleted,
        ImageUrl: service.ImageUrl || '',
      });
      if (service.DurationMinutes !== null && service.DurationMinutes !== undefined) {
        setDurationEdits(prev => ({ ...prev, [service.ProID]: String(service.DurationMinutes) }));
      }
    } else {
      setEditingService(null);
      setServiceFormData({
        ProName: '',
        ProNameAr: '',
        SPrice1: 0,
        Bonus: 0,
        CatID: null,
        isActive: true,
        ImageUrl: '',
      });
    }
    setServiceModalOpen(true);
  };

  const saveService = async () => {
    if (!serviceFormData.ProName.trim()) {
      setError('يجب إدخال اسم الخدمة');
      return;
    }

    setServiceSaving(true);
    try {
      const url = editingService 
        ? `/api/services/${editingService.ProID}`
        : '/api/services';
      
      const method = editingService ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serviceFormData),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'فشل حفظ الخدمة');
      }

      await loadData();
      setServiceModalOpen(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setServiceSaving(false);
    }
  };

  const deleteService = async (serviceId: number) => {
    if (!confirm('هل أنت متأكد من حذف هذه الخدمة؟')) return;

    try {
      const response = await fetch(`/api/services/${serviceId}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'فشل حذف الخدمة');
      }

      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Category CRUD operations
  const openCategoryModal = (category?: Category) => {
    if (category) {
      setEditingCategory(category);
      setCategoryFormData({
        CatName: category.CatName,
        Description: '',
        isActive: true,
      });
    } else {
      setEditingCategory(null);
      setCategoryFormData({
        CatName: '',
        Description: '',
        isActive: true,
      });
    }
    setCategoryModalOpen(true);
  };

  const saveCategory = async () => {
    if (!categoryFormData.CatName.trim()) {
      setError('يجب إدخال اسم الفئة');
      return;
    }

    setCategorySaving(true);
    try {
      const url = editingCategory 
        ? `/api/services/categories/${editingCategory.CatID}`
        : '/api/services/categories';
      
      const method = editingCategory ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryFormData),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'فشل حفظ الفئة');
      }

      await loadData();
      setCategoryModalOpen(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCategorySaving(false);
    }
  };

  const deleteCategory = async (categoryId: number) => {
    if (!confirm('هل أنت متأكد من حذف هذه الفئة؟ سيؤدي هذا إلى إزالة الفئة من جميع الخدمات المرتبطة بها.')) return;

    try {
      const response = await fetch(`/api/services/categories/${categoryId}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'فشل حذف الفئة');
      }

      await loadData();
    } catch (e: any) {
      setError(e.message);
    }
  };

  /** Persist full category display order (first id = shown first). */
  const persistCategoryOrder = async (ordered: Category[]) => {
    const optimistic = ordered.map((c, i) => ({ ...c, SortOrder: (i + 1) * 10 }));
    setCategories(optimistic);
    setPositionDrafts({});
    setReorderSaving(true);
    try {
      const res = await fetch('/api/services/categories/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryIds: ordered.map((c) => c.CatID) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل حفظ الترتيب');
      if (Array.isArray(data.categories)) {
        setCategories(data.categories);
      }
    } catch (e: any) {
      setError(e.message);
      await loadData();
    } finally {
      setReorderSaving(false);
    }
  };

  const sortedCategories = [...categories].sort(
    (a, b) => (a.SortOrder ?? 0) - (b.SortOrder ?? 0) || a.CatName.localeCompare(b.CatName, 'ar'),
  );

  /** Move category up/down in display order and persist via reorder API. */
  const moveCategory = async (categoryId: number, direction: 'up' | 'down') => {
    const sorted = sortedCategories;
    const index = sorted.findIndex((c) => c.CatID === categoryId);
    if (index < 0) return;
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= sorted.length) return;

    const next = [...sorted];
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    await persistCategoryOrder(next);
  };

  /**
   * Set absolute 1-based display position (1 = first).
   * Clamps to 1..N and moves the category into that slot.
   */
  const setCategoryPosition = async (categoryId: number, rawPosition: string) => {
    const sorted = sortedCategories;
    const fromIndex = sorted.findIndex((c) => c.CatID === categoryId);
    if (fromIndex < 0) return;

    const parsed = parseInt(rawPosition.trim(), 10);
    if (isNaN(parsed)) {
      setPositionDrafts((prev) => {
        const next = { ...prev };
        delete next[categoryId];
        return next;
      });
      return;
    }

    const toIndex = Math.max(0, Math.min(sorted.length - 1, parsed - 1));
    if (toIndex === fromIndex) {
      setPositionDrafts((prev) => {
        const next = { ...prev };
        delete next[categoryId];
        return next;
      });
      return;
    }

    const next = [...sorted];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    await persistCategoryOrder(next);
  };

  // Statistics
  const totalServices = services.length;
  const activeServices = services.filter(s => !s.isDeleted).length;
  const totalCategories = categories.length;
  const avgPrice = services.length > 0 
    ? services.reduce((sum, s) => sum + s.SPrice1, 0) / services.length 
    : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" dir="rtl">
      {/* Barber Duration Modal */}
      <Dialog open={barberDurModal} onOpenChange={setBarberDurModal}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              <Users className="w-5 h-5 text-amber-400" />
              مدة الخدمة حسب الصنايعي — {barberDurService?.ProName}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-zinc-400 -mt-2">
            مدة الصنايعي تؤثر على المواعيد المتاحة في الحجز الإلكتروني. اترك الحقل فارغًا لاستخدام مدة الخدمة الافتراضية.
          </p>
          {barberDurLoading ? (
            <div className="py-10 text-center text-zinc-500">
              <Loader2 className="w-6 h-6 mx-auto animate-spin mb-2" />
              <p className="text-sm">جاري التحميل...</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-zinc-800">
                    <TableHead className="text-right text-zinc-400">الصنايعي</TableHead>
                    <TableHead className="text-right text-zinc-400">مدة مخصصة</TableHead>
                    <TableHead className="text-right text-zinc-400">المدة الفعلية</TableHead>
                    <TableHead className="text-right text-zinc-400">المصدر</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {barberDurItems.map((b, i) => {
                    const pendingNum = b.pendingValue === '' ? null : parseInt(b.pendingValue);
                    const effective = pendingNum !== null && !isNaN(pendingNum)
                      ? pendingNum
                      : b.effectiveDurationMinutes;
                    const src = pendingNum !== null && !isNaN(pendingNum) ? 'مخصصة' :
                      b.durationSource === 'EMP_SERVICE_OVERRIDE' ? 'مخصصة' :
                      b.durationSource === 'SERVICE_DEFAULT' ? 'الافتراضية' : 'النظام';
                    return (
                      <TableRow key={b.empId} className="border-zinc-800">
                        <TableCell className="text-white font-medium">{b.empName}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min={5} max={240}
                              placeholder="—"
                              value={b.pendingValue}
                              onChange={e => {
                                const updated = [...barberDurItems];
                                updated[i] = { ...updated[i], pendingValue: e.target.value };
                                setBarberDurItems(updated);
                              }}
                              className="w-20 bg-zinc-800 border-zinc-700 text-white text-center h-8"
                            />
                            <span className="text-xs text-zinc-400">دقيقة</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-zinc-300 text-sm">{effective} دقيقة</TableCell>
                        <TableCell>
                          <Badge
                            variant={src === 'مخصصة' ? 'default' : 'secondary'}
                            className={`text-xs ${src === 'مخصصة' ? 'bg-amber-600/20 text-amber-300 border-amber-600/30' : 'bg-zinc-700 text-zinc-400'}`}
                          >
                            {src}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-xs text-zinc-500">
            مدة الخدمة الافتراضية تُستخدم إذا لم يتم تحديد مدة خاصة للصنايعي.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBarberDurModal(false)} className="border-zinc-700 hover:bg-zinc-800">إلغاء</Button>
            <Button onClick={saveBarberDurations} disabled={barberDurSaving} className="bg-amber-600 hover:bg-amber-700">
              {barberDurSaving ? <><Loader2 className="w-4 h-4 ml-2 animate-spin" />جاري الحفظ...</> : 'حفظ مدد الصنايعية'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PageHeader
        title="إدارة الخدمات والفئات"
        description="إدارة خدمات الصالون وتصنيفاتها — إضافة وتعديل وحذف الخدمات والفئات"
      >
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2 border-zinc-700 hover:bg-zinc-800"
            onClick={() => openCategoryModal()}
          >
            <FolderPlus className="w-4 h-4" />
            فئة جديدة
          </Button>
          <Button
            className="gap-2 bg-amber-600 hover:bg-amber-700"
            onClick={() => openServiceModal()}
          >
            <Plus className="w-4 h-4" />
            خدمة جديدة
          </Button>
        </div>
      </PageHeader>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard title="إجمالي الخدمات" value={totalServices} icon={<Scissors className="w-5 h-5" />} variant="default" />
        <KpiCard title="خدمات نشطة" value={activeServices} icon={<Scissors className="w-5 h-5" />} variant="primary" />
        <KpiCard title="إجمالي الفئات" value={totalCategories} icon={<FolderOpen className="w-5 h-5" />} variant="success" />
        <KpiCard title="متوسط السعر" value={`${avgPrice.toFixed(0)} جنيه`} icon={<Settings className="w-5 h-5" />} variant="warning" />
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-rose-500/30 bg-rose-500/5">
          <span className="text-sm text-rose-400">{error}</span>
          <button onClick={() => setError('')} className="text-rose-500 hover:text-rose-400">
            ×
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-zinc-400 w-4 h-4" />
          <Input
            placeholder="البحث عن خدمة..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pr-10 bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-400"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-zinc-400">الفئة:</label>
          {isClient ? (
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-48 bg-zinc-800 border-zinc-700 text-white">
                <SelectValue placeholder="جميع الفئات" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="all" className="text-white">جميع الفئات</SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat.CatID} value={cat.CatID.toString()} className="text-white">
                    {cat.CatName} ({cat.ServiceCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="w-48 h-10 bg-zinc-800 border-zinc-700 text-white flex items-center px-3 rounded">
              جميع الفئات
            </div>
          )}
        </div>
      </div>

      {/* Services Table */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40">
          <h3 className="text-sm font-semibold text-zinc-300">قائمة الخدمات</h3>
        </div>

        {loading ? (
          <div className="p-12 text-center text-zinc-500">
            <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin" />
            <p className="text-sm">جاري التحميل...</p>
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">
            <Scissors className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {searchTerm || selectedCategory ? 'لا توجد خدمات مطابقة للبحث' : 'لا توجد خدمات بعد'}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800">
                <TableHead className="text-right text-zinc-400">#</TableHead>
                <TableHead className="text-right text-zinc-400">الخدمة</TableHead>
                <TableHead className="text-right text-zinc-400 w-14">صورة</TableHead>
                <TableHead className="text-right text-zinc-400">الفئة</TableHead>
                <TableHead className="text-right text-zinc-400">السعر</TableHead>
                <TableHead className="text-right text-zinc-400">العمولة</TableHead>
                <TableHead className="text-right text-zinc-400">مدة الخدمة</TableHead>
                <TableHead className="text-right text-zinc-400">المبيعات</TableHead>
                <TableHead className="text-right text-zinc-400">الحالة</TableHead>
                <TableHead className="text-right text-zinc-400">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredServices.map((service) => (
                <TableRow key={service.ProID} className="border-zinc-800 hover:bg-zinc-800/30">
                  <TableCell className="text-zinc-500 font-mono text-xs">{service.ProID}</TableCell>
                  <TableCell>
                    <div>
                      <span className="font-medium text-white">{service.ProName}</span>
                      {service.ProNameAr && (
                        <div className="text-sm text-zinc-400 mt-1">{service.ProNameAr}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {service.ImageUrl ? (
                      <div className="h-10 w-10 rounded-md overflow-hidden border border-zinc-700 bg-zinc-800">
                        <img
                          src={service.ImageUrl}
                          alt={service.ProName}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="h-10 w-10 rounded-md border border-dashed border-zinc-700 bg-zinc-800/50 flex items-center justify-center">
                        <ImageIcon className="w-4 h-4 text-zinc-600" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <CategoryBadge name={service.CatName} size="sm" />
                  </TableCell>
                  <TableCell className="text-zinc-300">{service.SPrice1} جنيه</TableCell>
                  <TableCell className="text-zinc-300">{service.Bonus} جنيه</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={5} max={240}
                        placeholder="افتراضي"
                        value={durationEdits[service.ProID] ?? (service.DurationMinutes !== null && service.DurationMinutes !== undefined ? String(service.DurationMinutes) : '')}
                        onChange={e => setDurationEdits(prev => ({ ...prev, [service.ProID]: e.target.value }))}
                        className="w-20 h-7 text-xs bg-zinc-800 border-zinc-700 text-white text-center"
                      />
                      <span className="text-xs text-zinc-500">د</span>
                      {durationEdits[service.ProID] !== undefined && durationEdits[service.ProID] !== String(service.DurationMinutes ?? '') && (
                        <button
                          onClick={() => saveDurationMinutes(service)}
                          disabled={!!durationSaving[service.ProID]}
                          className="text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50"
                        >
                          {durationSaving[service.ProID] ? <Loader2 className="w-3 h-3 animate-spin" /> : '✓'}
                        </button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-zinc-300">{service.SalesCount}</TableCell>
                  <TableCell>
                    <Badge 
                      variant={service.isDeleted ? "destructive" : "default"}
                      className="text-xs"
                    >
                      {service.isDeleted ? "محذوفة" : "نشطة"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-zinc-800 border-zinc-700">
                        <DropdownMenuItem
                          onClick={() => openServiceModal(service)}
                          className="text-white hover:bg-zinc-700"
                        >
                          <Edit2 className="w-4 h-4 ml-2" />
                          تعديل
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => openBarberDurModal(service)}
                          className="text-amber-400 hover:bg-amber-500/10"
                        >
                          <Clock className="w-4 h-4 ml-2" />
                          تخصيص مدة الصنايعية
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => deleteService(service.ProID)}
                          className="text-rose-400 hover:bg-rose-500/10"
                        >
                          <Trash2 className="w-4 h-4 ml-2" />
                          حذف
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Categories Section */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-300">الفئات وترتيب العرض</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              الأسهم أو رقم الظهور (1 = أول فئة). اكتب الرقم ثم Enter أو اخرج من الحقل
              {reorderSaving ? ' — جاري الحفظ...' : ''}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-zinc-700 hover:bg-zinc-800 shrink-0"
            onClick={() => openCategoryModal()}
          >
            <FolderPlus className="w-4 h-4" />
            إضافة فئة
          </Button>
        </div>

        {categories.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">
            <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">لا توجد فئات بعد</p>
          </div>
        ) : (
          <div className="space-y-2 p-4">
            {sortedCategories.map((category, index, sorted) => {
              const theme = getCategoryTheme(category.CatName, category.CatID);
              const isFirst = index === 0;
              const isLast = index === sorted.length - 1;
              const positionValue =
                positionDrafts[category.CatID] !== undefined
                  ? positionDrafts[category.CatID]
                  : String(index + 1);
              return (
                <div
                  key={category.CatID}
                  className="rounded-xl p-3 transition-all duration-200"
                  style={theme.cardStyle}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isFirst || reorderSaving}
                          onClick={() => moveCategory(category.CatID, 'up')}
                          className="h-7 w-7 p-0 text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
                          title="تحريك لأعلى (يعرض أولاً)"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isLast || reorderSaving}
                          onClick={() => moveCategory(category.CatID, 'down')}
                          className="h-7 w-7 p-0 text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
                          title="تحريك لأسفل"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex flex-col items-center gap-0.5 shrink-0">
                        <span className="text-[10px] text-zinc-500">ترتيب</span>
                        <Input
                          type="number"
                          min={1}
                          max={sorted.length}
                          disabled={reorderSaving}
                          value={positionValue}
                          onChange={(e) =>
                            setPositionDrafts((prev) => ({
                              ...prev,
                              [category.CatID]: e.target.value,
                            }))
                          }
                          onBlur={() => setCategoryPosition(category.CatID, positionValue)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.currentTarget.blur();
                            }
                          }}
                          className="w-14 h-8 text-center bg-zinc-800 border-zinc-700 text-white text-sm font-mono px-1"
                          title={`اكتب رقم من 1 إلى ${sorted.length}`}
                          aria-label={`ترتيب ظهور ${category.CatName}`}
                        />
                      </div>
                      <div style={{ width: 4, alignSelf: 'stretch', borderRadius: '9999px', ...theme.dotStyle }} />
                      <div
                        style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, ...theme.iconStyle }}
                      >
                        {theme.emoji}
                      </div>
                      <div className="min-w-0">
                        <h4 style={{ fontWeight: 700, fontSize: 14, color: theme.color }}>{category.CatName}</h4>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          <span style={{ fontWeight: 600, color: theme.color }}>{category.ServiceCount}</span>
                          {' '}خدمة
                          <span className="text-zinc-600 mx-1">·</span>
                          موضع {index + 1} من {sorted.length}
                        </p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 opacity-50 hover:opacity-100 shrink-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-zinc-800 border-zinc-700">
                        <DropdownMenuItem
                          onClick={() => openCategoryModal(category)}
                          className="text-white hover:bg-zinc-700"
                        >
                          <Edit2 className="w-4 h-4 ml-2" />
                          تعديل
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => deleteCategory(category.CatID)}
                          className="text-rose-400 hover:bg-rose-500/10"
                        >
                          <Trash2 className="w-4 h-4 ml-2" />
                          حذف
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Service Modal */}
      <Dialog open={serviceModalOpen} onOpenChange={setServiceModalOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {editingService ? 'تعديل الخدمة' : 'خدمة جديدة'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="serviceName">اسم الخدمة *</Label>
              <Input
                id="serviceName"
                value={serviceFormData.ProName}
                onChange={(e) => setServiceFormData({...serviceFormData, ProName: e.target.value})}
                className="bg-zinc-800 border-zinc-700 text-white"
                placeholder="أدخل اسم الخدمة"
              />
            </div>
            <div>
              <Label htmlFor="serviceNameAr">اسم الخدمة بالعربي</Label>
              <Input
                id="serviceNameAr"
                value={serviceFormData.ProNameAr}
                onChange={(e) => setServiceFormData({...serviceFormData, ProNameAr: e.target.value})}
                className="bg-zinc-800 border-zinc-700 text-white"
                placeholder="أدخل اسم الخدمة بالعربي"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="price">السعر *</Label>
                <Input
                  id="price"
                  type="number"
                  value={serviceFormData.SPrice1}
                  onChange={(e) => setServiceFormData({...serviceFormData, SPrice1: parseFloat(e.target.value) || 0})}
                  className="bg-zinc-800 border-zinc-700 text-white"
                  placeholder="0"
                />
              </div>
              <div>
                <Label htmlFor="bonus">العمولة</Label>
                <Input
                  id="bonus"
                  type="number"
                  value={serviceFormData.Bonus}
                  onChange={(e) => setServiceFormData({...serviceFormData, Bonus: parseFloat(e.target.value) || 0})}
                  className="bg-zinc-800 border-zinc-700 text-white"
                  placeholder="0"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="category">الفئة</Label>
              {isClient ? (
                <Select 
                  value={serviceFormData.CatID?.toString() || 'none'} 
                  onValueChange={(value) => setServiceFormData({...serviceFormData, CatID: value === 'none' ? null : parseInt(value)})}
                >
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white">
                    <SelectValue placeholder="اختر الفئة" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="none" className="text-white">بدون فئة</SelectItem>
                    {categories.map(cat => (
                      <SelectItem key={cat.CatID} value={cat.CatID.toString()} className="text-white">
                        {cat.CatName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="w-full h-10 bg-zinc-800 border-zinc-700 text-white flex items-center px-3 rounded">
                  اختر الفئة
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="imageUrl">رابط الصورة</Label>
                {serviceFormData.ImageUrl.trim() && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setServiceFormData({ ...serviceFormData, ImageUrl: '' })}
                    className="h-7 px-2 text-xs text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10"
                  >
                    <X className="w-3.5 h-3.5 ml-1" />
                    مسح الصورة
                  </Button>
                )}
              </div>
              <Input
                id="imageUrl"
                value={serviceFormData.ImageUrl}
                onChange={(e) => setServiceFormData({ ...serviceFormData, ImageUrl: e.target.value })}
                className="bg-zinc-800 border-zinc-700 text-white"
                placeholder="/services/haircut.jpg أو رابط خارجي"
                dir="ltr"
              />
              <p className="text-xs text-zinc-500">
                أدخل مسارًا محليًا مثل <span dir="ltr" className="font-mono text-zinc-400">/services/haircut.jpg</span> أو رابطًا خارجيًا.
              </p>

              {serviceFormData.ImageUrl.trim() ? (
                <div className="rounded-lg border border-zinc-700 overflow-hidden bg-zinc-800/50">
                  <div className="px-3 py-2 border-b border-zinc-700 text-xs text-zinc-400">معاينة الصورة</div>
                  <div className="relative h-36 bg-zinc-900">
                    <img
                      src={serviceFormData.ImageUrl.trim()}
                      alt="معاينة صورة الخدمة"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <div className="px-3 py-2 text-xs text-zinc-500 font-mono truncate" dir="ltr">
                    {serviceFormData.ImageUrl.trim()}
                  </div>
                </div>
              ) : (
                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-800/30 text-zinc-500">
                  <div className="flex flex-col items-center gap-1 text-xs">
                    <ImageIcon className="w-5 h-5 opacity-50" />
                    <span>لا توجد صورة محددة</span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">اختيار سريع من الصور المتاحة</Label>
                <div className="grid grid-cols-4 gap-2">
                  {SERVICE_IMAGE_PRESETS.map((preset) => {
                    const isSelected = serviceFormData.ImageUrl.trim() === preset.path;
                    return (
                      <button
                        key={preset.path}
                        type="button"
                        title={preset.label}
                        onClick={() => setServiceFormData({ ...serviceFormData, ImageUrl: preset.path })}
                        className={`group relative overflow-hidden rounded-lg border transition-all ${
                          isSelected
                            ? 'border-amber-500 ring-1 ring-amber-500/50'
                            : 'border-zinc-700 hover:border-zinc-500'
                        }`}
                      >
                        <div className="aspect-4/3 bg-zinc-800">
                          <img
                            src={preset.path}
                            alt={preset.label}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-[9px] text-white truncate">
                          {preset.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="active"
                checked={serviceFormData.isActive}
                onCheckedChange={(checked) => setServiceFormData({...serviceFormData, isActive: checked})}
              />
              <Label htmlFor="active">خدمة نشطة</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button
              variant="outline"
              onClick={() => setServiceModalOpen(false)}
              className="border-zinc-700 hover:bg-zinc-800"
            >
              إلغاء
            </Button>
            <Button
              onClick={saveService}
              disabled={serviceSaving}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {serviceSaving ? (
                <>
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  جاري الحفظ...
                </>
              ) : (
                editingService ? 'تحديث' : 'إضافة'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Category Modal */}
      <Dialog open={categoryModalOpen} onOpenChange={setCategoryModalOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {editingCategory ? 'تعديل الفئة' : 'فئة جديدة'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="categoryName">اسم الفئة *</Label>
              <Input
                id="categoryName"
                value={categoryFormData.CatName}
                onChange={(e) => setCategoryFormData({...categoryFormData, CatName: e.target.value})}
                className="bg-zinc-800 border-zinc-700 text-white"
                placeholder="أدخل اسم الفئة"
              />
            </div>
            <div>
              <Label htmlFor="categoryDescription">الوصف</Label>
              <Textarea
                id="categoryDescription"
                value={categoryFormData.Description}
                onChange={(e) => setCategoryFormData({...categoryFormData, Description: e.target.value})}
                className="bg-zinc-800 border-zinc-700 text-white"
                placeholder="وصف الفئة (اختياري)"
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="categoryActive"
                checked={categoryFormData.isActive}
                onCheckedChange={(checked) => setCategoryFormData({...categoryFormData, isActive: checked})}
              />
              <Label htmlFor="categoryActive">فئة نشطة</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Button
              variant="outline"
              onClick={() => setCategoryModalOpen(false)}
              className="border-zinc-700 hover:bg-zinc-800"
            >
              إلغاء
            </Button>
            <Button
              onClick={saveCategory}
              disabled={categorySaving}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {categorySaving ? (
                <>
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  جاري الحفظ...
                </>
              ) : (
                editingCategory ? 'تحديث' : 'إضافة'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
