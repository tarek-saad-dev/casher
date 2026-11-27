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
  DefaultBranchID?: number | null;
  DefaultBranchCode?: string | null;
  DefaultBranchName?: string | null;
}

interface ShiftDef {
  ShiftID: number;
  ShiftName: string;
}

interface BranchOption {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName?: string | null;
}

type SortField = 'UserName' | 'UserLevel' | 'ShiftName';
type SortDir = 'asc' | 'desc';
type DrawerMode = 'create' | 'edit' | 'reset-password' | null;

export default function UsersPage() {
  const { user: sessionUser, activeBranch } = useSession();
  const canEdit = usePermission('users.edit');
  const canCreate = usePermission('users.create');
  const canDelete = usePermission('users.delete');

  const [users, setUsers] = useState<UserRow[]>([]);
  const [shifts, setShifts] = useState<ShiftDef[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
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
  const [fBranchID, setFBranchID] = useState<number>(0);

  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setGlobalError('');
    try {
      const [uRes, sRes, bRes] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/shift/definitions'),
        fetch('/api/auth/branches'),
      ]);
      const uData = await uRes.json();
      const sData = await sRes.json();
      const bData = await bRes.json();
      if (Array.isArray(uData)) setUsers(uData);
      else setGlobalError(uData.error || 'خطأ في تحميل المستخدمين');
      if (Array.isArray(sData)) setShifts(sData);
      if (bData?.ok && Array.isArray(bData.branches)) {
        const list: BranchOption[] = bData.branches.map((b: BranchOption) => ({
          branchId: b.branchId,
          branchCode: b.branchCode,
          branchName: b.branchName,
          shortName: b.shortName ?? null,
        }));
        // Ensure active branch is in the list even if somehow missing
        if (
          bData.activeBranch &&
          !list.some((b) => b.branchId === bData.activeBranch.branchId)
        ) {
          list.unshift(bData.activeBranch);
        }
        setBranches(list);
      }
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
    setFBranchID(activeBranch?.branchId || branches[0]?.branchId || 0);
    setFShowPassword(false); setDrawerError('');
    setDrawerUser(null); setDrawerMode('create');
  }

  function openEdit(u: UserRow) {
    setFUserName(u.UserName); setFLoginName(u.loginName); setFPassword('');
    setFUserLevel(u.UserLevel); setFShiftID(u.ShiftID);
    setFBranchID(u.DefaultBranchID || activeBranch?.branchId || branches[0]?.branchId || 0);
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
    if (!fBranchID) {
      setDrawerError('يجب اختيار فرع البداية'); return;
    }
    setDrawerLoading(true);
    try {
      const payload: Record<string, unknown> = {
        UserName: fUserName.trim(),
        loginName: fLoginName.trim(),
        UserLevel: fUserLevel,
        ShiftID: fShiftID,
        BranchID: fBranchID,
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
      className="flex items-center gap-1 hover:text-foreground transition-colors"
    >
      {label}
      {sortField === field
        ? sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
        : <ChevronUp className="w-3 h-3 text-muted-foreground" />}
    </button>
  );

  return (
    <div className="min-w-0 p-3 sm:p-6 max-w-6xl mx-auto space-y-6">

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-info-soft border border-info/20 flex items-center justify-center">
            <Users className="w-6 h-6 text-info" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">إدارة المستخدمين</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
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
            className="border-border gap-2"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
            تحديث
          </Button>
          {canCreate && (
            <Button onClick={openCreate} size="sm" className="bg-primary hover:bg-primary/85 text-primary-foreground gap-2">
              <Plus className="w-4 h-4" />
              مستخدم جديد
            </Button>
          )}
        </div>
      </div>

      {/* Global Error */}
      {globalError && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive-soft border border-destructive/30 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {globalError}
        </div>
      )}

      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="بحث بالاسم أو اسم الدخول أو الوردية..."
          className="w-full bg-card border border-border rounded-xl pr-10 pl-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-border"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Users Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
            <Users className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">{search ? 'لا توجد نتائج للبحث' : 'لا يوجد مستخدمون'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="bg-card border-b border-border">
                <th className="px-4 py-3 text-right">
                  <span className="text-xs text-muted-foreground font-medium">#</span>
                </th>
                <th className="px-4 py-3 text-right">
                  <SortBtn field="UserName" label="الاسم" />
                </th>
                <th className="px-4 py-3 text-right text-xs text-muted-foreground font-medium">
                  اسم الدخول
                </th>
                <th className="px-4 py-3 text-right">
                  <SortBtn field="UserLevel" label="الصلاحية" />
                </th>
                <th className="px-4 py-3 text-right">
                  <SortBtn field="ShiftName" label="الوردية" />
                </th>
                <th className="px-4 py-3 text-right text-xs text-muted-foreground font-medium">
                  الفرع
                </th>
                {(canEdit || canDelete) && (
                  <th className="px-4 py-3 text-center text-xs text-muted-foreground font-medium">إجراءات</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => (
                <tr
                  key={u.UserID}
                  className={cn(
                    'border-t border-border hover:bg-surface-muted transition-colors',
                    sessionUser?.UserID === u.UserID && 'bg-info-soft'
                  )}
                >
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{u.UserID}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold',
                        u.UserLevel === 'admin' ? 'bg-success-soft text-success' : 'bg-info-soft text-info'
                      )}>
                        {u.UserName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{u.UserName}</p>
                        {sessionUser?.UserID === u.UserID && (
                          <p className="text-xs text-muted-foreground">(أنت)</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground" dir="ltr">{u.loginName}</td>
                  <td className="px-4 py-3">
                    {u.UserLevel === 'admin' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-success-soft text-success border border-success/20">
                        <ShieldCheck className="w-3 h-3" />
                        مسؤول
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-info-soft text-info border border-info/20">
                        <Shield className="w-3 h-3" />
                        مستخدم
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-sm">
                    {u.ShiftName || `وردية #${u.ShiftID}`}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {u.DefaultBranchName || u.DefaultBranchCode ? (
                      <span className="text-foreground">
                        {u.DefaultBranchName || u.DefaultBranchCode}
                      </span>
                    ) : (
                      <span className="text-destructive text-xs">بدون فرع</span>
                    )}
                  </td>
                  {(canEdit || canDelete) && (
                    <td className="px-4 py-3">
                      <div className="flex justify-center gap-1">
                        {canEdit && (
                          <button
                            title="تعديل"
                            onClick={() => openEdit(u)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-surface-muted transition-all"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            title="تغيير كلمة المرور"
                            onClick={() => openResetPwd(u)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-warning hover:bg-warning-soft transition-all"
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete && sessionUser?.UserID !== u.UserID && (
                          <button
                            title="حذف"
                            onClick={() => setDeleteTarget(u)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive-soft transition-all"
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
          <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 w-full max-w-md max-h-[85dvh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center',
                  drawerMode === 'create' ? 'bg-info-soft' : 'bg-warning-soft'
                )}>
                  {drawerMode === 'create'
                    ? <Plus className="w-5 h-5 text-info" />
                    : <Pencil className="w-5 h-5 text-warning" />}
                </div>
                <h2 className="text-lg font-bold text-foreground">
                  {drawerMode === 'create' ? 'مستخدم جديد' : `تعديل: ${drawerUser?.UserName}`}
                </h2>
              </div>
              <button onClick={closeDrawer} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">الاسم الكامل</Label>
                  <Input
                    value={fUserName}
                    onChange={e => setFUserName(e.target.value)}
                    placeholder="محمد أحمد"
                    className="bg-background border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">اسم الدخول</Label>
                  <Input
                    value={fLoginName}
                    onChange={e => setFLoginName(e.target.value)}
                    placeholder="admin"
                    dir="ltr"
                    className="bg-background border-border"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  {drawerMode === 'edit' ? 'كلمة مرور جديدة (اتركها فارغة للإبقاء)' : 'كلمة المرور *'}
                </Label>
                <div className="relative">
                  <Input
                    type={fShowPassword ? 'text' : 'password'}
                    value={fPassword}
                    onChange={e => setFPassword(e.target.value)}
                    dir="ltr"
                    className="bg-background border-border pl-10"
                  />
                  <button
                    type="button"
                    onClick={() => setFShowPassword(p => !p)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {fShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">الصلاحية</Label>
                  <select
                    value={fUserLevel}
                    onChange={e => setFUserLevel(e.target.value)}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none"
                  >
                    <option value="admin">مسؤول (Admin)</option>
                    <option value="user">مستخدم (User)</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">الوردية الافتراضية</Label>
                  <select
                    value={fShiftID}
                    onChange={e => setFShiftID(parseInt(e.target.value))}
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none"
                  >
                    {shifts.map(s => (
                      <option key={s.ShiftID} value={s.ShiftID}>{s.ShiftName}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">فرع البداية</Label>
                <select
                  value={fBranchID || ''}
                  onChange={e => setFBranchID(parseInt(e.target.value, 10))}
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none"
                  required
                >
                  <option value="" disabled>اختر الفرع</option>
                  {branches.map(b => (
                    <option key={b.branchId} value={b.branchId}>
                      {b.shortName || b.branchName} ({b.branchCode})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  نقطة الدخول الأولى فقط — المستخدم يحصل على كل الفروع النشطة ويقدر ينقل بينها عادي.
                </p>
              </div>

              {drawerError && <ErrorBox message={drawerError} />}

              <div className="flex gap-3 pt-1">
                <Button type="submit" disabled={drawerLoading} className="flex-1 bg-primary hover:bg-primary/85 text-primary-foreground gap-2">
                  {drawerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {drawerMode === 'create' ? 'إضافة المستخدم' : 'حفظ التعديلات'}
                </Button>
                <Button type="button" variant="outline" onClick={closeDrawer} className="border-border">إلغاء</Button>
              </div>
            </form>
          </div>
        </Overlay>
      )}

      {/* ── Reset Password Drawer ────────────────────────── */}
      {drawerMode === 'reset-password' && (
        <Overlay onClose={closeDrawer}>
          <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 w-full max-w-sm max-h-[85dvh] overflow-y-auto space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-warning-soft flex items-center justify-center">
                  <Key className="w-5 h-5 text-warning" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground">تغيير كلمة المرور</h2>
                  <p className="text-xs text-muted-foreground">{drawerUser?.UserName}</p>
                </div>
              </div>
              <button onClick={closeDrawer} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">كلمة المرور الجديدة</Label>
                <div className="relative">
                  <Input
                    type={fShowPassword ? 'text' : 'password'}
                    value={fPassword}
                    onChange={e => setFPassword(e.target.value)}
                    dir="ltr"
                    placeholder="••••••••"
                    className="bg-background border-border pl-10"
                  />
                  <button
                    type="button"
                    onClick={() => setFShowPassword(p => !p)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {fShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {drawerError && <ErrorBox message={drawerError} />}
              <div className="flex gap-3">
                <Button type="submit" disabled={drawerLoading} className="flex-1 bg-primary hover:bg-primary/85 text-primary-foreground gap-2">
                  {drawerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                  تغيير كلمة المرور
                </Button>
                <Button type="button" variant="outline" onClick={closeDrawer} className="border-border">إلغاء</Button>
              </div>
            </form>
          </div>
        </Overlay>
      )}

      {/* ── Delete Confirm ───────────────────────────────── */}
      {deleteTarget && (
        <Overlay onClose={() => setDeleteTarget(null)}>
          <div className="bg-card border border-border rounded-2xl p-4 sm:p-6 w-full max-w-sm max-h-[85dvh] overflow-y-auto space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-destructive-soft flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">حذف المستخدم</h2>
                <p className="text-xs text-muted-foreground">{deleteTarget.UserName}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              هل أنت متأكد من حذف المستخدم <strong className="text-foreground">{deleteTarget.UserName}</strong>؟
              سيتم إخفاؤه ولن يتمكن من تسجيل الدخول.
            </p>
            <div className="flex gap-3">
              <Button
                onClick={handleDelete}
                disabled={drawerLoading}
                className="flex-1 bg-destructive hover:bg-destructive/85 text-destructive-foreground gap-2"
              >
                {drawerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                تأكيد الحذف
              </Button>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} className="border-border">إلغاء</Button>
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
    <div className="flex items-center gap-2 text-sm text-destructive bg-destructive-soft border border-destructive/30 rounded-lg px-3 py-2.5">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      {message}
    </div>
  );
}
