'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle, CreditCard, Download, FileQuestion,
  Loader2, RefreshCw, Save, Search, ShieldAlert, TrendingUp,
  Wallet, X, CheckSquare, ChevronLeft, ChevronRight,
  BarChart3, FileSpreadsheet, Filter,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import KpiCard from '@/components/shared/KpiCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

interface Transaction {
  ID: number; invID: number; invDate: string; invTime: string;
  invType: 'ايرادات' | 'مصروفات'; CategoryName: string | null;
  GrandTolal: number; Notes: string | null; UserName: string | null;
  possibleCause: string; causeConfidence: 'high' | 'medium' | 'low';
}

interface SummaryStats {
  totalCount: number; totalRevenueCount: number; totalExpenseCount: number;
  totalRevenueAmount: number; totalExpenseAmount: number; totalAmount: number;
  percentageOfAllTransactions: number;
}

interface PaymentMethod { ID: number; Name: string; }
interface Category { ExpINID: number; CatName: string; ExpINType: string; }

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const styles = { high: 'bg-emerald-500/10 text-emerald-400', medium: 'bg-amber-500/10 text-amber-400', low: 'bg-zinc-500/10 text-zinc-400' };
  const labels = { high: 'مرتفع', medium: 'متوسط', low: 'منخفض' };
  return <Badge variant="outline" className={cn('text-xs', styles[confidence])}>{labels[confidence]}</Badge>;
}

function TypeBadge({ type }: { type: 'ايرادات' | 'مصروفات' }) {
  const styles = { ايرادات: 'bg-emerald-500/10 text-emerald-400', مصروفات: 'bg-rose-500/10 text-rose-400' };
  return <Badge variant="outline" className={cn('text-xs font-medium', styles[type])}>{type}</Badge>;
}

export default function UnspecifiedPaymentMethodsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [filters, setFilters] = useState({ type: '', fromDate: '', toDate: '', categoryId: '', search: '' });
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [bulkPaymentMethodId, setBulkPaymentMethodId] = useState<string>('');
  const [updating, setUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState<string | null>(null);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [diagnosticData, setDiagnosticData] = useState<any>(null);
  const [loadingDiagnostic, setLoadingDiagnostic] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('limit', limit.toString());
      params.set('includeOnly', 'true');
      if (filters.type) params.set('type', filters.type);
      if (filters.fromDate) params.set('fromDate', filters.fromDate);
      if (filters.toDate) params.set('toDate', filters.toDate);
      if (filters.categoryId) params.set('categoryId', filters.categoryId);
      if (filters.search) params.set('search', filters.search);
      const response = await fetch(`/api/audit/unspecified-payment-methods?${params.toString()}`);
      if (!response.ok) throw new Error('فشل في تحميل البيانات');
      const data = await response.json();
      setTransactions(data.transactions);
      setSummary(data.summary);
      setTotalPages(data.pagination.totalPages);
      setTotalCount(data.pagination.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, limit, filters]);

  useEffect(() => {
    const loadLookups = async () => {
      try {
        const [pmRes, catRes] = await Promise.all([
          fetch('/api/payment-methods'),
          fetch('/api/finance/categories'),
        ]);
        if (pmRes.ok) setPaymentMethods(await pmRes.json());
        if (catRes.ok) setCategories(await catRes.json());
      } catch {}
    };
    loadLookups();
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleSelect = (id: number) => {
    const newSet = new Set(selectedIds);
    newSet.has(id) ? newSet.delete(id) : newSet.add(id);
    setSelectedIds(newSet);
    setSelectAll(newSet.size === transactions.length);
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(transactions.map(t => t.ID)));
    }
    setSelectAll(!selectAll);
  };

  const handleBulkUpdate = async () => {
    if (!bulkPaymentMethodId || selectedIds.size === 0) return;
    setUpdating(true);
    setUpdateSuccess(null);
    try {
      const response = await fetch('/api/audit/unspecified-payment-methods/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), paymentMethodId: parseInt(bulkPaymentMethodId), reason: 'تم التصحيح من لوحة التحكم' }),
      });
      if (!response.ok) throw new Error('فشل في التحديث');
      const result = await response.json();
      setUpdateSuccess(`تم تحديث ${result.updatedCount} معاملة`);
      setSelectedIds(new Set());
      setSelectAll(false);
      loadData();
      setTimeout(() => setUpdateSuccess(null), 5000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  // Fix ALL unspecified to Cash
  const handleFixAllToCash = async () => {
    if (!confirm(`سيتم تحديث جميع المعاملات غير المحددة (${summary?.totalCount || 0}) إلى طريقة الدفع "كاش".\nهل أنت متأكد؟`)) {
      return;
    }
    
    setUpdating(true);
    setUpdateSuccess(null);
    setError(null);
    
    try {
      const response = await fetch('/api/audit/unspecified-payment-methods/fix-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'تحويل جميع المعاملات إلى كاش - يوميات الموظفين' }),
      });
      
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'فشل في التحديث');
      }
      
      const result = await response.json();
      setUpdateSuccess(`تم تحديث ${result.updatedCount} معاملة إلى "كاش" بنجاح`);
      setSelectedIds(new Set());
      setSelectAll(false);
      loadData();
      setTimeout(() => setUpdateSuccess(null), 5000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  const handleSingleUpdate = async (id: number, paymentMethodId: number) => {
    setUpdating(true);
    try {
      await fetch('/api/audit/unspecified-payment-methods/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, paymentMethodId, reason: 'تم التصحيح يدوياً' }),
      });
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  const exportToCSV = () => {
    const headers = ['ID', 'Date', 'Type', 'Amount', 'Category', 'Description', 'Created By', 'Possible Cause'];
    const rows = transactions.map(t => [t.ID, t.invDate, t.invType, t.GrandTolal, t.CategoryName, t.Notes || '', t.UserName || '', t.possibleCause]);
    const csv = [headers.join(','), ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `unspecified-payments-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const loadDiagnosticReport = async () => {
    setLoadingDiagnostic(true);
    try {
      const response = await fetch('/api/audit/diagnostic-report');
      if (!response.ok) throw new Error('فشل في تحميل التقرير');
      setDiagnosticData(await response.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingDiagnostic(false);
    }
  };

  const resetFilters = () => {
    setFilters({ type: '', fromDate: '', toDate: '', categoryId: '', search: '' });
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-[#050505] p-4 md:p-6" dir="rtl">
      <PageHeader title="طرق الدفع غير المحددة" description="تدقيق وتصحيح المعاملات بدون طريقة دفع">
        <div className="flex items-center gap-2">
          {summary && summary.totalCount > 0 && (
            <Button 
              variant="default" 
              size="sm" 
              onClick={handleFixAllToCash}
              disabled={updating}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {updating ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <CheckSquare className="w-4 h-4 ml-2" />}
              تحويل الكل لكاش
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { setShowDiagnostic(true); loadDiagnosticReport(); }} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            <FileQuestion className="w-4 h-4 ml-2" />تقرير التحليل
          </Button>
          <Button variant="outline" size="sm" onClick={exportToCSV} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            <FileSpreadsheet className="w-4 h-4 ml-2" />تصدير
          </Button>
          <Button variant="outline" size="sm" onClick={loadData} className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            <RefreshCw className={cn('w-4 h-4 ml-2', loading && 'animate-spin')} />تحديث
          </Button>
        </div>
      </PageHeader>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-rose-400" />
          <p className="text-rose-400 text-sm">{error}</p>
          <Button variant="ghost" size="sm" onClick={() => setError(null)} className="mr-auto text-rose-400"><X className="w-4 h-4" /></Button>
        </div>
      )}

      {updateSuccess && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3">
          <CheckSquare className="w-5 h-5 text-emerald-400" />
          <p className="text-emerald-400 text-sm">{updateSuccess}</p>
          <Button variant="ghost" size="sm" onClick={() => setUpdateSuccess(null)} className="mr-auto text-emerald-400"><X className="w-4 h-4" /></Button>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard title="المعاملات غير المحددة" value={summary.totalCount.toLocaleString()} subtitle={`${summary.percentageOfAllTransactions.toFixed(2)}% من الإجمالي`} icon={<AlertTriangle className="w-5 h-5" />} variant="warning" />
          <KpiCard title="إيرادات غير محددة" value={summary.totalRevenueCount.toLocaleString()} subtitle={`${summary.totalRevenueAmount.toLocaleString()} ج.م`} icon={<Wallet className="w-5 h-5" />} variant="danger" />
          <KpiCard title="مصروفات غير محددة" value={summary.totalExpenseCount.toLocaleString()} subtitle={`${summary.totalExpenseAmount.toLocaleString()} ج.م`} icon={<CreditCard className="w-5 h-5" />} variant="danger" />
          <KpiCard title="إجمالي المتأثر" value={`${summary.totalAmount.toLocaleString()} ج.م`} subtitle="يحتاج تصحيح" icon={<TrendingUp className="w-5 h-5" />} variant="primary" />
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="mb-6 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 flex flex-wrap items-center gap-4">
          <span className="text-sm text-amber-400 font-medium">تم اختيار {selectedIds.size} معاملة</span>
          <div className="flex-1" />
          <Select value={bulkPaymentMethodId} onValueChange={setBulkPaymentMethodId}>
            <SelectTrigger className="w-48 bg-zinc-900 border-zinc-700 text-white"><SelectValue placeholder="اختر طريقة الدفع" /></SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              {paymentMethods.map(pm => <SelectItem key={pm.ID} value={pm.ID.toString()} className="text-white">{pm.Name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={handleBulkUpdate} disabled={!bulkPaymentMethodId || updating} className="bg-amber-500 hover:bg-amber-600 text-black">
            {updating ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Save className="w-4 h-4 ml-2" />}تحديث
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setSelectedIds(new Set()); setSelectAll(false); }} className="text-zinc-400">إلغاء</Button>
        </div>
      )}

      <div className="mb-6 p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/50">
        <div className="flex items-center gap-2 mb-4 text-zinc-400">
          <Filter className="w-4 h-4" /><span className="text-sm font-medium">الفلاتر</span>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="mr-auto text-xs text-zinc-500">إعادة ضبط</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <Input placeholder="بحث..." value={filters.search} onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))} className="pr-10 bg-zinc-900 border-zinc-700 text-white" />
          </div>
          <Select value={filters.type} onValueChange={(v) => setFilters(f => ({ ...f, type: v }))}>
            <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white"><SelectValue placeholder="نوع المعاملة" /></SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              <SelectItem value="all" className="text-white">الكل</SelectItem>
              <SelectItem value="revenue" className="text-white">إيرادات</SelectItem>
              <SelectItem value="expense" className="text-white">مصروفات</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.categoryId} onValueChange={(v) => setFilters(f => ({ ...f, categoryId: v }))}>
            <SelectTrigger className="bg-zinc-900 border-zinc-700 text-white"><SelectValue placeholder="الفئة" /></SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700 max-h-60">
              <SelectItem value="all" className="text-white">جميع الفئات</SelectItem>
              {categories.map(cat => <SelectItem key={cat.ExpINID} value={cat.ExpINID.toString()} className="text-white">{cat.CatName}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" placeholder="من تاريخ" value={filters.fromDate} onChange={(e) => setFilters(f => ({ ...f, fromDate: e.target.value }))} className="bg-zinc-900 border-zinc-700 text-white" />
          <Input type="date" placeholder="إلى تاريخ" value={filters.toDate} onChange={(e) => setFilters(f => ({ ...f, toDate: e.target.value }))} className="bg-zinc-900 border-zinc-700 text-white" />
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800/50 overflow-hidden bg-zinc-900/30">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="w-12 py-4"><Checkbox checked={selectAll} onCheckedChange={toggleSelectAll} className="border-zinc-600" /></TableHead>
                <TableHead className="text-zinc-400 font-medium">التاريخ</TableHead>
                <TableHead className="text-zinc-400 font-medium">النوع</TableHead>
                <TableHead className="text-zinc-400 font-medium">المبلغ</TableHead>
                <TableHead className="text-zinc-400 font-medium">الفئة</TableHead>
                <TableHead className="text-zinc-400 font-medium">الوصف</TableHead>
                <TableHead className="text-zinc-400 font-medium">المنشئ</TableHead>
                <TableHead className="text-zinc-400 font-medium">السبب المحتمل</TableHead>
                <TableHead className="text-zinc-400 font-medium">الثقة</TableHead>
                <TableHead className="text-zinc-400 font-medium">طريقة الدفع</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={10} className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-zinc-500" /><p className="mt-4 text-sm text-zinc-500">جاري التحميل...</p></TableCell></TableRow>
              ) : transactions.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="py-16 text-center"><div className="flex flex-col items-center gap-3"><CheckSquare className="w-12 h-12 text-emerald-500/50" /><p className="text-zinc-400">لا توجد معاملات غير محددة</p></div></TableCell></TableRow>
              ) : (
                transactions.map((t) => (
                  <TableRow key={t.ID} className={cn('border-zinc-800 hover:bg-zinc-800/50', selectedIds.has(t.ID) && 'bg-amber-500/5')}>
                    <TableCell className="py-4"><Checkbox checked={selectedIds.has(t.ID)} onCheckedChange={() => toggleSelect(t.ID)} className="border-zinc-600" /></TableCell>
                    <TableCell className="text-white"><div className="flex flex-col"><span>{t.invDate}</span><span className="text-xs text-zinc-500">{t.invTime}</span></div></TableCell>
                    <TableCell><TypeBadge type={t.invType} /></TableCell>
                    <TableCell className="font-medium text-white">{t.GrandTolal.toLocaleString()} ج.م</TableCell>
                    <TableCell className="text-zinc-300">{t.CategoryName}</TableCell>
                    <TableCell className="text-zinc-400 max-w-xs truncate">{t.Notes || '-'}</TableCell>
                    <TableCell className="text-zinc-300">{t.UserName || 'غير معروف'}</TableCell>
                    <TableCell className="max-w-xs"><p className="text-xs text-zinc-400 leading-relaxed" title={t.possibleCause}>{t.possibleCause}</p></TableCell>
                    <TableCell><ConfidenceBadge confidence={t.causeConfidence} /></TableCell>
                    <TableCell>
                      <Select onValueChange={(v) => handleSingleUpdate(t.ID, parseInt(v))}>
                        <SelectTrigger className="w-32 h-8 text-xs bg-zinc-800 border-zinc-700 text-white"><SelectValue placeholder="اختر" /></SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-zinc-700">
                          {paymentMethods.map(pm => <SelectItem key={pm.ID} value={pm.ID.toString()} className="text-white text-xs">{pm.Name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!loading && transactions.length > 0 && (
          <div className="flex items-center justify-between p-4 border-t border-zinc-800">
            <span className="text-sm text-zinc-500">عرض {((page - 1) * limit) + 1} - {Math.min(page * limit, totalCount)} من {totalCount}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="border-zinc-700 text-zinc-300"><ChevronRight className="w-4 h-4" /></Button>
              <span className="text-sm text-zinc-500 px-3">صفحة {page} من {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="border-zinc-700 text-zinc-300"><ChevronLeft className="w-4 h-4" /></Button>
            </div>
          </div>
        )}
      </div>

      {/* Diagnostic Report Modal */}
      <Dialog open={showDiagnostic} onOpenChange={setShowDiagnostic}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-zinc-900 border-zinc-700" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-amber-400" />
              تقرير التحليل التشخيصي
            </DialogTitle>
          </DialogHeader>

          {loadingDiagnostic ? (
            <div className="py-12 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-zinc-500" /><p className="mt-4 text-zinc-400">جاري تحميل التقرير...</p></div>
          ) : diagnosticData ? (
            <div className="space-y-6">
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-zinc-800/50"><p className="text-xs text-zinc-500">المعاملات المفحوصة</p><p className="text-xl font-bold text-white">{diagnosticData.summary.totalTransactionsScanned.toLocaleString()}</p></div>
                <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/20"><p className="text-xs text-rose-400">غير محددة</p><p className="text-xl font-bold text-rose-400">{diagnosticData.summary.unspecifiedCount.toLocaleString()}</p></div>
                <div className="p-4 rounded-lg bg-zinc-800/50"><p className="text-xs text-zinc-500">النسبة</p><p className="text-xl font-bold text-white">{diagnosticData.summary.unspecifiedPercentage.toFixed(2)}%</p></div>
                <div className="p-4 rounded-lg bg-zinc-800/50"><p className="text-xs text-zinc-500">أقدم تاريخ</p><p className="text-sm font-bold text-white">{diagnosticData.summary.earliestUnspecifiedDate || 'N/A'}</p></div>
              </div>

              {/* Root Cause */}
              <div className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <h3 className="text-amber-400 font-medium mb-2">السبب الجذري الرئيسي</h3>
                <p className="text-white">{diagnosticData.rootCauseAnalysis.primaryCause}</p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-sm text-zinc-400">الثقة:</span>
                  <ConfidenceBadge confidence={diagnosticData.rootCauseAnalysis.confidence} />
                </div>
              </div>

              {/* Contributing Factors */}
              {diagnosticData.rootCauseAnalysis.contributingFactors.length > 0 && (
                <div>
                  <h3 className="text-zinc-400 text-sm font-medium mb-2">العوامل المساهمة</h3>
                  <ul className="space-y-1">
                    {diagnosticData.rootCauseAnalysis.contributingFactors.map((factor: string, i: number) => (
                      <li key={i} className="text-sm text-zinc-300 flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />{factor}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recommendations */}
              <div className="space-y-3">
                <h3 className="text-zinc-400 text-sm font-medium">التوصيات</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg bg-rose-500/5 border border-rose-500/20">
                    <p className="text-xs text-rose-400 font-medium mb-2">فورية</p>
                    <ul className="space-y-1">
                      {diagnosticData.recommendations.immediate.map((r: string, i: number) => <li key={i} className="text-xs text-zinc-300">• {r}</li>)}
                    </ul>
                  </div>
                  <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                    <p className="text-xs text-amber-400 font-medium mb-2">قصيرة المدى</p>
                    <ul className="space-y-1">
                      {diagnosticData.recommendations.shortTerm.map((r: string, i: number) => <li key={i} className="text-xs text-zinc-300">• {r}</li>)}
                    </ul>
                  </div>
                  <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                    <p className="text-xs text-emerald-400 font-medium mb-2">طويلة المدى</p>
                    <ul className="space-y-1">
                      {diagnosticData.recommendations.longTerm.map((r: string, i: number) => <li key={i} className="text-xs text-zinc-300">• {r}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
