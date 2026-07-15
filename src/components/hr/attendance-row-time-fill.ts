/**
 * Re-export HR board D/N fill helpers from shared lib
 * so AttendancePanel and nightly close stay in sync.
 */
export {
  applyDefaultTimesToRow,
  applyNowTimesToRow,
  type AttendanceTimeFillRow,
} from '@/lib/hr/attendance-default-fill';
