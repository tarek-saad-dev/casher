'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, Shield, Save, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

interface Role { RoleID: number; RoleKey: string; RoleName: string; }
interface UserRow {
  userID: number; userName: string; loginName: string;
  userLevel: string; isDeleted: boolean; roles: string[];
}

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  admin:       'bg-purple-500/20 text-purple-300 border-purple-500/30',
  manager:     'bg-blue-500/20 text-blue-300 border-blue-500/30',
  cashier:     'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  accountant:  'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  receptionist:'bg-pink-500/20 text-pink-300 border-pink-500/30',
  viewer:      'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',
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
    try {
      const res = await fetch('/api/admin/permissions/users');
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setUsers(data.users);
      setRoles(data.roles);
      const map: Record<number, string[]> = {};
      data.users.forEach((u: UserRow) => { map[u.userID] = [...u.roles]; });
      setEditMap(map);
    } catch (e: any) {
      setMsg({ type: 'err', text: e.message });
    } finally { setLoading(false); }
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
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMsg({ type: 'err', text: data.error || 'فشل حفظ الصلاحيات' });
      } else {
        setMsg({ type: 'ok', text: 'تم حفظ الصلاحيات بنجاح' });
        await load();
      }
    } catch (e: any) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setSaving(null);
      setTimeout(() => setMsg(null), 4500);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-950 p-6" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/15 border border-purple-500/25">
              <Shield className="w-6 h-6 text-purple-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">صلاحيات المستخدمين</h1>
              <p className="text-xs text-zinc-500">إدارة الأدوار لكل مستخدم</p>
            </div>
          </div>
          <button onClick={load} className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Feedback */}
        {msg && (
          <div className={`px-4 py-3 rounded-xl text-sm font-medium border ${msg.type === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-rose-500/10 text-rose-300 border-rose-500/20'}`}>
            {msg.text}
          </div>
        )}

        {/* Users list */}
        <div className="space-y-3">
          {users.map(user => {
            const isOpen    = expanded === user.userID;
            const userRoles = editMap[user.userID] || [];
            const isDirty   = JSON.stringify(userRoles.slice().sort()) !== JSON.stringify((user.roles).slice().sort());

            return (
              <div key={user.userID} className={`rounded-2xl border transition-colors ${user.isDeleted ? 'border-zinc-800/40 opacity-50' : 'border-zinc-800/60 bg-zinc-900/50'}`}>
                {/* Row header */}
                <button
                  onClick={() => setExpanded(isOpen ? null : user.userID)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-right"
                  disabled={user.isDeleted}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-zinc-200">{user.userName}</span>
                      <span className="text-xs text-zinc-500">({user.loginName})</span>
                      {user.isDeleted && <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-500 border border-zinc-700">محذوف</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {userRoles.length === 0
                        ? <span className="text-[11px] text-zinc-600">لا توجد أدوار</span>
                        : userRoles.map(r => (
                          <span key={r} className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${ROLE_COLORS[r] || 'bg-zinc-700/40 text-zinc-400 border-zinc-600/40'}`}>{r}</span>
                        ))
                      }
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isDirty && <span className="text-[10px] text-amber-400 border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 rounded-full">غير محفوظ</span>}
                    {isOpen ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
                  </div>
                </button>

                {/* Expanded role assignment */}
                {isOpen && !user.isDeleted && (
                  <div className="border-t border-zinc-800/50 px-5 py-4 space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {roles.map(role => {
                        const active = userRoles.includes(role.RoleKey);
                        return (
                          <label key={role.RoleID} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${active ? 'bg-purple-500/15 border-purple-500/30' : 'bg-zinc-800/30 border-zinc-700/40 hover:border-zinc-600/60'}`}>
                            <input
                              type="checkbox"
                              checked={active}
                              onChange={() => toggleRole(user.userID, role.RoleKey)}
                              className="w-4 h-4 accent-purple-500"
                            />
                            <div>
                              <p className="text-xs font-medium text-zinc-200">{role.RoleName}</p>
                              <p className="text-[10px] text-zinc-500">{role.RoleKey}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    <div className="flex justify-end">
                      <button
                        onClick={() => save(user.userID)}
                        disabled={saving === user.userID}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                      >
                        {saving === user.userID ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
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
