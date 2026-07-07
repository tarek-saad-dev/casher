'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Beaker, Database, Loader2, Play, RefreshCw, Save, Search, Settings2, Tags, Users,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

const FLOW_GROUPS = ['sales','operating','payroll','employee_advance','tips','transfer','capital','other_income','unclassified'];
const FLOW_KINDS = ['sales_revenue','operating_expense','salary_payout','salary_deduction','bonus_or_commission_payout','employee_advance','employee_advance_out','employee_advance_repayment','employee_final_settlement','tips_collected','internal_transfer','partner_capital_in','loan_to_business','misc_income','unknown'];
const PNL = ['revenue','expense','contra_expense','none'];
const PARTY = ['customer','employee','partner','partner_or_person','internal','unknown','none','employee_or_unknown'];
const CONF = ['high','medium','low'];

interface CategoryRow {
  expInId: number;
  catName: string;
  expInType: string;
  mapping: {
    flowGroup: string; flowKind: string; pnlImpact: string; partyType: string;
    requiresEmployee: boolean; needsReviewByDefault: boolean; confidence: string; notes: string | null;
  } | null;
}

export default function ClassificationSettingsPage() {
  const [tab, setTab] = useState('categories');
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tablesExist, setTablesExist] = useState(false);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [search, setSearch] = useState('');
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editMap, setEditMap] = useState({
    flowGroup: 'operating', flowKind: 'operating_expense', pnlImpact: 'expense',
    partyType: 'none', requiresEmployee: false, needsReviewByDefault: false, confidence: 'high',
  });

  const [keywordRules, setKeywordRules] = useState<any[]>([]);
  const [aliases, setAliases] = useState<any[]>([]);
  const [employees, setEmployees] = useState<{ empId: number; empName: string }[]>([]);
  const [newAlias, setNewAlias] = useState({ empId: '', aliasText: '' });

  const [preview, setPreview] = useState({
    invType: 'مصروفات', inOut: 'out', categoryName: '', notes: '', amount: '100',
  });
  const [previewResult, setPreviewResult] = useState<any>(null);

  const [impact, setImpact] = useState<any>(null);
  const [impactDates, setImpactDates] = useState({ from: '', to: '' });

  const runMigrate = async () => {
    setMigrating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/accounting/classification-settings/migrate', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.sqlError?.message ?? data.error ?? 'فشل الترحيل';
        throw new Error(detail);
      }
      setTablesExist(!!data.tablesExist);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'فشل');
    } finally {
      setMigrating(false);
    }
  };

  const loadCategories = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (unmappedOnly) params.set('unmappedOnly', 'true');
    const res = await fetch(`/api/admin/accounting/classification-settings/category-mappings?${params}`);
    const data = await res.json();
    if (res.ok) setCategories(data.rows);
  }, [search, unmappedOnly]);

  const loadKeywords = async () => {
    const res = await fetch('/api/admin/accounting/classification-settings/keyword-rules');
    const data = await res.json();
    if (res.ok) setKeywordRules(data.rules);
  };

  const loadAliases = async () => {
    const res = await fetch('/api/admin/accounting/classification-settings/employee-aliases');
    const data = await res.json();
    if (res.ok) { setAliases(data.aliases); setEmployees(data.employees); }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const statusRes = await fetch('/api/admin/accounting/classification-settings/migrate');
      const status = await statusRes.json();
      setTablesExist(!!status.tablesExist && !status.migrationRequired);
      await Promise.all([loadCategories(), loadKeywords(), loadAliases()]);
    } finally {
      setLoading(false);
    }
  }, [loadCategories]);

  useEffect(() => { refresh(); }, [refresh]);

  const saveCategoryMapping = async (expInId: number) => {
    const res = await fetch('/api/admin/accounting/classification-settings/category-mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expInId, ...editMap }),
    });
    if (!res.ok) { const d = await res.json(); setError(d.error); return; }
    await loadCategories();
  };

  const bulkOperating = async () => {
    if (!selected.size) return;
    const res = await fetch('/api/admin/accounting/classification-settings/category-mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bulkOperating: true, expInIds: [...selected] }),
    });
    if (!res.ok) { const d = await res.json(); setError(d.error); return; }
    setSelected(new Set());
    await loadCategories();
  };

  const toggleKeyword = async (rule: any) => {
    await fetch('/api/admin/accounting/classification-settings/keyword-rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rule.id, isActive: !rule.isActive }),
    });
    await loadKeywords();
  };

  const addAlias = async () => {
    if (!newAlias.empId || !newAlias.aliasText) return;
    const res = await fetch('/api/admin/accounting/classification-settings/employee-aliases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empId: Number(newAlias.empId), aliasText: newAlias.aliasText }),
    });
    if (!res.ok) { const d = await res.json(); setError(d.error); return; }
    setNewAlias({ empId: '', aliasText: '' });
    await loadAliases();
  };

  const runPreview = async () => {
    const res = await fetch('/api/admin/accounting/classification-settings/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...preview,
        amount: Number(preview.amount),
      }),
    });
    const data = await res.json();
    if (res.ok) setPreviewResult(data);
    else setError(data.error);
  };

  const runImpact = async () => {
    const params = new URLSearchParams();
    if (impactDates.from) params.set('dateFrom', impactDates.from);
    if (impactDates.to) params.set('dateTo', impactDates.to);
    const res = await fetch(`/api/admin/accounting/classification-settings/audit-impact?${params}`);
    const data = await res.json();
    if (res.ok) setImpact(data);
    else setError(data.error);
  };

  return (
    <div className="min-h-screen bg-[#050505] p-4 md:p-6" dir="rtl">
      <PageHeader
        title="إعدادات التصنيف المحاسبي"
        description="تحكم إداري في قواعد التصنيف — لا يعدّل حركات الخزنة"
      >
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="border-cyan-500/30 text-cyan-400 text-xs">قراءة فقط على الخزنة</Badge>
          <Link href="/admin/accounting/classification-lab">
            <Button variant="outline" size="sm" className="border-zinc-700 text-zinc-300">
              <Beaker className="ml-2 h-4 w-4" />المعمل
            </Button>
          </Link>
          {!tablesExist && (
            <Button size="sm" onClick={runMigrate} disabled={migrating} className="bg-amber-500 text-black">
              {migrating ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Database className="ml-2 h-4 w-4" />}
              تهيئة الجداول والبذور
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="border-zinc-700 text-zinc-300">
            <RefreshCw className={cn('ml-2 h-4 w-4', loading && 'animate-spin')} />تحديث
          </Button>
        </div>
      </PageHeader>

      {error && <p className="mb-4 text-sm text-rose-400">{error}</p>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 bg-zinc-900">
          <TabsTrigger value="categories"><Tags className="ml-1 h-4 w-4" />الفئات</TabsTrigger>
          <TabsTrigger value="keywords"><Settings2 className="ml-1 h-4 w-4" />كلمات مفتاحية</TabsTrigger>
          <TabsTrigger value="aliases"><Users className="ml-1 h-4 w-4" />أسماء مستعارة</TabsTrigger>
          <TabsTrigger value="preview"><Play className="ml-1 h-4 w-4" />معاينة</TabsTrigger>
          <TabsTrigger value="impact">أثر التدقيق</TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-zinc-500" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pr-10 bg-zinc-900 border-zinc-700" placeholder="بحث فئة..." />
            </div>
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <Checkbox checked={unmappedOnly} onCheckedChange={(v) => setUnmappedOnly(!!v)} />
              غير المعيّنة فقط
            </label>
            <Button size="sm" onClick={bulkOperating} disabled={!selected.size} className="bg-emerald-600">
              تعيين مصروف تشغيل ({selected.size})
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8 text-xs">
            {(['flowGroup','flowKind','pnlImpact','partyType','confidence'] as const).map((field) => (
              <Select key={field} value={(editMap as any)[field]} onValueChange={(v) => setEditMap((m) => ({ ...m, [field]: v }))}>
                <SelectTrigger className="h-8 bg-zinc-900 border-zinc-700 text-white"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700">
                  {(field === 'flowGroup' ? FLOW_GROUPS : field === 'flowKind' ? FLOW_KINDS : field === 'pnlImpact' ? PNL : field === 'partyType' ? PARTY : CONF).map((o) => (
                    <SelectItem key={o} value={o} className="text-white font-mono text-xs">{o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800">
                  <TableHead className="w-8" />
                  <TableHead>الفئة</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>التعيين الحالي</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.expInId} className="border-zinc-800">
                    <TableCell>
                      <Checkbox
                        checked={selected.has(c.expInId)}
                        onCheckedChange={(v) => {
                          const n = new Set(selected);
                          v ? n.add(c.expInId) : n.delete(c.expInId);
                          setSelected(n);
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-sm">{c.catName}</TableCell>
                    <TableCell className="text-xs text-zinc-500">{c.expInType}</TableCell>
                    <TableCell className="font-mono text-[10px] text-cyan-400">
                      {c.mapping ? `${c.mapping.flowGroup}/${c.mapping.flowKind}` : '—'}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => saveCategoryMapping(c.expInId)}>
                        <Save className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="keywords">
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800">
                  <TableHead>كلمة</TableHead>
                  <TableHead>هدف</TableHead>
                  <TableHead>تصنيف</TableHead>
                  <TableHead>أولوية</TableHead>
                  <TableHead>نشط</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keywordRules.map((r) => (
                  <TableRow key={r.id} className="border-zinc-800">
                    <TableCell className="font-mono text-xs">{r.keyword}</TableCell>
                    <TableCell className="text-xs">{r.matchTarget}/{r.matchMode}</TableCell>
                    <TableCell className="font-mono text-[10px] text-violet-400">{r.flowGroup}/{r.flowKind}</TableCell>
                    <TableCell>{r.priority}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => toggleKeyword(r)} className="h-7 text-xs">
                        {r.isActive ? 'مفعّل' : 'معطّل'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="aliases" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Select value={newAlias.empId} onValueChange={(v) => setNewAlias((a) => ({ ...a, empId: v }))}>
              <SelectTrigger className="w-48 bg-zinc-900 border-zinc-700"><SelectValue placeholder="موظف" /></SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-700">
                {employees.map((e) => <SelectItem key={e.empId} value={String(e.empId)} className="text-white">{e.empName}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input value={newAlias.aliasText} onChange={(e) => setNewAlias((a) => ({ ...a, aliasText: e.target.value }))} placeholder="الاسم المستعار" className="bg-zinc-900 border-zinc-700" />
            <Button onClick={addAlias}>إضافة</Button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {aliases.map((a) => (
              <div key={a.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-sm">
                <p className="font-medium">{a.aliasText}</p>
                <p className="text-xs text-zinc-500">{a.empName ?? `موظف #${a.empId}`}</p>
                <Badge variant="outline" className="mt-1 text-[10px]">{a.isActive ? 'نشط' : 'معطّل'}</Badge>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="preview" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Input value={preview.invType} onChange={(e) => setPreview((p) => ({ ...p, invType: e.target.value }))} placeholder="invType" className="bg-zinc-900 border-zinc-700" />
            <Input value={preview.inOut} onChange={(e) => setPreview((p) => ({ ...p, inOut: e.target.value }))} placeholder="inOut" className="bg-zinc-900 border-zinc-700" />
            <Input value={preview.amount} onChange={(e) => setPreview((p) => ({ ...p, amount: e.target.value }))} placeholder="amount" className="bg-zinc-900 border-zinc-700" />
            <Input value={preview.categoryName} onChange={(e) => setPreview((p) => ({ ...p, categoryName: e.target.value }))} placeholder="categoryName" className="bg-zinc-900 border-zinc-700" />
            <Input value={preview.notes} onChange={(e) => setPreview((p) => ({ ...p, notes: e.target.value }))} placeholder="notes" className="bg-zinc-900 border-zinc-700 col-span-2" />
          </div>
          <Button onClick={runPreview}><Play className="ml-2 h-4 w-4" />تشغيل المعاينة</Button>
          {previewResult && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {['withoutAdmin', 'withAdmin'].map((key) => (
                <div key={key} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 text-xs">
                  <h4 className="mb-2 font-medium text-zinc-300">{key === 'withAdmin' ? 'مع الإعدادات' : 'بدون إعدادات'}</h4>
                  <pre className="overflow-auto text-[10px] text-zinc-400">{JSON.stringify(previewResult[key], null, 2)}</pre>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="impact" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input type="date" value={impactDates.from} onChange={(e) => setImpactDates((d) => ({ ...d, from: e.target.value }))} className="bg-zinc-900 border-zinc-700" />
            <Input type="date" value={impactDates.to} onChange={(e) => setImpactDates((d) => ({ ...d, to: e.target.value }))} className="bg-zinc-900 border-zinc-700" />
            <Button onClick={runImpact}>حساب الأثر</Button>
          </div>
          {impact && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg bg-zinc-900 p-3"><p className="text-xs text-zinc-500">قبل المراجعة</p><p className="text-xl font-bold">{impact.beforeNeedsReview}</p></div>
              <div className="rounded-lg bg-zinc-900 p-3"><p className="text-xs text-zinc-500">بعد المراجعة</p><p className="text-xl font-bold text-emerald-400">{impact.afterNeedsReview}</p></div>
              <div className="rounded-lg bg-zinc-900 p-3"><p className="text-xs text-zinc-500">تم إصلاحها</p><p className="text-xl font-bold">{impact.fixedByAdminMappings}</p></div>
              <div className="rounded-lg bg-zinc-900 p-3"><p className="text-xs text-zinc-500">عينة</p><p className="text-xl font-bold">{impact.sampleSize}</p></div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
