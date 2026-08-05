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
  /** Branch filter — default active session branch */
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

const primaryBtnClass =
  'h-11 min-h-[44px] gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition-all duration-150 focus-visible:ring-2 active:scale-[0.99] min-[768px]:h-[46px] md:h-[46px] [&_svg]:size-[18px]';

const adminBtnClass =
  'h-10 min-h-[42px] gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-all duration-150 min-[768px]:h-[42px] min-[768px]:text-sm [&_svg]:size-4';

const zoneDivider = 'hidden h-7 w-px shrink-0 bg-border/60 min-[1200px]:block';

function PrimaryActions({
  onQuickQueue,
  quickQueueLoading = false,
  onCreateQueue,
  onFindNearestQueue,
  onCreateBooking,
}: {
  onQuickQueue?: () => void;
  quickQueueLoading?: boolean;
  onCreateQueue: () => void;
  onFindNearestQueue?: () => void;
  onCreateBooking: () => void;
}) {
  const quickBtnClass = cn(
    primaryBtnClass,
    'h-12 min-h-[48px] border-2 border-accent/50 bg-accent/15 text-[15px] font-bold text-accent-foreground shadow-sm hover:border-accent/65 hover:bg-accent/25 hover:shadow-md focus-visible:ring-accent/35 min-[390px]:col-span-2 md:col-span-1 min-[1200px]:col-auto min-[1200px]:min-w-[150px] md:h-[46px] md:min-h-[46px]',
  );

  return (
    <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-2 md:grid-cols-2 min-[1200px]:flex min-[1200px]:flex-wrap min-[1200px]:items-center min-[1200px]:gap-2">
      {onQuickQueue && (
        <Button
          type="button"
          onClick={onQuickQueue}
          disabled={quickQueueLoading}
          aria-label="عمل دور سريع"
          aria-busy={quickQueueLoading}
          title="حلاقة شعر 30 دقيقة مع أقرب حلاق متاح وطباعة فورية"
          className={quickBtnClass}
        >
          {quickQueueLoading ? (
            <Loader2 className="size-[18px] shrink-0 animate-spin" />
          ) : (
            <TicketPlus className="shrink-0" />
          )}
          {quickQueueLoading ? 'جارٍ إنشاء الدور...' : 'عمل دور سريع'}
        </Button>
      )}

      <Button
        type="button"
        onClick={onCreateQueue}
        className={cn(
          primaryBtnClass,
          'h-12 min-h-[48px] bg-primary text-[15px] font-bold text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md focus-visible:ring-primary/40 min-[390px]:col-span-1 md:h-[46px] md:min-h-[46px] min-[1200px]:col-auto',
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
            primaryBtnClass,
            'h-12 min-h-[48px] border border-success/45 bg-success/20 text-[15px] font-bold text-success hover:bg-success/30 hover:border-success/55 focus-visible:ring-success/30 min-[390px]:col-span-1 md:h-[46px] md:min-h-[46px] min-[1200px]:col-auto',
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
          primaryBtnClass,
          'h-12 min-h-[48px] border-2 border-primary/40 bg-card text-[15px] font-bold text-foreground shadow-sm hover:border-primary/55 hover:bg-surface-muted hover:shadow-md focus-visible:ring-primary/30 min-[390px]:col-span-2 max-[389px]:col-span-1 md:col-span-1 md:h-[46px] md:min-h-[46px] min-[1200px]:col-auto',
        )}
      >
        <CalendarPlus className="shrink-0" />
        إنشاء حجز
      </Button>
    </div>
  );
}

function ManagementActions({
  loading,
  settlingExpired,
  voiceEnabled,
  musicExpanded,
  publicBookingEnabled,
  publicBookingToggleLoading,
  onScheduleControl,
  onTemporaryTransfer,
  onAffectedBookings,
  affectedBookingsCount,
  onSettleExpired,
  onToggleVoice,
  onToggleMusic,
  onTogglePublicBooking,
}: {
  loading?: boolean;
  settlingExpired?: boolean;
  voiceEnabled: boolean;
  musicExpanded: boolean;
  publicBookingEnabled: boolean;
  publicBookingToggleLoading?: boolean;
  onScheduleControl?: () => void;
  onTemporaryTransfer?: () => void;
  onAffectedBookings?: () => void;
  affectedBookingsCount?: number;
  onSettleExpired?: () => void;
  onToggleVoice: () => void;
  onToggleMusic: () => void;
  onTogglePublicBooking: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 md:gap-2 min-[1200px]:justify-center">
      <label
        className={cn(
          'inline-flex h-10 min-h-[42px] items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors min-[768px]:h-[42px] min-[768px]:text-sm',
          publicBookingEnabled
            ? 'border-success/35 bg-success/10 text-success'
            : 'border-destructive/30 bg-destructive/10 text-destructive',
          publicBookingToggleLoading && 'opacity-70',
        )}
        title={
          publicBookingEnabled
            ? 'حجز الموقع مفعّل — يظهر للحلاقين في الموقع'
            : 'حجز الموقع متوقف — الموقع يخفي الحلاقين ويعرض رسالة الواتساب'
        }
      >
        <Globe className="size-4 shrink-0" aria-hidden />
        <span className="whitespace-nowrap">
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
          className="h-5 w-9 data-[state=checked]:bg-success data-[state=unchecked]:bg-destructive/60"
        />
      </label>
      {onScheduleControl && (
        <Button
          type="button"
          variant="outline"
          onClick={onScheduleControl}
          className={cn(
            adminBtnClass,
            'border-border/80 bg-surface-muted/40 hover:bg-surface-muted/70',
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
            adminBtnClass,
            'border-amber-500/35 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15',
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
            adminBtnClass,
            'border-orange-500/40 bg-orange-500/10 text-orange-100 hover:bg-orange-500/15',
          )}
          title="الحجوزات التي تحتاج إجراء بسبب غياب أو تعديل جدول"
        >
          <AlertTriangle />
          حجوزات تحتاج إجراء
          {typeof affectedBookingsCount === 'number' && affectedBookingsCount > 0 ? (
            <span className="ms-1 rounded-full bg-orange-500/30 px-1.5 text-[11px] font-bold">
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
            adminBtnClass,
            'border-destructive/25 bg-destructive/10 hover:bg-destructive/15 focus-visible:ring-destructive/30',
          )}
        >
          <AlertTriangle />
          {settlingExpired ? 'جاري التسوية...' : 'تسوية المنتهية'}
        </Button>
      )}
      <EnvironmentControls
        voiceEnabled={voiceEnabled}
        musicExpanded={musicExpanded}
        onToggleVoice={onToggleVoice}
        onToggleMusic={onToggleMusic}
      />
    </div>
  );
}

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

  const selectClass =
    'h-10 min-h-[42px] rounded-lg border border-border/80 bg-surface-muted/40 px-2.5 text-[13px] font-medium text-foreground outline-none transition-colors hover:bg-surface-muted/70 focus-visible:ring-2 focus-visible:ring-primary/30 min-[768px]:h-[42px] min-[768px]:text-sm';

  return (
    <section className="flex shrink-0 flex-col gap-2 rounded-2xl border border-border/80 bg-card/80 px-3.5 py-2.5 shadow-sm backdrop-blur-sm md:px-4 md:py-3">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 pb-2">
        <label className="inline-flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
          <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">الفرع</span>
          <select
            className={cn(selectClass, 'min-w-0 flex-1 sm:min-w-[180px]')}
            value={branchSelectValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'all') onBranchScopeChange('all');
              else if (v === 'active') onBranchScopeChange('active');
              else onBranchScopeChange(Number(v));
            }}
            aria-label="فلتر الفرع"
          >
            <option value="active">
              فرعي الحالي{activeBranchLabel ? ` — ${activeBranchLabel}` : ''}
            </option>
            {branchOptions.map((b) => (
              <option key={b.branchId} value={String(b.branchId)}>
                {b.shortName || b.branchName}
              </option>
            ))}
            {branchOptions.length > 1 && <option value="all">كل الفروع</option>}
          </select>
        </label>

        <label className="inline-flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">الصنايعية</span>
          <select
            className={cn(selectClass, 'min-w-0 flex-1 sm:min-w-[180px]')}
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
      </div>

      <div
        className={cn(
          'grid grid-cols-1 gap-2',
          'md:grid-cols-[minmax(0,1fr)_auto] md:grid-rows-[auto_auto] md:gap-x-3 md:gap-y-2.5',
          'min-[1200px]:grid-cols-[max-content_minmax(0,1fr)_max-content] min-[1200px]:grid-rows-1 min-[1200px]:items-center min-[1200px]:gap-4',
        )}
      >
        <div className="order-1 md:col-span-2 md:row-start-2 md:flex md:justify-end min-[1200px]:col-span-1 min-[1200px]:col-start-3 min-[1200px]:row-start-1 min-[1200px]:flex min-[1200px]:items-center min-[1200px]:gap-3">
          <span className={zoneDivider} aria-hidden />
          <DateNavigator
            date={date}
            dateLabel={dateLabel}
            loading={loading}
            onPrevDay={onPrevDay}
            onNextDay={onNextDay}
            onToday={onToday}
            onDateSelect={onDateSelect}
            onRefresh={onRefresh}
            className="w-full md:w-auto"
            compact
          />
        </div>

        <div className="order-2 flex flex-col gap-2 md:col-span-2 md:row-start-1 md:flex-row md:flex-wrap md:items-center md:gap-x-3 md:gap-y-2 min-[1200px]:contents">
          <div className="flex shrink-0 items-center gap-3 min-[1200px]:col-start-1 min-[1200px]:row-start-1">
            <PrimaryActions
              onQuickQueue={onQuickQueue}
              quickQueueLoading={quickQueueLoading}
              onCreateQueue={onCreateQueue}
              onFindNearestQueue={onFindNearestQueue}
              onCreateBooking={onCreateBooking}
            />
            <span className={zoneDivider} aria-hidden />
          </div>

          <div className="min-[1200px]:col-start-2 min-[1200px]:row-start-1">
            <ManagementActions
              loading={loading}
              settlingExpired={settlingExpired}
              voiceEnabled={voiceEnabled}
              musicExpanded={musicExpanded}
              publicBookingEnabled={publicBookingEnabled}
              publicBookingToggleLoading={publicBookingToggleLoading}
              onScheduleControl={onScheduleControl}
              onTemporaryTransfer={onTemporaryTransfer}
              onAffectedBookings={onAffectedBookings}
              affectedBookingsCount={affectedBookingsCount}
              onSettleExpired={onSettleExpired}
              onToggleVoice={handleToggleVoice}
              onToggleMusic={onToggleMusic}
              onTogglePublicBooking={onTogglePublicBooking}
            />
          </div>
        </div>
      </div>

      {musicExpanded && (
        <SalonMusicPanel expanded={musicExpanded} onToggleExpand={onToggleMusic} />
      )}
    </section>
  );
}
