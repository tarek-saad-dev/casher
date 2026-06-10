'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Loader2, FileKey2, Save, RefreshCw, Globe, Lock, Users,
  Plus, X, Search, ChevronDown, ChevronUp, Info,
} from 'lucide-react';

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

const ACCESS_MODES = [
  { value: 'all',              label: 'للجميع',          icon: Globe,  cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25', desc: 'أي مستخدم مسجّل' },
  { value: 'roles',            label: 'أدوار محددة',      icon: Users,  cls: 'text-blue-400 bg-blue-500/10 border-blue-500/25',          desc: 'الأدوار المحددة فقط' },
  { value: 'super_admin_only', label: 'مدير النظام فقط', icon: Lock,   cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/25',    desc: 'super_admin فقط' },
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
      <div className="relative w-full max-w-lg bg-zinc-900 border border-zinc-700/60 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/60 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/25">
              <Plus className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">إضافة صفحة جديدة</h2>
              <p className="text-[11px] text-zinc-500">تُضاف فوراً إلى TblSystemPages</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-y-auto">
          <div className="px-5 py-4 space-y-4">

            {/* Path — first so key auto-fills */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">
                مسار الصفحة <span className="text-rose-400">*</span>
              </label>
              <input
                ref={firstRef}
                value={form.pagePath}
                onChange={e => handlePathChange(e.target.value)}
                placeholder="/admin/my-page"
                className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-3.5 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors font-mono"
                dir="ltr"
              />
              <p className="text-[11px] text-zinc-600 flex items-center gap-1">
                <Info className="w-3 h-3" /> المفتاح يتولّد تلقائياً من المسار
              </p>
            </div>

            {/* Key + Name side by side */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">
                  مفتاح الصفحة <span className="text-rose-400">*</span>
                </label>
                <input
                  value={form.pageKey}
                  onChange={e => setForm(f => ({ ...f, pageKey: e.target.value }))}
                  placeholder="admin.my-page"
                  className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-3.5 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors font-mono"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-400">
                  اسم الصفحة <span className="text-rose-400">*</span>
                </label>
                <input
                  value={form.pageName}
                  onChange={e => setForm(f => ({ ...f, pageName: e.target.value }))}
                  placeholder="صفحة جديدة"
                  className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-3.5 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                />
              </div>
            </div>

            {/* Section */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-400">القسم</label>
                <button
                  type="button"
                  onClick={() => setCustomSection(v => !v)}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {customSection ? 'اختر من الموجودة' : 'أضف قسماً جديداً'}
                </button>
              </div>
              {customSection ? (
                <input
                  value={form.section}
                  onChange={e => setForm(f => ({ ...f, section: e.target.value }))}
                  placeholder="اسم القسم الجديد"
                  className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-3.5 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                />
              ) : (
                <select
                  value={form.section}
                  onChange={e => setForm(f => ({ ...f, section: e.target.value }))}
                  className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-3.5 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                >
                  <option value="">— بدون قسم —</option>
                  {sections.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}
            </div>

            {/* Sort Order */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">ترتيب العرض</label>
              <input
                type="number"
                value={form.sortOrder}
                onChange={e => setForm(f => ({ ...f, sortOrder: parseInt(e.target.value) || 999 }))}
                className="w-32 bg-zinc-800/60 border border-zinc-700/50 rounded-xl px-3.5 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
                dir="ltr"
                min={1}
              />
            </div>

            {/* Access Mode */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-400">نوع الوصول <span className="text-rose-400">*</span></label>
              <div className="grid grid-cols-3 gap-2">
                {ACCESS_MODES.map(m => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, accessMode: m.value as typeof form.accessMode }))}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-colors ${form.accessMode === m.value ? m.cls + ' ring-1 ring-current/30' : 'bg-zinc-800/30 text-zinc-500 border-zinc-700/40 hover:border-zinc-600/60'}`}
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
                <label className="text-xs font-medium text-zinc-400">الأدوار المسموح لها</label>
                <div className="grid grid-cols-2 gap-2">
                  {roles.map(role => {
                    const active = form.roles.includes(role.RoleKey);
                    return (
                      <label
                        key={role.RoleID}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl cursor-pointer border transition-colors ${active ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' : 'bg-zinc-800/30 border-zinc-700/30 text-zinc-400 hover:border-zinc-600/50'}`}
                      >
                        <input type="checkbox" checked={active} onChange={() => toggleRole(role.RoleKey)} className="w-3.5 h-3.5 accent-emerald-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{role.RoleName}</p>
                          <p className="text-[10px] text-zinc-500">{role.RoleKey}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {form.roles.length === 0 && (
                  <p className="text-[11px] text-amber-400/80 flex items-center gap-1.5 bg-amber-500/5 border border-amber-500/15 rounded-lg px-3 py-2">
                    <Info className="w-3 h-3 flex-shrink-0" />
                    لم تختر أي دور — لن يصل أحد لهذه الصفحة
                  </p>
                )}
              </div>
            )}

            {/* Error */}
            {err && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs">
                <X className="w-3.5 h-3.5 flex-shrink-0" />
                {err}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-zinc-800/60 flex items-center justify-between gap-3 flex-shrink-0 bg-zinc-900">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors border border-zinc-700/50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-sm font-medium border border-emerald-500/25 transition-colors disabled:opacity-50"
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
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPages(data.pages);
      setRoles(data.roles);
      const map: Record<string, { accessMode: string; roles: string[] }> = {};
      data.pages.forEach((p: PageRow) => { map[p.pageKey] = { accessMode: p.accessMode, roles: [...p.roles] }; });
      setEditMap(map);
    } catch (e: any) {
      showMsg('err', e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setMode = (key: string, mode: string) =>
    setEditMap(prev => ({ ...prev, [key]: { ...prev[key], accessMode: mode } }));

  const toggleR = (key: string, role: string) =>
    setEditMap(prev => {
      const cur = prev[key]?.roles || [];
      return { ...prev, [key]: { ...prev[key], roles: cur.includes(role) ? cur.filter(r => r !== role) : [...cur, role] } };
    });

  const save = async (pageKey: string) => {
    setSaving(pageKey);
    try {
      const edit = editMap[pageKey];
      const res = await fetch('/api/admin/permissions/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageKey, accessMode: edit.accessMode, roles: edit.roles }),
      });
      if (!res.ok) throw new Error(await res.text());
      showMsg('ok', 'تم الحفظ');
      await load();
    } catch (e: any) {
      showMsg('err', e.message);
    } finally { setSaving(null); }
  };

  const toggleSection = (sec: string) =>
    setCollapsed(prev => ({ ...prev, [sec]: !prev[sec] }));

  if (loading) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
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
      <AddPageModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        roles={roles}
        sections={allSections}
        onCreated={text => { showMsg('ok', text); load(); }}
      />

      <div className="min-h-screen bg-zinc-950 p-4 sm:p-6" dir="rtl">
        <div className="max-w-5xl mx-auto space-y-5">

          {/* ── Header ── */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-500/15 border border-blue-500/25">
                <FileKey2 className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">صلاحيات الصفحات</h1>
                <p className="text-[11px] text-zinc-500">{pages.length} صفحة مسجّلة</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={load}
                className="p-2 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors border border-zinc-700/40"
                title="تحديث"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-sm font-medium border border-emerald-500/25 transition-colors"
              >
                <Plus className="w-4 h-4" />
                إضافة صفحة
              </button>
            </div>
          </div>

          {/* ── Toast ── */}
          {msg && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium border ${msg.type === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-rose-500/10 text-rose-300 border-rose-500/20'}`}>
              {msg.type === 'err' && <X className="w-4 h-4 flex-shrink-0" />}
              {msg.text}
            </div>
          )}

          {/* ── Search ── */}
          <div className="relative">
            <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو المسار أو المفتاح..."
              className="w-full bg-zinc-900/60 border border-zinc-800/60 rounded-xl pr-10 pl-4 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* ── Sections ── */}
          {Object.keys(grouped).length === 0 ? (
            <div className="text-center py-12 text-zinc-600 text-sm">لا توجد نتائج</div>
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
                    <span className="text-xs font-semibold text-zinc-500 group-hover:text-zinc-400 transition-colors uppercase tracking-wider">{section}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-700">{sPages.length}</span>
                      {isCollapsed ? <ChevronDown className="w-3.5 h-3.5 text-zinc-600" /> : <ChevronUp className="w-3.5 h-3.5 text-zinc-600" />}
                    </div>
                  </button>

                  {!isCollapsed && (
                    <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/30 divide-y divide-zinc-800/40 overflow-hidden">
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
                                  <p className="text-sm font-medium text-zinc-200">{page.pageName}</p>
                                  {isDirty && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20">غير محفوظ</span>
                                  )}
                                </div>
                                <p className="text-[11px] text-zinc-600 font-mono mt-0.5">{page.pagePath}</p>
                              </div>

                              {/* AccessMode pills */}
                              <div className="flex gap-1.5 flex-wrap">
                                {ACCESS_MODES.map(m => (
                                  <button
                                    key={m.value}
                                    onClick={() => setMode(page.pageKey, m.value)}
                                    title={m.desc}
                                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${edit.accessMode === m.value ? m.cls : 'bg-zinc-800/50 text-zinc-600 border-zinc-700/30 hover:border-zinc-600/50'}`}
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
                                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg cursor-pointer border text-[11px] transition-colors select-none ${active ? 'bg-blue-500/15 border-blue-500/25 text-blue-300' : 'bg-zinc-800/30 border-zinc-700/25 text-zinc-500 hover:border-zinc-600/50'}`}
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
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${isDirty ? 'bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border-blue-500/25' : 'bg-zinc-800/30 text-zinc-600 border-zinc-700/25 cursor-default'} disabled:opacity-50`}
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
