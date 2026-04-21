'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Users, Plus, Pencil, Trash2, Loader2, Shield, ShieldCheck,
  Search, RefreshCw, Key, X, Eye, EyeOff,
  ChevronUp, ChevronDown, AlertTriangle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { usePermission } from '@/hooks/usePermission';
import { useSession } from '@/hooks/useSession';

interface UserRow {
  UserID: number;
  UserName: string;
  UserLevel: string;
  loginName: string;
  ShiftID: number;
  ShiftName: string | null;
}

interface ShiftDef {
  ShiftID: number;
  ShiftName: string;
}

type SortField = 'UserName' | 'UserLevel' | 'ShiftName';
type SortDir = 'asc' | 'desc';
type DrawerMode = 'create' | 'edit' | 'reset-password' | null;

export default function UsersPage() {
  const { user: sessionUser } = useSession();
  const canEdit = usePermission('users.edit');
  const canCreate = usePermission('users.create');
  const canDelete = usePermission('users.delete');

  const [users, setUsers] = useState<UserRow[]>([]);
  const [shifts, setShifts] = useState<ShiftDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [globalError, setGlobalError] = useState('');

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('UserName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [drawerUser, setDrawerUser] = useState<UserRow | null>(null);
  const [drawerError, setDrawerError] = useState('');
  const [drawerLoading, setDrawerLoading] = useState(false);

  const [fUserName, setFUserName] = useState('');
  const [fLoginName, setFLoginName] = useState('');
  const [fPassword, setFPassword] = useState('');
  const [fShowPassword, setFShowPassword] = useState(false);
  const [fUserLevel, setFUserLevel] = useState('user');
  const [fShiftID, setFShiftID] = useState(1);

  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setGlobalError('');
    try {
      const [uRes, sRes] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/shift/definitions'),
      ]);
      const uData = await uRes.json();
      const sData = await sRes.json();
      if (Array.isArray(uData)) setUsers(uData);
      else setGlobalError(uData.error || 'خطأ في تحميل المستخدمين');
      if (Array.isArray(sData)) setShifts(sData);
    } catch { setGlobalError('خطأ في الاتصال بالخادم'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase().trim();
    const filtered = q
      ? users.filter(u =>
        u.UserName.toLowerCase().includes(q) ||
        u.loginName.toLowerCase().includes(q) ||
        (u.ShiftName || '').toLowerCase().includes(q)
      )
      : users;
    return [...filtered].sort((a, b) => {
      const av = (a[sortField] || '').toString().toLowerCase();
      const bv = (b[sortField] || '').toString().toLowerCase();
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [users, search, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  function openCreate() {
    setFUserName(''); setFLoginName(''); setFPassword('');
    setFUserLevel('user'); setFShiftID(shifts[0]?.ShiftID || 1);
    setFShowPassword(false); setDrawerError('');
    setDrawerUser(null); setDrawerMode('create');
  }

  function openEdit(u: UserRow) {
    setFUserName(u.UserName); setFLoginName(u.loginName); setFPassword('');
    setFUserLevel(u.UserLevel); setFShiftID(u.ShiftID);
    setFShowPassword(false); setDrawerError('');
    setDrawerUser(u); setDrawerMode('edit');
  }

  function openResetPwd(u: UserRow) {
    setFPassword(''); setFShowPassword(false); setDrawerError('');
    setDrawerUser(u); setDrawerMode('reset-password');
  }

  function closeDrawer() {
    setDrawerMode(null); setDrawerUser(null); setDrawerError('');
  }

  async function handleSaveUser(e: React.FormEvent) {
    e.preventDefault();
    setDrawerError('');
    if (!fUserName.trim() || !fLoginName.trim()) {
      setDrawerError('يجب إدخال الاسم واسم الدخول'); return;
    }
    if (drawerMode === 'create' && !fPassword.trim()) {
      setDrawerError('يجب إدخال كلمة المرور'); return;
    }
    setDrawerLoading(true);
    try {
      const payload: Record<string, unknown> = {
        UserName: fUserName.trim(),
        loginName: fLoginName.trim(),
        UserLevel: fUserLevel,
        ShiftID: fShiftID,
      };
      if (fPassword.trim()) payload.Password = fPassword.trim();
      const url = drawerMode === 'edit' && drawerUser ? `/api/users/${drawerUser.UserID}` : '/api/users';
      const method = drawerMode === 'edit' ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setDrawerError(data.error || 'خطأ'); return; }
      closeDrawer();
      await loadData(true);
    } catch { setDrawerError('خطأ في الاتصال'); }
    finally { setDrawerLoading(false); }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setDrawerError('');
    if (!fPassword.trim() || fPassword.trim().length < 4) {
      setDrawerError('كلمة المرور يجب أن تكون 4 أحرف على الأقل'); return;
    }
    if (!drawerUser) return;
    setDrawerLoading(true);
    try {
      const res = await fetch(`/api/users/${drawerUser.UserID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Password: fPassword.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setDrawerError(data.error || 'خطأ'); return; }
      closeDrawer();
    } catch { setDrawerError('خطأ في الاتصال'); }
    finally { setDrawerLoading(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDrawerLoading(true);
    try {
      const res = await fetch(`/api/users/${deleteTarget.UserID}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { setGlobalError(data.error || 'خطأ في الحذف'); return; }
      setDeleteTarget(null);
      await loadData(true);
    } catch { setGlobalError('خطأ في الاتصال'); }
    finally { setDrawerLoading(false); }
  }

  const SortBtn = ({ field, label }: { field: SortField; label: string }) => (
    <button
      type="button"
      onClick={() => toggleSort(field)}
      className="flex items-center gap-1 hover:text-zinc-200 transition-colors"
    >
      {label}
      {sortField === field
        ? sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
        : <ChevronUp className="w-3 h-3 text-zinc-700" />}
    </button>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <Users className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">إدارة المستخدمين</h1>
            <p className="text-sm text-zinc-500 mt-0.5">
              {users.length} مستخدم نشط
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="border-zinc-700 gap-2"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            تحديث
          </Button>
          {canCreate && (
            <Button onClick={openCreate} size="sm" className="bg-blue-600 hover:bg-blue-700 gap-2">
              <Plus className="w-4 h-4" />
              مستخدم جديد
            </Button>
          )}
        </div>
      </div>

      {/* Global Error */}
      {globalError && (
        <div className="flex items-center gap-2 text-sm text-rose-300 bg-rose-950/40 border border-rose-800/30 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {globalError}
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="بحث بالاسم أو اسم الدخول أو الوردية..."
          className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl pr-10 pl-4 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Users Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-zinc-600" />
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3 text-center">
          <div className="w-14 h-14 rounded-2xl bg-zinc-800/60 flex items-center justify-center">
            <Users className="w-7 h-7 text-zinc-600" />
          </div>
          <p className="text-zinc-500">{search ? 'لا توجد نتائج للبحث' : 'لا يوجد مستخدمون'}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-900/80 border-b border-zinc-800">
                <th className="px-4 py-3 text-right">
                  <span className="text-xs text-zinc-500 font-medium">#</span>
                </th>
                <th className="px-4 py-3 text-right">
                  <SortBtn field="UserName" label="الاسم" />
                </th>
                <th className="px-4 py-3 text-right text-xs text-zinc-500 font-medium">
                  اسم الدخول
                </th>
                <th className="px-4 py-3 text-right">
                  <SortBtn field="UserLevel" label="الصلاحية" />
                </th>
                <th className="px-4 py-3 text-right">
                  <SortBtn field="ShiftName" label="الوردية" />
                </th>
                {(canEdit || canDelete) && (
                  <th className="px-4 py-3 text-center text-xs text-zinc-500 font-medium">إجراءات</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => (
                <tr
                  key={u.UserID}
                  className={cn(
                    'border-t border-zinc-800/40 hover:bg-zinc-800/20 transition-colors',
                    sessionUser?.UserID === u.UserID && 'bg-blue-950/10'
                  )}
                >
                  <td className="px-4 py-3 text-zinc-600 font-mono text-xs">{u.UserID}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold',
                        u.UserLevel === 'admin' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-blue-500/15 text-blue-400'
                      )}>
                        {u.UserName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-white">{u.UserName}</p>
                        {sessionUser?.UserID === u.UserID && (
                          <p className="text-xs text-zinc-500">(أنت)</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400" dir="ltr">{u.loginName}</td>
                  <td className="px-4 py-3">
                    {u.UserLevel === 'admin' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <ShieldCheck className="w-3 h-3" />
                        مسؤول
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        <Shield className="w-3 h-3" />
                        مستخدم
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-sm">
                    {u.ShiftName || `وردية #${u.ShiftID}`}
                  </td>
                  {(canEdit || canDelete) && (
                    <td className="px-4 py-3">
                      <div className="flex justify-center gap-1">
                        {canEdit && (
                          <button
                            title="تعديل"
                            onClick={() => openEdit(u)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            title="تغيير كلمة المرور"
                            onClick={() => openResetPwd(u)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-amber-400 hover:bg-amber-950/30 transition-all"
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && sessionUser?.UserID !== u.UserID && (
                          <button
                            title="حذف"
                            onClick={() => setDeleteTarget(u)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-500 hover:text-rose-400 hover:bg-rose-950/30 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create / Edit Drawer ─────────────────────────── */}
      {(drawerMode === 'create' || drawerMode === 'edit') && (
        <Overlay onClose={closeDrawer}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center',
                  drawerMode === 'create' ? 'bg-blue-500/15' : 'bg-amber-500/15'
                )}>
                  {drawerMode === 'create'
                    ? <Plus className="w-5 h-5 text-blue-400" />
                    : <Pencil className="w-5 h-5 text-amber-400" />}
                </div>
                <h2 className="text-lg font-bold text-white">
                  {drawerMode === 'create' ? 'مستخدم جديد' : `تعديل: ${drawerUser?.UserName}`}
                </h2>
              </div>
              <button onClick={closeDrawer} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">الاسم الكامل</Label>
                  <Input
                    value={fUserName}
                    onChange={e => setFUserName(e.target.value)}
                    placeholder="محمد أحمد"
                    className="bg-zinc-950 border-zinc-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">اسم الدخول</Label>
                  <Input
                    value={fLoginName}
                    onChange={e => setFLoginName(e.target.value)}
                    placeholder="admin"
                    dir="ltr"
                    className="bg-zinc-950 border-zinc-700"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-400">
                  {drawerMode === 'edit' ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور *'}
                </Label>
                <div className="relative">
                  <Input
                    type={fShowPassword ? 'text' : 'password'}
                    value={fPassword}
                    onChange={e => setFPassword(e.target.value)}
                    dir="ltr"
                    className="bg-zinc-950 border-zinc-700 pl-10"
                  />
                  <button
                    type="button"
                    onClick={() => setFShowPassword(p => !p)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {fShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">الصلاحية</Label>
                  <select
                    value={fUserLevel}
                    onChange={e => setFUserLevel(e.target.value)}
                    className="w-full h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white focus:outline-none"
                  >
                    <option value="admin">مسؤول (Admin)</option>
                    <option value="user">مستخدم (User)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">الوردية الافتراضية</Label>
                  <select
                    value={fShiftID}
                    onChange={e => setFShiftID(parseInt(e.target.value))}
                    className="w-full h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-white focus:outline-none"
                  >
                    {shifts.map(s => (
                      <option key={s.ShiftID} value={s.ShiftID}>{s.ShiftName}</option>
                    ))}
                  </select>
                </div>
              </div>

              {drawerError && <ErrorBox message={drawerError} />}

              <div className="flex gap-3 pt-1">
                <Button type="submit" disabled={drawerLoading} className="flex-1 bg-blue-600 hover:bg-blue-700 gap-2">
                  {drawerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {drawerMode === 'create' ? 'إضافة المستخدم' : 'حفظ التعديلات'}
                </Button>
                <Button type="button" variant="outline" onClick={closeDrawer} className="border-zinc-700">إلغاء</Button>
              </div>
            </form>
          </div>
        </Overlay>
      )}

      {/* ── Reset Password Drawer ────────────────────────── */}
      {drawerMode === 'reset-password' && (
        <Overlay onClose={closeDrawer}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
                  <Key className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">تغيير كلمة المرور</h2>
                  <p className="text-xs text-zinc-500">{drawerUser?.UserName}</p>
                </div>
              </div>
              <button onClick={closeDrawer} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-400">كلمة المرور الجديدة</Label>
                <div className="relative">
                  <Input
                    type={fShowPassword ? 'text' : 'password'}
                    value={fPassword}
                    onChange={e => setFPassword(e.target.value)}
                    dir="ltr"
                    placeholder="••••••••"
                    className="bg-zinc-950 border-zinc-700 pl-10"
                  />
                  <button
                    type="button"
                    onClick={() => setFShowPassword(p => !p)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    {fShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {drawerError && <ErrorBox message={drawerError} />}
              <div className="flex gap-3">
                <Button type="submit" disabled={drawerLoading} className="flex-1 bg-amber-600 hover:bg-amber-700 gap-2">
                  {drawerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                  تغيير كلمة المرور
                </Button>
                <Button type="button" variant="outline" onClick={closeDrawer} className="border-zinc-700">إلغاء</Button>
              </div>
            </form>
          </div>
        </Overlay>
      )}

      {/* ── Delete Confirm ───────────────────────────────── */}
      {deleteTarget && (
        <Overlay onClose={() => setDeleteTarget(null)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">حذف المستخدم</h2>
                <p className="text-xs text-zinc-500">{deleteTarget.UserName}</p>
              </div>
            </div>
            <p className="text-sm text-zinc-400">
              هل أنت متأكد من حذف المستخدم <strong className="text-white">{deleteTarget.UserName}</strong>؟
              سيتم إخفاؤه ولن يتمكن من تسجيل الدخول.
            </p>
            <div className="flex gap-3">
              <Button
                onClick={handleDelete}
                disabled={drawerLoading}
                className="flex-1 bg-rose-700 hover:bg-rose-600 gap-2"
              >
                {drawerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                تأكيد الحذف
              </Button>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} className="border-zinc-700">إلغاء</Button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-rose-300 bg-rose-950/40 border border-rose-800/30 rounded-lg px-3 py-2.5">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      {message}
    </div>
  );
}
