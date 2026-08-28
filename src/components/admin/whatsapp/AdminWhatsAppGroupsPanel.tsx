'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { readFetchErrorMessage } from '@/lib/readFetchErrorMessage';

type GroupEventKey =
  | 'booking.created'
  | 'booking.cancelled'
  | 'booking.moved'
  | 'sale.completed';

type EventDefinition = {
  key: GroupEventKey;
  labelAr: string;
  descriptionAr: string;
};

type GroupRow = {
  id: number;
  name: string;
  inviteLink: string;
  subscribedEvents: GroupEventKey[];
  branchId: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
};

type GroupFormState = {
  name: string;
  inviteLink: string;
  subscribedEvents: GroupEventKey[];
  isActive: boolean;
};

const EMPTY_FORM: GroupFormState = {
  name: '',
  inviteLink: '',
  subscribedEvents: ['booking.created'],
  isActive: true,
};

type Props = {
  onToast: (type: 'success' | 'error', message: string) => void;
};

export default function AdminWhatsAppGroupsPanel({ onToast }: Props) {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [events, setEvents] = useState<EventDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<GroupFormState>(EMPTY_FORM);

  const eventLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of events) map.set(e.key, e.labelAr);
    return map;
  }, [events]);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/whatsapp/groups');
      if (!res.ok) throw new Error(await readFetchErrorMessage(res));
      const data = (await res.json()) as { groups: GroupRow[]; events: EventDefinition[] };
      setGroups(data.groups ?? []);
      setEvents(data.events ?? []);
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'تعذّر تحميل الجروبات');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (group: GroupRow) => {
    setEditingId(group.id);
    setForm({
      name: group.name,
      inviteLink: group.inviteLink,
      subscribedEvents: group.subscribedEvents,
      isActive: group.isActive,
    });
    setDialogOpen(true);
  };

  const toggleEvent = (key: GroupEventKey) => {
    setForm((prev) => {
      const has = prev.subscribedEvents.includes(key);
      return {
        ...prev,
        subscribedEvents: has
          ? prev.subscribedEvents.filter((k) => k !== key)
          : [...prev.subscribedEvents, key],
      };
    });
  };

  const saveGroup = async () => {
    setSaving(true);
    try {
      const url = editingId
        ? `/api/admin/whatsapp/groups/${editingId}`
        : '/api/admin/whatsapp/groups';
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await readFetchErrorMessage(res));
      onToast('success', editingId ? 'تم تحديث الجروب' : 'تم إضافة الجروب');
      setDialogOpen(false);
      await loadGroups();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'تعذّر حفظ الجروب');
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async (id: number) => {
    if (!window.confirm('هل تريد حذف هذا الجروب؟')) return;
    try {
      const res = await fetch(`/api/admin/whatsapp/groups/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readFetchErrorMessage(res));
      onToast('success', 'تم حذف الجروب');
      await loadGroups();
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'تعذّر حذف الجروب');
    }
  };

  const testSend = async (id: number) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/admin/whatsapp/groups/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'اختبار إرسال من نظام Cut Salon ✅' }),
      });
      const data = (await res.json()) as { result?: { sent?: boolean; reason?: string } };
      if (!res.ok) throw new Error(await readFetchErrorMessage(res));
      if (data.result?.sent) {
        onToast('success', 'تم إرسال رسالة الاختبار للجروب');
      } else {
        onToast('error', data.result?.reason ?? 'فشل إرسال رسالة الاختبار');
      }
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'تعذّر إرسال الاختبار');
    } finally {
      setTestingId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold text-foreground">جروبات واتساب</h2>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => void loadGroups()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button type="button" size="sm" onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            إضافة جروب
          </Button>
        </div>
      </div>

      <p className="text-sm text-zinc-400">
        أضف رابط دعوة الجروب وحدد الأحداث التي تُرسل إليها تنبيهات تلقائية (مثل حجز جديد).
        تأكد أن حساب واتساب البوت عضو في الجروب.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          جاري التحميل...
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-zinc-500 mb-3" />
          <p className="text-sm text-zinc-400">لا توجد جروبات بعد. أضف أول جروب للتنبيهات.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {groups.map((group) => (
            <div
              key={group.id}
              className="rounded-2xl border border-border bg-surface p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-foreground">{group.name}</h3>
                  <Badge variant={group.isActive ? 'default' : 'secondary'}>
                    {group.isActive ? 'نشط' : 'معطّل'}
                  </Badge>
                </div>
                <p className="text-xs text-zinc-500 break-all" dir="ltr">
                  {group.inviteLink}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {group.subscribedEvents.map((key) => (
                    <Badge key={key} variant="outline" className="text-xs">
                      {eventLabelMap.get(key) ?? key}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void testSend(group.id)}
                  disabled={testingId === group.id}
                  className="gap-1"
                >
                  {testingId === group.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  اختبار
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => openEdit(group)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void deleteGroup(group.id)}
                  className="text-rose-400 hover:text-rose-300"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingId ? 'تعديل الجروب' : 'إضافة جروب واتساب'}</DialogTitle>
            <DialogDescription>
              الصق رابط الدعوة من واتساب (chat.whatsapp.com) واختر الأحداث المراد إرسالها.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">اسم الجروب</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="مثال: تنبيهات الحجوزات"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">رابط الدعوة</span>
              <input
                type="url"
                dir="ltr"
                value={form.inviteLink}
                onChange={(e) => setForm((p) => ({ ...p, inviteLink: e.target.value }))}
                placeholder="https://chat.whatsapp.com/..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium mb-2">الأحداث المرسلة لهذا الجروب</legend>
              {events.map((event) => (
                <label
                  key={event.key}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-muted/30"
                >
                  <input
                    type="checkbox"
                    checked={form.subscribedEvents.includes(event.key)}
                    onChange={() => toggleEvent(event.key)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium">{event.labelAr}</span>
                    <span className="block text-xs text-zinc-500">{event.descriptionAr}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
              />
              الجروب نشط
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              إلغاء
            </Button>
            <Button type="button" onClick={() => void saveGroup()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حفظ'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
