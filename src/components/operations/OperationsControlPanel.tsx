'use client';

import {
  Plus,
  Zap,
  CalendarPlus,
  CalendarClock,
  AlertTriangle,
  TicketPlus,
  Loader2,
  Globe,
  Building2,
  Users,
  ArrowLeftRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { DateNavigator } from './DateNavigator';
import { EnvironmentControls } from './EnvironmentControls';
import { SalonMusicPanel } from './SalonMusicPanel';

export type OpsBranchScope = 'active' | 'all' | number;
export type OpsPresenceFilter = 'present' | 'all';

export type OpsBranchOption = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName?: string | null;
};

interface Props {
  date: string;
  dateLabel: string;
  loading?: boolean;
  settlingExpired?: boolean;
  voiceEnabled: boolean;
  musicExpanded: boolean;
  publicBookingEnabled: boolean;
  publicBookingToggleLoading?: boolean;
  /** Branch filter — default all branches */
  branchScope: OpsBranchScope;
  presenceFilter: OpsPresenceFilter;
  branchOptions: OpsBranchOption[];
  activeBranchLabel?: string;
  onBranchScopeChange: (scope: OpsBranchScope) => void;
  onPresenceFilterChange: (presence: OpsPresenceFilter) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
  onDateSelect?: (date: string) => void;
  onRefresh: () => void;
  onQuickQueue?: () => void;
  quickQueueLoading?: boolean;
  onCreateQueue: () => void;
  onFindNearestQueue?: () => void;
  onCreateBooking: () => void;
  onScheduleControl?: () => void;
  onTemporaryTransfer?: () => void;
  onAffectedBookings?: () => void;
  affectedBookingsCount?: number;
  onSettleExpired?: () => void;
  onEnableVoice: () => void;
  onDisableVoice: () => void;
  onToggleMusic: () => void;
  onTogglePublicBooking: () => void;
}

const toolbarBtn =
  'h-7 min-h-0 gap-1 whitespace-nowrap rounded-md px-2 text-[11px] font-semibold transition-all duration-150 focus-visible:ring-2 active:scale-[0.99] [&_svg]:size-3';

const toolbarAdminBtn =
  'h-7 min-h-0 gap-1 rounded-md px-2 text-[11px] font-medium whitespace-nowrap transition-all duration-150 [&_svg]:size-3';

const toolbarDivider = 'h-5 w-px shrink-0 bg-border/50';

const selectClass =
  'h-7 min-h-0 rounded-md border border-border/60 bg-background/60 px-2 text-[11px] font-medium text-foreground outline-none transition-colors hover:bg-surface-muted/50 focus-visible:ring-2 focus-visible:ring-primary/30';

export function OperationsControlPanel({
  date,
  dateLabel,
  loading,
  settlingExpired,
  voiceEnabled,
  musicExpanded,
  publicBookingEnabled,
  publicBookingToggleLoading,
  branchScope,
  presenceFilter,
  branchOptions,
  activeBranchLabel,
  onBranchScopeChange,
  onPresenceFilterChange,
  onPrevDay,
  onNextDay,
  onToday,
  onDateSelect,
  onRefresh,
  onQuickQueue,
  quickQueueLoading,
  onCreateQueue,
  onFindNearestQueue,
  onCreateBooking,
  onScheduleControl,
  onTemporaryTransfer,
  onAffectedBookings,
  affectedBookingsCount,
  onSettleExpired,
  onEnableVoice,
  onDisableVoice,
  onToggleMusic,
  onTogglePublicBooking,
}: Props) {
  const handleToggleVoice = () => {
    if (voiceEnabled) onDisableVoice();
    else onEnableVoice();
  };

  const branchSelectValue =
    branchScope === 'all' ? 'all' : branchScope === 'active' ? 'active' : String(branchScope);

  return (
    <section className="flex shrink-0 flex-col gap-1">
      <div
        className={cn(
          'flex flex-col gap-1 overflow-hidden rounded-lg border border-border/40',
          'bg-surface-muted/20 px-1.5 py-1 shadow-none backdrop-blur-sm',
          'md:flex-row md:items-center md:gap-2 md:px-2',
        )}
      >
        {/* Filters + date */}
        <div className="flex shrink-0 flex-wrap items-center gap-1 md:gap-1.5">
          <label className="inline-flex items-center gap-1">
            <Building2 className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">الفرع</span>
            <select
              className={cn(selectClass, 'min-w-[108px] max-w-[140px]')}
              value={branchSelectValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'all') onBranchScopeChange('all');
                else if (v === 'active') onBranchScopeChange('active');
                else onBranchScopeChange(Number(v));
              }}
              aria-label="فلتر الفرع"
            >
              <option value="all">كل الفروع</option>
              <option value="active">
                فرعي الحالي{activeBranchLabel ? ` — ${activeBranchLabel}` : ''}
              </option>
              {branchOptions.map((b) => (
                <option key={b.branchId} value={String(b.branchId)}>
                  {b.shortName || b.branchName}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex items-center gap-1">
            <Users className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">الصنايعية</span>
            <select
              className={cn(selectClass, 'min-w-[120px] max-w-[150px]')}
              value={presenceFilter}
              onChange={(e) =>
                onPresenceFilterChange(e.target.value === 'all' ? 'all' : 'present')
              }
              aria-label="فلتر الحضور"
            >
              <option value="present">الحاضرين اليوم فقط</option>
              <option value="all">كل الصنايعية</option>
            </select>
          </label>

        <span className={cn(toolbarDivider, 'hidden sm:block')} aria-hidden />

        <DateNavigator
          date={date}
          dateLabel={dateLabel}
          loading={loading}
          onPrevDay={onPrevDay}
          onNextDay={onNextDay}
          onToday={onToday}
          onDateSelect={onDateSelect}
          onRefresh={onRefresh}
          toolbar
          className="min-w-0 flex-1 md:flex-none"
        />
        </div>

        <span className={cn(toolbarDivider, 'hidden lg:block')} aria-hidden />

        {/* All actions in one compact scrollable strip */}
        <div
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1 overflow-x-auto',
            '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          {onQuickQueue && (
            <Button
              type="button"
              onClick={onQuickQueue}
              disabled={quickQueueLoading}
              aria-label="عمل دور سريع"
              aria-busy={quickQueueLoading}
              title="حلاقة شعر 30 دقيقة مع أقرب حلاق متاح وطباعة فورية"
              className={cn(
                toolbarBtn,
                'border border-accent/45 bg-accent/15 font-bold text-accent-foreground hover:bg-accent/25',
              )}
            >
              {quickQueueLoading ? (
                <Loader2 className="size-3 shrink-0 animate-spin" />
              ) : (
                <TicketPlus className="shrink-0" />
              )}
              {quickQueueLoading ? 'جارٍ...' : 'دور سريع'}
            </Button>
          )}

          <Button
            type="button"
            onClick={onCreateQueue}
            className={cn(
              toolbarBtn,
              'bg-primary font-bold text-primary-foreground hover:bg-primary/90',
            )}
          >
            <Plus className="shrink-0" />
            إنشاء دور
          </Button>

          {onFindNearestQueue && (
            <Button
              type="button"
              onClick={onFindNearestQueue}
              className={cn(
                toolbarBtn,
                'border border-success/40 bg-success/15 font-bold text-success hover:bg-success/25',
              )}
            >
              <Zap className="shrink-0" />
              إيجاد أقرب دور
            </Button>
          )}

          <Button
            type="button"
            onClick={onCreateBooking}
            className={cn(
              toolbarBtn,
              'border border-primary/35 bg-card font-bold text-foreground hover:bg-surface-muted',
            )}
          >
            <CalendarPlus className="shrink-0" />
            إنشاء حجز
          </Button>

          <span className={cn(toolbarDivider, 'mx-0.5')} aria-hidden />

          <label
            className={cn(
              'inline-flex h-7 min-h-0 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors',
              publicBookingEnabled
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-destructive/25 bg-destructive/10 text-destructive',
              publicBookingToggleLoading && 'opacity-70',
            )}
            title={
              publicBookingEnabled
                ? 'حجز الموقع مفعّل — يظهر للحلاقين في الموقع'
                : 'حجز الموقع متوقف — الموقع يخفي الحلاقين ويعرض رسالة الواتساب'
            }
          >
            <Globe className="size-3 shrink-0" aria-hidden />
            <span className="whitespace-nowrap hidden min-[900px]:inline">
              {publicBookingEnabled ? 'حجز الموقع' : 'الحجز متوقف'}
            </span>
            <Switch
              checked={publicBookingEnabled}
              disabled={publicBookingToggleLoading}
              onCheckedChange={() => onTogglePublicBooking()}
              aria-label={
                publicBookingEnabled
                  ? 'إيقاف الحجز من الموقع'
                  : 'تفعيل الحجز من الموقع'
              }
              className="h-3.5 w-6 [&>span]:h-3 [&>span]:w-3 [&>span]:data-[state=checked]:translate-x-2.5 data-[state=checked]:bg-success data-[state=unchecked]:bg-destructive/60"
            />
          </label>

          {onScheduleControl && (
            <Button
              type="button"
              variant="outline"
              onClick={onScheduleControl}
              className={cn(
                toolbarAdminBtn,
                'border-border/70 bg-background/40 hover:bg-surface-muted/60',
              )}
            >
              <CalendarClock />
              إدارة مواعيد اليوم
            </Button>
          )}

          {onTemporaryTransfer && (
            <Button
              type="button"
              variant="outline"
              onClick={onTemporaryTransfer}
              className={cn(
                toolbarAdminBtn,
                'border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15',
              )}
              title="نقل موظف ليوم واحد لفرع آخر بدون تعديل الجدول الأسبوعي"
            >
              <ArrowLeftRight />
              نقل موظف اليوم
            </Button>
          )}

          {onAffectedBookings && (
            <Button
              type="button"
              variant="outline"
              onClick={onAffectedBookings}
              className={cn(
                toolbarAdminBtn,
                'border-orange-500/35 bg-orange-500/10 text-orange-100 hover:bg-orange-500/15',
              )}
              title="الحجوزات التي تحتاج إجراء بسبب غياب أو تعديل جدول"
            >
              <AlertTriangle />
              <span className="hidden min-[1100px]:inline">حجوزات تحتاج إجراء</span>
              <span className="min-[1100px]:hidden">حجوزات</span>
              {typeof affectedBookingsCount === 'number' && affectedBookingsCount > 0 ? (
                <span className="rounded-full bg-orange-500/30 px-1 text-[9px] font-bold">
                  {affectedBookingsCount}
                </span>
              ) : null}
            </Button>
          )}

          {onSettleExpired && (
            <Button
              type="button"
              variant="destructive"
              onClick={onSettleExpired}
              disabled={loading || settlingExpired}
              className={cn(
                toolbarAdminBtn,
                'border-destructive/25 bg-destructive/10 hover:bg-destructive/15',
              )}
            >
              <AlertTriangle />
              {settlingExpired ? 'جاري...' : 'تسوية المنتهية'}
            </Button>
          )}

          <EnvironmentControls
            voiceEnabled={voiceEnabled}
            musicExpanded={musicExpanded}
            onToggleVoice={handleToggleVoice}
            onToggleMusic={onToggleMusic}
            className="shrink-0 [&_button]:size-7 [&_button]:min-h-0 [&_button]:min-w-0 [&_button]:rounded-md [&_svg]:size-3"
          />
        </div>
      </div>

      {musicExpanded && (
        <SalonMusicPanel expanded={musicExpanded} onToggleExpand={onToggleMusic} />
      )}
    </section>
  );
}
