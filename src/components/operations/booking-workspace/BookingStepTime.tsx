'use client';

import { BookingStepAppointment } from './BookingStepAppointment';
import { BookingStepBarber } from './BookingStepBarber';
import {
  BORDER,
  GOLD,
  GOLD_BG,
  GOLD_BDR,
  type AvailableSlot,
  type BarberAlternative,
  type BookingMode,
  type BookingService,
  type BookingWorkspaceBarber,
  type GapNotice,
} from './types';
import type { SlotsViewState } from './useBookingWorkspace';

interface Props {
  mode: BookingMode;
  bookingDate: string;
  selectedBarberName: string;
  selectedServices: BookingService[];
  totalDuration: number;
  displaySlots: AvailableSlot[];
  availableSlots: AvailableSlot[];
  preferredRangeSlots: AvailableSlot[];
  slotsViewState: SlotsViewState;
  slotsError: string | null;
  softAvailabilityError?: string | null;
  slotStaleNotice?: string | null;
  slotsAreCurrent: boolean;
  selectedSlot: AvailableSlot | null;
  gapNotice: GapNotice | null;
  nextAvailable: AvailableSlot | null;
  alternativeBarbers: BarberAlternative[];
  hasTimeRange: boolean;
  filterByTimeRange: boolean;
  initialTimeRangeStart?: string;
  initialTimeRangeEnd?: string;
  lockedBarber: boolean;
  initialBarberName?: string;
  barbers: BookingWorkspaceBarber[];
  selectedBarberId: number | null;
  loadingBarbers?: boolean;
  employeeBranchCodes?: string[];
  selectedBranchCode?: string | null;
  onSelectSlot: (slot: AvailableSlot) => void;
  onToggleTimeRangeFilter: () => void;
  onChangeServices: () => void;
  onChangeDate: () => void;
  onModeChange: (mode: BookingMode) => void;
  onSelectBarber: (empId: number) => void;
  onSwitchNearest: () => void;
  onSelectAlternativeBarber: (empId: number) => void;
  onRetryAvailability?: () => void;
  onBranchChange?: (branchCode: string) => void;
}

/**
 * Time step = contextual barber/mode + appointment slots (merged former steps 1+3).
 */
export function BookingStepTime(props: Props) {
  const {
    lockedBarber,
    initialBarberName,
    mode,
    selectedBarberName,
    ...appointmentProps
  } = props;

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-foreground">الموعد والحلاق</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            اختر الوقت المتاح — أقرب ميعاد مُميَّز للتوصية وليس اختيارًا تلقائيًا
          </p>
        </div>
        {lockedBarber ? (
          <span
            className="px-3 py-1.5 rounded-lg border text-xs font-semibold"
            style={{ borderColor: GOLD_BDR, background: GOLD_BG, color: GOLD }}
          >
            {initialBarberName || selectedBarberName || 'حلاق محدد'}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {mode === 'nearest' ? 'وضع: أقرب حلاق' : `حلاق: ${selectedBarberName || '—'}`}
          </span>
        )}
      </div>

      {!lockedBarber && (
        <div className="rounded-xl border p-3 sm:p-4" style={{ borderColor: BORDER }}>
          <BookingStepBarber
            mode={props.mode}
            barbers={props.barbers}
            selectedBarberId={props.selectedBarberId}
            lockedBarber={lockedBarber}
            initialBarberName={initialBarberName}
            loadingBarbers={props.loadingBarbers}
            compact
            onModeChange={props.onModeChange}
            onSelectBarber={props.onSelectBarber}
          />
        </div>
      )}

      <BookingStepAppointment
        mode={mode}
        bookingDate={appointmentProps.bookingDate}
        selectedBarberName={selectedBarberName}
        selectedServices={appointmentProps.selectedServices}
        totalDuration={appointmentProps.totalDuration}
        displaySlots={appointmentProps.displaySlots}
        availableSlots={appointmentProps.availableSlots}
        preferredRangeSlots={appointmentProps.preferredRangeSlots}
        slotsViewState={appointmentProps.slotsViewState}
        slotsError={appointmentProps.slotsError}
        softAvailabilityError={appointmentProps.softAvailabilityError}
        slotStaleNotice={appointmentProps.slotStaleNotice}
        slotsAreCurrent={appointmentProps.slotsAreCurrent}
        selectedSlot={appointmentProps.selectedSlot}
        gapNotice={appointmentProps.gapNotice}
        nextAvailable={appointmentProps.nextAvailable}
        alternativeBarbers={appointmentProps.alternativeBarbers}
        hasTimeRange={appointmentProps.hasTimeRange}
        filterByTimeRange={appointmentProps.filterByTimeRange}
        initialTimeRangeStart={appointmentProps.initialTimeRangeStart}
        initialTimeRangeEnd={appointmentProps.initialTimeRangeEnd}
        lockedBarber={lockedBarber}
        employeeBranchCodes={appointmentProps.employeeBranchCodes}
        selectedBranchCode={appointmentProps.selectedBranchCode}
        onSelectSlot={appointmentProps.onSelectSlot}
        onToggleTimeRangeFilter={appointmentProps.onToggleTimeRangeFilter}
        onChangeServices={appointmentProps.onChangeServices}
        onChangeDate={appointmentProps.onChangeDate}
        onSwitchNearest={appointmentProps.onSwitchNearest}
        onSelectAlternativeBarber={appointmentProps.onSelectAlternativeBarber}
        onRetryAvailability={appointmentProps.onRetryAvailability}
        onBranchChange={appointmentProps.onBranchChange}
      />
    </div>
  );
}
