'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, Shield, Save, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { readFetchErrorMessage } from '@/lib/readFetchErrorMessage';

interface Role { RoleID: number; RoleKey: string; RoleName: string; }
interface UserRow {
  userID: number; userName: string; loginName: string;
  userLevel: string; isDeleted: boolean; roles: string[];
}

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-warning-soft text-warning border-warning/30',
  admin:       'bg-brand-soft text-brand border-brand/30',
  manager:     'bg-info-soft text-info border-info/30',
  cashier:     'bg-success-soft text-success border-success/30',
  accountant:  'bg-info-soft text-info border-info/30',
  receptionist:'bg-pink-500/20 text-pink-300 border-pink-500/30',
  partner:     'bg-warning-soft text-warning border-warning/30',
  viewer:      'bg-muted text-foreground border-border',
};

export default function UsersPermissionsPage() {
  const [users, setUsers]   = useState<UserRow[]>([]);
  const [roles, setRoles]   = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState<number | null>(null);
  const [editMap, setEditMap] = useState<Record<number, string[]>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/permissions/users');
      if (!res.ok) {
        throw new Error(await readFetchErrorMessage(res, 'فشل تحميل صلاحيات المستخدمين'));
      }
      const data = await res.json();
      const list = Array.isArray(data.users) ? (data.users as UserRow[]) : [];
      const roleList = Array.isArray(data.roles) ? (data.roles as Role[]) : [];
      setUsers(list);
      setRoles(roleList);
      const map: Record<number, string[]> = {};
      list.forEach((u) => { map[u.userID] = [...(u.roles || [])]; });
      setEditMap(map);
    } catch (e: unknown) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'فشل التحميل' });
      setUsers([]);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleRole = (uid: number, roleKey: string) => {
    setEditMap(prev => {
      const cur = prev[uid] || [];
      return {
        ...prev,
        [uid]: cur.includes(roleKey) ? cur.filter(r => r !== roleKey) : [...cur, roleKey],
      };
    });
  };

  const save = async (uid: number) => {
    const reason = window.prompt('سبب تعديل صلاحيات المستخدم (مطلوب):');
    if (reason === null) return;
    if (!reason.trim()) {
      setMsg({ type: 'err', text: 'يجب إدخال سبب لتعديل الصلاحيات' });
      return;
    }

    setSaving(uid);
    try {
      const res = await fetch('/api/admin/permissions/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userID: uid, roles: editMap[uid] || [], reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({} as { success?: boolean; error?: string }));
      if (!res.ok || !data.success) {
        setMsg({
          type: 'err',
          text:
            typeof data.error === 'string' && data.error.trim()
              ? data.error
              : 'فشل حفظ الصلاحيات',
        });
      } else {
        setMsg({ type: 'ok', text: 'تم حفظ الصلاحيات بنجاح' });
        await load();
      }
    } catch (e: unknown) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : 'فشل الحفظ' });
    } finally {
      setSaving(null);
      setTimeout(() => setMsg(null), 4500);
    }
  };

  if (loading) {
    return (
      <div className="min-h-full bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background p-3 sm:p-6" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-brand-soft border border-brand/25">
              <Shield className="w-6 h-6 text-brand" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">صلاحيات المستخدمين</h1>
              <p className="text-xs text-muted-foreground">
                إدارة الأدوار لكل مستخدم — لربط الشريك بفرع استخدم{' '}
                <a href="/admin/partners" className="text-warning hover:underline">إدارة الشركاء</a>
              </p>
            </div>
          </div>
          <button
            onClick={load}
            className="p-2 rounded-lg bg-muted hover:bg-surface-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {msg && (
          <div
            className={`px-4 py-3 rounded-xl text-sm font-medium border break-words ${
              msg.type === 'ok'
                ? 'bg-success-soft text-success border-success/20'
                : 'bg-destructive-soft text-destructive border-destructive/20'
            }`}
          >
            {msg.text}
          </div>
        )}

        <div className="space-y-3">
          {users.length === 0 && !msg ? (
            <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
              لا يوجد مستخدمون للعرض
            </div>
          ) : null}
          {users.map((user) => {
            const isOpen = expanded === user.userID;
            const userRoles = editMap[user.userID] || [];
            const isDirty =
              JSON.stringify(userRoles.slice().sort()) !==
              JSON.stringify((user.roles || []).slice().sort());

            return (
              <div
                key={user.userID}
                className={`rounded-2xl border transition-colors ${
                  user.isDeleted
                    ? 'border-border opacity-50'
                    : 'border-border bg-card'
                }`}
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : user.userID)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-right"
                  disabled={user.isDeleted}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{user.userName}</span>
                      <span className="text-xs text-muted-foreground">({user.loginName})</span>
                      {user.isDeleted && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                          محذوف
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {userRoles.length === 0 ? (
                        <span className="text-[11px] text-muted-foreground">لا توجد أدوار</span>
                      ) : (
                        userRoles.map((r) => (
                          <span
                            key={r}
                            className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                              ROLE_COLORS[r] ||
                              'bg-muted text-muted-foreground border-border'
                            }`}
                          >
                            {r}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isDirty && (
                      <span className="text-[10px] text-warning border border-warning/30 bg-warning-soft px-2 py-0.5 rounded-full">
                        غير محفوظ
                      </span>
                    )}
                    {isOpen ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {isOpen && !user.isDeleted && (
                  <div className="border-t border-border px-5 py-4 space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {roles.map((role) => {
                        const active = userRoles.includes(role.RoleKey);
                        return (
                          <label
                            key={role.RoleID}
                            className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${
                              active
                                ? 'bg-brand-soft border-brand/30'
                                : 'bg-muted border-border hover:border-border'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={active}
                              onChange={() => toggleRole(user.userID, role.RoleKey)}
                              className="w-4 h-4 accent-purple-500"
                            />
                            <div>
                              <p className="text-xs font-medium text-foreground">{role.RoleName}</p>
                              <p className="text-[10px] text-muted-foreground">{role.RoleKey}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    <div className="flex justify-end">
                      <button
                        onClick={() => save(user.userID)}
                        disabled={saving === user.userID}
                        className="flex items-center gap-2 px-4 py-2 bg-brand-soft hover:bg-brand-soft text-brand border border-brand/30 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        {saving === user.userID ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        حفظ
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
