'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users, Plus, Pencil, Trash2, Loader2, Info, Shield, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePermission } from '@/hooks/usePermission';

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

export default function UsersPage() {
  const canEdit = usePermission('users.edit');
  const canCreate = usePermission('users.create');
  const canDelete = usePermission('users.delete');

  const [users, setUsers] = useState<UserRow[]>([]);
  const [shifts, setShifts] = useState<ShiftDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  // Form fields
  const [fUserName, setFUserName] = useState('');
  const [fLoginName, setFLoginName] = useState('');
  const [fPassword, setFPassword] = useState('');
  const [fUserLevel, setFUserLevel] = useState('user');
  const [fShiftID, setFShiftID] = useState(1);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, sRes] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/shift/definitions'),
      ]);
      const uData = await uRes.json();
      const sData = await sRes.json();
      if (Array.isArray(uData)) setUsers(uData);
      if (Array.isArray(sData)) setShifts(sData);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  function resetForm() {
    setFUserName('');
    setFLoginName('');
    setFPassword('');
    setFUserLevel('user');
    setFShiftID(1);
    setEditingId(null);
    setFormOpen(false);
    setError('');
  }

  function startEdit(u: UserRow) {
    setFUserName(u.UserName);
    setFLoginName(u.loginName);
    setFPassword('');
    setFUserLevel(u.UserLevel);
    setFShiftID(u.ShiftID);
    setEditingId(u.UserID);
    setFormOpen(true);
    setError('');
  }

  function startCreate() {
    resetForm();
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!fUserName.trim() || !fLoginName.trim()) {
      setError('يجب إدخال الاسم واسم الدخول');
      return;
    }
    if (!editingId && !fPassword.trim()) {
      setError('يجب إدخال كلمة المرور');
      return;
    }

    setFormLoading(true);
    try {
      const payload: Record<string, unknown> = {
        UserName: fUserName.trim(),
        loginName: fLoginName.trim(),
        UserLevel: fUserLevel,
        ShiftID: fShiftID,
      };
      if (fPassword.trim()) payload.Password = fPassword.trim();

      const url = editingId ? `/api/users/${editingId}` : '/api/users';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'خطأ'); return; }
      resetForm();
      await loadData();
    } catch { setError('خطأ في الاتصال'); }
    finally { setFormLoading(false); }
  }

  async function handleDelete(userID: number, userName: string) {
    if (!confirm(`هل تريد حذف المستخدم "${userName}"؟`)) return;
    setError('');
    try {
      const res = await fetch(`/api/users/${userID}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      await loadData();
    } catch { setError('خطأ في الحذف'); }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="w-6 h-6" />
          إدارة المستخدمين
        </h1>
        {canCreate && (
          <Button onClick={startCreate} size="sm">
            <Plus className="w-4 h-4 ml-2" />
            مستخدم جديد
          </Button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-lg p-3 flex items-center gap-2">
          <Info className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Create / Edit Form */}
      {formOpen && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
          <h3 className="text-lg font-bold">{editingId ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>الاسم</Label>
              <Input value={fUserName} onChange={(e) => setFUserName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>اسم الدخول</Label>
              <Input value={fLoginName} onChange={(e) => setFLoginName(e.target.value)} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label>{editingId ? 'كلمة مرور جديدة (اتركه فارغ للإبقاء)' : 'كلمة المرور'}</Label>
              <Input type="password" value={fPassword} onChange={(e) => setFPassword(e.target.value)} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label>المستوى</Label>
              <select
                value={fUserLevel}
                onChange={(e) => setFUserLevel(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="admin">مسؤول (Admin)</option>
                <option value="user">مستخدم (User)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>الوردية الافتراضية</Label>
              <select
                value={fShiftID}
                onChange={(e) => setFShiftID(parseInt(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {shifts.map((s) => (
                  <option key={s.ShiftID} value={s.ShiftID}>{s.ShiftName}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={formLoading}>
              {formLoading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : null}
              {editingId ? 'حفظ التعديلات' : 'إضافة'}
            </Button>
            <Button type="button" variant="outline" onClick={resetForm}>إلغاء</Button>
          </div>
        </form>
      )}

      {/* Users Table */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground">
                <th className="p-3 text-right">ID</th>
                <th className="p-3 text-right">الاسم</th>
                <th className="p-3 text-right">اسم الدخول</th>
                <th className="p-3 text-center">المستوى</th>
                <th className="p-3 text-right">الوردية</th>
                {(canEdit || canDelete) && <th className="p-3 text-center">إجراءات</th>}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.UserID} className="border-t border-border hover:bg-muted/20">
                  <td className="p-3 font-mono text-xs">{u.UserID}</td>
                  <td className="p-3 font-medium">{u.UserName}</td>
                  <td className="p-3 font-mono text-xs" dir="ltr">{u.loginName}</td>
                  <td className="p-3 text-center">
                    {u.UserLevel === 'admin' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-500 text-xs font-medium">
                        <ShieldCheck className="w-3.5 h-3.5" /> مسؤول
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-blue-400 text-xs">
                        <Shield className="w-3.5 h-3.5" /> مستخدم
                      </span>
                    )}
                  </td>
                  <td className="p-3">{u.ShiftName || `#${u.ShiftID}`}</td>
                  {(canEdit || canDelete) && (
                    <td className="p-3 text-center">
                      <div className="flex justify-center gap-1">
                        {canEdit && (
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => startEdit(u)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(u.UserID, u.UserName)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
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
    </div>
  );
}
