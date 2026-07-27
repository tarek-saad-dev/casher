export interface FlowBoardBarber {
  empId: number;
  empName: string;
  status: 'working' | 'off' | 'day_off' | 'absent' | 'not_checked_in' | 'unknown';
  isWorkingDay: boolean;
  isDayOff: boolean;
  isAbsent: boolean;
  isLateStart: boolean;
  isEarlyLeave: boolean;
  currentAvailabilityStatus: string;
  statusReasonArabic: string;
  workStart: string | null;
  workEnd: string | null;
  isOvernightShift: boolean;
  /** Phase 1R — present via TblEmpTemporaryBranchTransfer */
  isEmergencyTransfer?: boolean;
  /** Set when board is loaded for a specific / multi branch view */
  branchId?: number;
  branchCode?: string;
  branchName?: string;
  branchShortName?: string | null;
  nextAvailableAt: string | null;
  waitingCount: number;
  bookingsCount: number;
  inServiceCount: number;
  timeline: Array<{
    type: 'queue' | 'booking' | 'gap';
    sourceId: number;
    label: string;
    startTime: string;
    endTime: string;
    status: string;
    protected: boolean;
    durationMinutes?: number;
    customerName?: string;
    serviceNames?: string[];
    barberId?: number;
    effectiveStatus?: string;
    actualStatus?: string;
    needsOperatorAction?: boolean;
    overdueMinutes?: number;
    expectedStartAt?: string;
    expectedEndAt?: string;
    isCountingAhead?: boolean;
    isBlockingAvailability?: boolean;
    startTimeDisplay?: string;
    endTimeDisplay?: string;
    dateDisplay?: string;
  }>;
}
