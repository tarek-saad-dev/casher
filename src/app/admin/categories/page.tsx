'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Tags, Plus, Edit2, Trash2, Loader2, TrendingDown, TrendingUp, X, Check,
  ToggleLeft, ToggleRight, Filter,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
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

interface FinanceCategory {
  ExpINID: number;
  CatName: string;
  ExpINType: string;
  IsActive: boolean | number;
}

const TYPE_EXPENSE = 'مصروفات';
const TYPE_INCOME  = 'ايرادات';

export default function CategoriesPage() {
  const [categories,  setCategories]  = useState<FinanceCategory[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [tab,         setTab]         = useState<'مصروفات' | 'ايرادات'>('مصروفات');

  const [modalOpen,   setModalOpen]   = useState(false);
  const [editing,     setEditing]     = useState<FinanceCategory | null>(null);
  const [formName,    setFormName]    = useState('');
  const [formType,    setFormType]    = useState<string>(TYPE_EXPENSE);
  const [saving,      setSaving]      = useState(false);
  const [modalError,  setModalError]  = useState('');
  const [deleting,    setDeleting]    = useState<number | null>(null);
  const [toggling,    setToggling]    = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch('/api/finance/categories');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'خطأ في تحميل الفئات');
      setCategories(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setFormName('');
    setFormType(tab);
    setModalError('');
    setModalOpen(true);
  };

  const openEdit = (cat: FinanceCategory) => {
    setEditing(cat);
    setFormName(cat.CatName);
    setFormType(cat.ExpINType);
    setModalError('');
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      setModalError('اسم الفئة مطلوب');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const url    = editing ? `/api/finance/categories/${editing.ExpINID}` : '/api/finance/categories';
      const method = editing ? 'PUT' : 'POST';
      const res    = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ CatName: formName.trim(), ExpINType: formType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحفظ');
      setModalOpen(false);
      await load();
    } catch (e: any) {
      setModalError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cat: FinanceCategory) => {
    if (!confirm(`هل تريد حذف الفئة "${cat.CatName}"؟`)) return;
    setDeleting(cat.ExpINID);
    setError('');
    try {
      const res  = await fetch(`/api/finance/categories/${cat.ExpINID}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الحذف');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleStatus = async (cat: FinanceCategory) => {
    const newActive = !cat.IsActive;
    const confirmMsg = newActive
      ? `سيتم تفعيل تصنيف "${cat.CatName}" وإعادة ظهوره في شاشات الإضافة. هل تريد المتابعة؟`
      : `سيتم إخفاء تصنيف "${cat.CatName}" من شاشات الإضافة الجديدة، لكنه سيظل ظاهرًا في التقارير والحركات القديمة. هل تريد المتابعة؟`;
    if (!confirm(confirmMsg)) return;
    setToggling(cat.ExpINID);
    setError('');
    try {
      const res = await fetch(`/api/finance/categories/${cat.ExpINID}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: newActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل التحديث');
      // Optimistic update
      setCategories(prev =>
        prev.map(c => c.ExpINID === cat.ExpINID ? { ...c, IsActive: data.IsActive } : c)
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setToggling(null);
    }
  };

  const allOfTab     = categories.filter(c => c.ExpINType === tab);
  const displayed    = allOfTab.filter(c => {
    if (statusFilter === 'active')   return c.IsActive;
    if (statusFilter === 'inactive') return !c.IsActive;
    return true;
  });
  const expenseCount = categories.filter(c => c.ExpINType === TYPE_EXPENSE).length;
  const incomeCount  = categories.filter(c => c.ExpINType === TYPE_INCOME).length;
  const activeCount  = allOfTab.filter(c => c.IsActive).length;
  const inactiveCount = allOfTab.filter(c => !c.IsActive).length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" dir="rtl">
      <PageHeader
        title="تصنيفات الإيرادات والمصروفات"
        description="إدارة فئات TblExpINCat — المصروفات والإيرادات"
      >
        <Button className="gap-2 bg-amber-600 hover:bg-amber-700" onClick={openCreate}>
          <Plus className="w-4 h-4" />
          تصنيف جديد
        </Button>
      </PageHeader>

      {/* Type tabs */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setTab('مصروفات')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors
              ${tab === 'مصروفات'
                ? 'bg-rose-600/20 border-rose-500/50 text-rose-300'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
          >
            <TrendingDown className="w-4 h-4" />
            مصروفات ({expenseCount})
          </button>
          <button
            onClick={() => setTab('ايرادات')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors
              ${tab === 'ايرادات'
                ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
          >
            <TrendingUp className="w-4 h-4" />
            إيرادات ({incomeCount})
          </button>
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1.5 text-xs">
          <Filter className="w-3.5 h-3.5 text-zinc-500" />
          {(['all', 'active', 'inactive'] as const).map(f => (
            <button key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 rounded-lg border transition-colors font-medium ${
                statusFilter === f
                  ? f === 'active'
                    ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
                    : f === 'inactive'
                      ? 'bg-zinc-700/60 border-zinc-600 text-zinc-300'
                      : 'bg-zinc-700/60 border-zinc-600 text-zinc-300'
                  : 'border-zinc-800 text-zinc-500 hover:border-zinc-700'
              }`}
            >
              {f === 'all' ? `الكل (${allOfTab.length})` : f === 'active' ? `نشط (${activeCount})` : `متوقف (${inactiveCount})`}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-rose-500/30 bg-rose-500/5 text-rose-400 text-sm">
          <X className="w-4 h-4 shrink-0" />
          {error}
          <button onClick={() => setError('')} className="mr-auto opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-zinc-500 gap-3">
          <Loader2 className="w-6 h-6 animate-spin" />
          جاري التحميل...
        </div>
      ) : displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-600">
          <Tags className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-sm">لا توجد فئات {tab} بعد</p>
          <Button size="sm" className="mt-4 bg-amber-600 hover:bg-amber-700" onClick={openCreate}>
            <Plus className="w-4 h-4 ml-1" />
            إضافة فئة
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {displayed.map(cat => {
            const isActive = !!cat.IsActive;
            return (
              <div key={cat.ExpINID}
                className={`flex flex-col gap-2 rounded-xl px-4 py-3 border transition-colors ${
                  isActive
                    ? 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
                    : 'bg-zinc-950/40 border-zinc-800/50 opacity-60 hover:opacity-80'
                }`}>
                {/* Top row: name + id */}
                <div className="flex items-center gap-3 min-w-0">
                  <Tags className={`w-4 h-4 shrink-0 ${ isActive ? 'text-zinc-500' : 'text-zinc-600' }`} />
                  <span className="text-sm font-medium text-white truncate flex-1">{cat.CatName}</span>
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${
                    cat.ExpINType === TYPE_EXPENSE
                      ? 'border-rose-500/40 text-rose-400'
                      : 'border-emerald-500/40 text-emerald-400'
                  }`}>
                    #{cat.ExpINID}
                  </Badge>
                </div>

                {/* Bottom row: status badge + actions */}
                <div className="flex items-center justify-between">
                  {/* Status badge */}
                  <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                    isActive
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-zinc-700/30 border-zinc-700 text-zinc-500'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${ isActive ? 'bg-emerald-400' : 'bg-zinc-600' }`} />
                    {isActive ? 'نشط' : 'متوقف'}
                  </span>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1">
                    {/* Toggle active/inactive */}
                    <Button
                      variant="ghost" size="sm"
                      className={`h-7 px-2 text-xs gap-1 ${
                        isActive
                          ? 'text-zinc-400 hover:text-amber-400 hover:bg-amber-400/10'
                          : 'text-zinc-500 hover:text-emerald-400 hover:bg-emerald-400/10'
                      }`}
                      onClick={() => handleToggleStatus(cat)}
                      disabled={toggling === cat.ExpINID}
                      title={isActive ? 'إيقاف التصنيف' : 'تفعيل التصنيف'}
                    >
                      {toggling === cat.ExpINID
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : isActive
                          ? <><ToggleRight className="w-3.5 h-3.5" /><span>إيقاف</span></>
                          : <><ToggleLeft  className="w-3.5 h-3.5" /><span>تفعيل</span></>
                      }
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-400 hover:text-amber-400"
                      onClick={() => openEdit(cat)}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-400 hover:text-rose-400"
                      onClick={() => handleDelete(cat)}
                      disabled={deleting === cat.ExpINID}>
                      {deleting === cat.ExpINID
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />
                      }
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-700 text-white max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? 'تعديل الفئة' : 'فئة جديدة'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="catName" className="text-zinc-300">اسم الفئة *</Label>
              <Input
                id="catName"
                value={formName}
                onChange={e => { setFormName(e.target.value); setModalError(''); }}
                className="bg-zinc-800 border-zinc-700 text-white mt-1"
                placeholder="مثال: إيجار، كهرباء، مرتبات..."
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="catType" className="text-zinc-300">النوع *</Label>
              <Select value={formType} onValueChange={setFormType}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-white mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  <SelectItem value={TYPE_EXPENSE} className="text-rose-300">مصروفات</SelectItem>
                  <SelectItem value={TYPE_INCOME}  className="text-emerald-300">ايرادات</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {modalError && (
              <p className="text-sm text-rose-400 flex items-center gap-1">
                <X className="w-3.5 h-3.5" />{modalError}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" className="border-zinc-700" onClick={() => setModalOpen(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button
              className={editing ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}
              onClick={handleSave}
              disabled={saving}
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin ml-1" />جاري الحفظ...</>
                : <><Check className="w-4 h-4 ml-1" />{editing ? 'حفظ التعديل' : 'إضافة'}</>
              }
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
