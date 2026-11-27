'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Loader2, FileKey2, Save, RefreshCw, Globe, Lock, Users,
  Plus, X, Search, ChevronDown, ChevronUp, Info, AlertTriangle,
} from 'lucide-react';
import { readFetchErrorMessage } from '@/lib/readFetchErrorMessage';

// ── Types ────────────────────────────────────────────────────────────────────

interface Role { RoleID: number; RoleKey: string; RoleName: string; }

interface PageRow {
  pageID: number; pageKey: string; pageName: string;
  pagePath: string; section: string | null;
  accessMode: 'all' | 'roles' | 'super_admin_only';
  sortOrder: number; isActive: boolean; roles: string[];
}

const EMPTY_FORM = {
  pageKey: '', pageName: '', pagePath: '/',
  section: '', accessMode: 'roles' as 'all' | 'roles' | 'super_admin_only',
  sortOrder: 999, roles: [] as string[],
};

// Sections considered sensitive — warn before setting accessMode='all'
const SENSITIVE_SECTIONS = [
  'الموظفين', 'الموارد البشرية', 'الخزنة', 'الميزانية',
  'المصروفات', 'مراجعة المصروفات', 'مراجعة المدخلات',
  'تقارير موظف', 'تقارير مدير', 'تقارير شريك',
  'الإدارة', 'التدقيق', 'المرتبات',
];

const SENSITIVE_PAGE_KEYS = [
  'reports.emp_services', 'reports.emp_monthly_work_revenue', 'hr.employees', 'hr.attendance', 'hr.payroll', 'hr.advances', 'hr.salaries',
  'admin.settings', 'admin.users', 'admin.payment_methods', 'admin.shift',
  'admin.permissions.users', 'admin.permissions.pages',
  'treasury.monthly_close', 'treasury.shift_close', 'budget.main',
  'reports.expenses', 'income_review.all_rev', 'income_review.payments',
];

function isSensitivePage(page: PageRow): boolean {
  return SENSITIVE_PAGE_KEYS.includes(page.pageKey) ||
    SENSITIVE_SECTIONS.some(s => page.section?.includes(s));
}

const ACCESS_MODES = [
  { value: 'all',              label: 'للجميع',          icon: Globe,  cls: 'text-success bg-success-soft border-success/25', desc: 'أي مستخدم مسجّل' },
  { value: 'roles',            label: 'أدوار محددة',      icon: Users,  cls: 'text-info bg-info-soft border-info/25',          desc: 'الأدوار المحددة فقط' },
  { value: 'super_admin_only', label: 'مدير النظام فقط', icon: Lock,   cls: 'text-warning bg-warning-soft border-warning/25',    desc: 'super_admin فقط' },
];

function groupBySection(pages: PageRow[]) {
  const map: Record<string, PageRow[]> = {};
  pages.forEach(p => {
    const sec = p.section || 'أخرى';
    if (!map[sec]) map[sec] = [];
    map[sec].push(p);
  });
  return map;
}

// ── Add Page Modal ────────────────────────────────────────────────────────────

function AddPageModal({
  open, onClose, roles, sections, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  roles: Role[];
  sections: string[];
  onCreated: (msg: string) => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [customSection, setCustomSection] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY_FORM });
      setErr(null);
      setCustomSection(false);
      setTimeout(() => firstRef.current?.focus(), 50);
    }
  }, [open]);

  // Auto-generate pageKey from path
  const handlePathChange = (val: string) => {
    const key = val.replace(/^\//, '').replace(/\//g, '.').replace(/[^a-z0-9._-]/gi, '').toLowerCase();
    setForm(f => ({ ...f, pagePath: val, pageKey: key || f.pageKey }));
  };

  const toggleRole = (rk: string) =>
    setForm(f => ({ ...f, roles: f.roles.includes(rk) ? f.roles.filter(r => r !== rk) : [...f.roles, rk] }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.pageKey.trim() || !form.pageName.trim() || !form.pagePath.trim()) {
      setErr('المفتاح والاسم والمسار مطلوبون');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/permissions/pages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pageKey:    form.pageKey.trim(),
          pageName:   form.pageName.trim(),
          pagePath:   form.pagePath.trim(),
          section:    form.section.trim() || null,
          accessMode: form.accessMode,
          sortOrder:  form.sortOrder,
          roles:      form.roles,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل الإنشاء');
      onCreated(`تم إنشاء الصفحة "${form.pageName}" بنجاح`);
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success-soft border border-success/25">
              <Plus className="w-4 h-4 text-success" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">إضافة صفحة جديدة</h2>
              <p className="text-[11px] text-muted-foreground">تُضاف فوراً إلى TblSystemPages</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-muted text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-y-auto">
          <div className="px-5 py-4 space-y-4">

            {/* Path — first so key auto-fills */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                مسار الصفحة <span className="text-destructive">*</span>
              </label>
              <input
                ref={firstRef}
                value={form.pagePath}
                onChange={e => handlePathChange(e.target.value)}
                placeholder="/admin/my-page"
                className="w-full bg-muted border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-success/50 focus:ring-1 focus:ring-success/20 transition-colors font-mono"
                dir="ltr"
              />
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Info className="w-3 h-3" /> المفتاح يتولّد تلقائياً من المسار
              </p>
            </div>

            {/* Key + Name side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  مفتاح الصفحة <span className="text-destructive">*</span>
                </label>
                <input
                  value={form.pageKey}
                  onChange={e => setForm(f => ({ ...f, pageKey: e.target.value }))}
                  placeholder="admin.my-page"
                  className="w-full bg-muted border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-success/50 focus:ring-1 focus:ring-success/20 transition-colors font-mono"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  اسم الصفحة <span className="text-destructive">*</span>
                </label>
                <input
                  value={form.pageName}
                  onChange={e => setForm(f => ({ ...f, pageName: e.target.value }))}
                  placeholder="صفحة جديدة"
                  className="w-full bg-muted border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-success/50 focus:ring-1 focus:ring-success/20 transition-colors"
                />
              </div>
            </div>

            {/* Section */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">القسم</label>
                <button
                  type="button"
                  onClick={() => setCustomSection(v => !v)}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {customSection ? 'اختر من الموجودة' : 'أضف قسماً جديداً'}
                </button>
              </div>
              {customSection ? (
                <input
                  value={form.section}
                  onChange={e => setForm(f => ({ ...f, section: e.target.value }))}
                  placeholder="اسم القسم الجديد"
                  className="w-full bg-muted border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-success/50 focus:ring-1 focus:ring-success/20 transition-colors"
                />
              ) : (
                <select
                  value={form.section}
                  onChange={e => setForm(f => ({ ...f, section: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-success/50 focus:ring-1 focus:ring-success/20 transition-colors"
                >
                  <option value="">— بدون قسم —</option>
                  {sections.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>

            {/* Sort Order */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">ترتيب العرض</label>
              <input
                type="number"
                value={form.sortOrder}
                onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 999 }))}
                className="w-32 bg-muted border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:border-success/50 focus:ring-1 focus:ring-success/20 transition-colors"
                dir="ltr"
                min={1}
              />
            </div>

            {/* Access Mode */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">نوع الوصول <span className="text-destructive">*</span></label>
              <div className="grid grid-cols-3 gap-2">
                {ACCESS_MODES.map(m => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, accessMode: m.value as typeof form.accessMode }))}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-colors ${form.accessMode === m.value ? m.cls + ' ring-1 ring-current/30' : 'bg-muted text-muted-foreground border-border hover:border-border'}`}
                  >
                    <m.icon className="w-4 h-4" />
                    <span className="text-[11px] font-medium leading-tight">{m.label}</span>
                    <span className="text-[10px] opacity-70">{m.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Roles (only when accessMode = 'roles') */}
            {form.accessMode === 'roles' && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">الأدوار المسموح لها</label>
                <div className="grid grid-cols-2 gap-2">
                  {roles.map(role => {
                    const active = form.roles.includes(role.RoleKey);
                    return (
                      <label
                        key={role.RoleID}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl cursor-pointer border transition-colors ${active ? 'bg-success-soft border-success/25 text-success' : 'bg-muted border-border text-muted-foreground hover:border-border'}`}
                      >
                        <input type="checkbox" checked={active} onChange={() => toggleRole(role.RoleKey)} className="w-3.5 h-3.5 accent-emerald-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{role.RoleName}</p>
                          <p className="text-[10px] text-muted-foreground">{role.RoleKey}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {form.roles.length === 0 && (
                  <p className="text-[11px] text-warning flex items-center gap-1.5 bg-warning-soft border border-warning/15 rounded-lg px-3 py-2">
                    <Info className="w-3 h-3 flex-shrink-0" />
                    لم تختر أي دور — لن يصل أحد لهذه الصفحة
                  </p>
                )}
              </div>
            )}

            {/* Error */}
            {err && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-destructive-soft border border-destructive/20 rounded-xl text-destructive text-xs">
                <X className="w-3.5 h-3.5 flex-shrink-0" />
                {err}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3 flex-shrink-0 bg-card">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-muted hover:bg-surface-muted text-foreground text-sm font-medium transition-colors border border-border"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-success-soft hover:bg-success-soft text-success text-sm font-medium border border-success/25 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              إنشاء الصفحة
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PagesPermissionsPage() {
  const [pages, setPages]     = useState<PageRow[]>([]);
  const [roles, setRoles]     = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState<string | null>(null);
  const [editMap, setEditMap] = useState<Record<string, { accessMode: string; roles: string[] }>>({});
  const [msg, setMsg]         = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [search, setSearch]   = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showAdd, setShowAdd] = useState(false);

  const showMsg = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    if (type === 'ok') setTimeout(() => setMsg(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/permissions/pages');
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'فشل تحميل صلاحيات الصفحات'));
      }
      const data = await res.json();
      setPages(data.pages);
      setRoles(data.roles);
      const map: Record<string, { accessMode: string; roles: string[] }> = {};
      data.pages.forEach((p: PageRow) => { map[p.pageKey] = { accessMode: p.accessMode, roles: [...p.roles] }; });
      setEditMap(map);
    } catch (e: unknown) {
      showMsg('err', e instanceof Error ? e.message : 'فشل التحميل');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const [sensitiveConfirm, setSensitiveConfirm] = useState<{ pageKey: string; pageName: string } | null>(null);
  const [pendingMode, setPendingMode] = useState<string>('');

  const setMode = (page: PageRow, mode: string) => {
    if (mode === 'all' && isSensitivePage(page)) {
      setSensitiveConfirm({ pageKey: page.pageKey, pageName: page.pageName });
      setPendingMode(mode);
      return;
    }
    setEditMap(prev => ({ ...prev, [page.pageKey]: { ...prev[page.pageKey], accessMode: mode } }));
  };

  const confirmSensitiveMode = () => {
    if (sensitiveConfirm && pendingMode) {
      setEditMap(prev => ({ ...prev, [sensitiveConfirm.pageKey]: { ...prev[sensitiveConfirm.pageKey], accessMode: pendingMode } }));
    }
    setSensitiveConfirm(null);
    setPendingMode('');
  };

  const toggleR = (key: string, role: string) =>
    setEditMap(prev => {
      const cur = prev[key]?.roles || [];
      return { ...prev, [key]: { ...prev[key], roles: cur.includes(role) ? cur.filter(r => r !== role) : [...cur, role] } };
    });

  const save = async (pageKey: string) => {
    const reason = window.prompt('سبب تعديل صلاحيات الصفحة (مطلوب):');
    if (reason === null) return;
    if (!reason.trim()) {
      showMsg('err', 'يجب إدخال سبب لتعديل صلاحيات الصفحة');
      return;
    }
    setSaving(pageKey);
    try {
      const edit = editMap[pageKey];
      const res = await fetch('/api/admin/permissions/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageKey, accessMode: edit.accessMode, roles: edit.roles, reason: reason.trim() }),
      });
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'فشل الحفظ'));
      }
      showMsg('ok', 'تم الحفظ');
      await load();
    } catch (e: unknown) {
      showMsg('err', e instanceof Error ? e.message : 'فشل الحفظ');
    } finally { setSaving(null); }
  };

  const toggleSection = (sec: string) =>
    setCollapsed(prev => ({ ...prev, [sec]: !prev[sec] }));

  if (loading) return (
    <div className="min-h-full bg-background flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-info" />
    </div>
  );

  // Filter
  const q = search.trim().toLowerCase();
  const filtered = q
    ? pages.filter(p => p.pageName.includes(q) || p.pagePath.toLowerCase().includes(q) || p.pageKey.toLowerCase().includes(q))
    : pages;

  const grouped = groupBySection(filtered);
  const allSections = [...new Set(pages.map(p => p.section || 'أخرى'))];

  return (
    <>
      {/* ── Sensitive page confirmation modal ── */}
      {sensitiveConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" dir="rtl">
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => setSensitiveConfirm(null)} />
          <div className="relative w-full max-w-sm bg-card border border-destructive/30 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-destructive-soft border border-destructive/25 flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">صفحة حساسة</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  <span className="text-foreground font-medium">"{sensitiveConfirm.pageName}"</span> صفحة حساسة.
                  جعلها متاحة للكل قد يسبب كشف بيانات مالية أو تحكم غير مصرح.
                </p>
              </div>
            </div>
            <div className="bg-destructive-soft border border-destructive/15 rounded-xl px-3 py-2.5 text-[11px] text-destructive">
              هل أنت متأكد أنك تريد تغيير وضع الوصول إلى <span className="font-bold">للجميع</span>؟
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setSensitiveConfirm(null)}
                className="px-4 py-2 rounded-xl bg-muted hover:bg-surface-muted text-foreground text-sm font-medium border border-border transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={confirmSensitiveMode}
                className="px-4 py-2 rounded-xl bg-destructive-soft hover:bg-destructive-soft text-destructive text-sm font-medium border border-destructive/25 transition-colors"
              >
                نعم، أنا متأكد
              </button>
            </div>
          </div>
        </div>
      )}

      <AddPageModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        roles={roles}
        sections={allSections}
        onCreated={text => { showMsg('ok', text); load(); }}
      />

      <div className="min-h-full bg-background p-3 sm:p-6" dir="rtl">
        <div className="max-w-5xl mx-auto space-y-5">

          {/* ── Header ── */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-info-soft border border-info/25">
                <FileKey2 className="w-5 h-5 text-info" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-foreground">صلاحيات الصفحات</h1>
                <p className="text-[11px] text-muted-foreground">{pages.length} صفحة مسجّلة</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={load}
                className="p-2 rounded-lg bg-muted hover:bg-surface-muted text-muted-foreground hover:text-foreground transition-colors border border-border"
                title="تحديث"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-success-soft hover:bg-success-soft text-success text-sm font-medium border border-success/25 transition-colors"
              >
                <Plus className="w-4 h-4" />
                إضافة صفحة
              </button>
            </div>
          </div>

          {/* ── Toast ── */}
          {msg && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border ${msg.type === 'ok' ? 'bg-success-soft text-success border-success/20' : 'bg-destructive-soft text-destructive border-destructive/20'}`}>
              {msg.type === 'err' && <X className="w-4 h-4 flex-shrink-0" />}
              {msg.text}
            </div>
          )}

          {/* ── Search ── */}
          <div className="relative">
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو المسار أو المفتاح..."
              className="w-full bg-card border border-border rounded-xl pr-10 pl-4 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-border transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* ── Sections ── */}
          {Object.keys(grouped).length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">لا توجد نتائج</div>
          ) : (
            Object.entries(grouped).map(([section, sPages]) => {
              const isCollapsed = collapsed[section];
              return (
                <div key={section} className="space-y-1.5">
                  {/* Section header */}
                  <button
                    onClick={() => toggleSection(section)}
                    className="w-full flex items-center justify-between px-2 py-1 group"
                  >
                    <span className="text-xs font-semibold text-muted-foreground group-hover:text-muted-foreground transition-colors uppercase tracking-wider">{section}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">{sPages.length}</span>
                      {isCollapsed ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />}
                    </div>
                  </button>

                  {!isCollapsed && (
                    <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
                      {sPages.map(page => {
                        const edit = editMap[page.pageKey] || { accessMode: page.accessMode, roles: page.roles };
                        const isSaving = saving === page.pageKey;
                        const isDirty =
                          edit.accessMode !== page.accessMode ||
                          JSON.stringify([...edit.roles].sort()) !== JSON.stringify([...page.roles].sort());

                        return (
                          <div key={page.pageKey} className="p-4 space-y-3">
                            {/* Row top */}
                            <div className="flex items-start gap-3 flex-wrap">
                              <div className="flex-1 min-w-[160px]">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium text-foreground">{page.pageName}</p>
                                  {isDirty && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-warning-soft text-warning border border-warning/20">غير محفوظ</span>
                                  )}
                                </div>
                                <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{page.pagePath}</p>
                              </div>

                              {/* AccessMode pills */}
                              <div className="flex gap-1.5 flex-wrap">
                                {ACCESS_MODES.map(m => (
                                  <button
                                    key={m.value}
                                    onClick={() => setMode(page, m.value)}
                                    title={m.desc}
                                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${edit.accessMode === m.value ? m.cls : 'bg-muted text-muted-foreground border-border hover:border-border'}`}
                                  >
                                    <m.icon className="w-3 h-3" />
                                    {m.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Role checkboxes */}
                            {edit.accessMode === 'roles' && (
                              <div className="flex flex-wrap gap-1.5 pr-1">
                                {roles.map(role => {
                                  const active = edit.roles.includes(role.RoleKey);
                                  return (
                                    <label
                                      key={role.RoleID}
                                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg cursor-pointer border text-[11px] transition-colors select-none ${active ? 'bg-info-soft border-info/25 text-info' : 'bg-muted border-border text-muted-foreground hover:border-border'}`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={active}
                                        onChange={() => toggleR(page.pageKey, role.RoleKey)}
                                        className="w-3 h-3 accent-blue-500"
                                      />
                                      {role.RoleName}
                                    </label>
                                  );
                                })}
                              </div>
                            )}

                            {/* Save */}
                            <div className="flex justify-end">
                              <button
                                onClick={() => save(page.pageKey)}
                                disabled={isSaving || !isDirty}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${isDirty ? 'bg-info-soft hover:bg-info-soft text-info border-info/25' : 'bg-muted text-muted-foreground border-border cursor-default'} disabled:opacity-50`}
                              >
                                {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                {isDirty ? 'حفظ التغييرات' : 'محفوظ'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
