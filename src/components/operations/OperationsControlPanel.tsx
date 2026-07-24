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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { DateNavigator } from './DateNavigator';
import { EnvironmentControls } from './EnvironmentControls';
import { SalonMusicPanel } from './SalonMusicPanel';

interface Props {
  date: string;
  dateLabel: string;
  loading?: boolean;
  settlingExpired?: boolean;
  voiceEnabled: boolean;
  musicExpanded: boolean;
  publicBookingEnabled: boolean;
  publicBookingToggleLoading?: boolean;
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

  return (
    <section className="flex shrink-0 flex-col gap-2 rounded-2xl border border-border/80 bg-card/80 px-3.5 py-2.5 shadow-sm backdrop-blur-sm md:px-4 md:py-3">
      <div
        className={cn(
          'grid grid-cols-1 gap-2',
          'md:grid-cols-[minmax(0,1fr)_auto] md:grid-rows-[auto_auto] md:gap-x-3 md:gap-y-2.5',
          'min-[1200px]:grid-cols-[max-content_minmax(0,1fr)_max-content] min-[1200px]:grid-rows-1 min-[1200px]:items-center min-[1200px]:gap-4',
        )}
      >
        {/* Date — mobile first; tablet row 2; desktop left zone (RTL col 3) */}
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

        {/* Primary + management — tablet row 1; desktop uses contents to join parent grid */}
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
