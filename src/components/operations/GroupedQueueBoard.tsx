'use client';

import { useState, useMemo } from 'react';
import { Ticket } from 'lucide-react';
import type { BarberStatus } from '@/lib/operationsTypes';
import { normalizeQueueTicket, LIVE_STATUSES, type NormalizedQueueTicket } from '@/lib/queueTicketNormalizer';
import { BarberQueueGroup, type BarberGroup } from './BarberQueueGroup';

// ── Filter tabs ───────────────────────────────────────────────────────────────

const TABS = [
  { key: 'all',        label: 'النشطة'    },
  { key: 'waiting',    label: 'منتظر'      },
  { key: 'called',     label: 'تم النداء'  },
  { key: 'in_service', label: 'في الخدمة' },
  { key: 'skipped',    label: 'تخطى'        },
  { key: 'done',       label: 'منجزون'      },
];

// ── Grouping helper ───────────────────────────────────────────────────────────

function groupTicketsByBarber(
  tickets: NormalizedQueueTicket[],
  barbers: BarberStatus[],
): BarberGroup[] {
  const map = new Map<string, BarberGroup>();

  for (const t of tickets) {
    const key = t.empId != null ? String(t.empId) : '__unassigned__';
    if (!map.has(key)) {
      const barber = barbers.find(b => b.EmpID === t.empId) ?? null;
      map.set(key, {
        empId:      t.empId,
        barberName: t.barberName !== '-' ? t.barberName : 'غير محدد',
        barber,
        tickets:    [],
      });
    }
    map.get(key)!.tickets.push(t);
  }

  // Add barbers who have no tickets yet (so they still appear in the board)
  for (const b of barbers) {
    const key = String(b.EmpID);
    if (!map.has(key)) {
      map.set(key, {
        empId:      b.EmpID,
        barberName: b.EmpName,
        barber:     b,
        tickets:    [],
      });
    }
  }

  // Sort groups: barbers with active tickets first, then by name
  return Array.from(map.values()).sort((a, b) => {
    const aActive = a.tickets.filter(t => LIVE_STATUSES.includes(t.status)).length;
    const bActive = b.tickets.filter(t => LIVE_STATUSES.includes(t.status)).length;
    if (aActive !== bActive) return bActive - aActive;
    return a.barberName.localeCompare(b.barberName, 'ar');
  });
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  tickets:   any[];         // raw rows from /api/queue
  barbers:   BarberStatus[];
  loading:   boolean;
  onAction:  (ticketId: number, action: string, extra?: any) => Promise<void>;
  onRefresh: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GroupedQueueBoard({ tickets, barbers, loading, onAction, onRefresh }: Props) {
  const [tab, setTab] = useState<string>('all');

  // Normalize once
  const normalized = useMemo(() => tickets.map(normalizeQueueTicket), [tickets]);

  // Per-tab filter on ticket level
  const filterTicket = (t: NormalizedQueueTicket): boolean => {
    if (tab === 'all')  return LIVE_STATUSES.includes(t.status);
    if (tab === 'done') return ['done', 'cancelled', 'no_show'].includes(t.status);
    return t.status === tab;
  };

  // Apply filter to tickets before grouping
  const filteredTickets = useMemo(
    () => normalized.filter(filterTicket),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [normalized, tab],
  );

  // Group filtered tickets by barber
  const groups = useMemo(
    () => groupTicketsByBarber(filteredTickets, barbers),
    [filteredTickets, barbers],
  );

  // For tab "all" — show all barber columns even if empty
  // For other tabs — hide barber groups with zero matching tickets
  const visibleGroups = tab === 'all'
    ? groups
    : groups.filter(g => g.tickets.length > 0);

  // Total active count for header badge
  const totalActive = normalized.filter(t => LIVE_STATUSES.includes(t.status)).length;

  // Tab badge count
  const countForTab = (key: string): number => {
    if (key === 'all')  return normalized.filter(t => LIVE_STATUSES.includes(t.status)).length;
    if (key === 'done') return normalized.filter(t => ['done','cancelled','no_show'].includes(t.status)).length;
    return normalized.filter(t => t.status === key).length;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Column header ── */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: '#2A2A35' }}>
        <Ticket size={14} className="text-amber-400"/>
        <span className="text-sm font-bold text-white">قائمة الانتظار</span>
        <span className="mr-auto text-xs px-2 py-0.5 rounded-full font-bold"
          style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}>
          {totalActive} نشط
        </span>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 px-2 py-1.5 border-b overflow-x-auto flex-shrink-0"
        style={{ borderColor: '#2A2A35' }}>
        {TABS.map(t => {
          const cnt = countForTab(t.key);
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
              style={{
                background: tab === t.key ? 'rgba(245,158,11,0.15)' : 'transparent',
                color:      tab === t.key ? '#F59E0B'                : '#6B7280',
                border:     `1px solid ${tab === t.key ? 'rgba(245,158,11,0.3)' : 'transparent'}`,
              }}>
              {t.label}{cnt > 0 && <span className="mr-1 opacity-70">({cnt})</span>}
            </button>
          );
        })}
      </div>

      {/* ── Board ── */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            جاري التحميل...
          </div>
        ) : visibleGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600">
            <Ticket size={28} className="mb-2 opacity-25"/>
            <p className="text-sm">
              {normalized.length === 0 ? 'لا توجد تذاكر اليوم' : 'لا توجد تذاكر في هذه الحالة'}
            </p>
          </div>
        ) : (
          <div className="flex gap-3 p-3 h-full items-start">
            {visibleGroups.map(g => (
              <BarberQueueGroup
                key={g.empId ?? '__unassigned__'}
                group={g}
                allBarbers={barbers}
                onAction={onAction}
                onRefresh={onRefresh}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
