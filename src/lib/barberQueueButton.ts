export interface BarberQueueButtonBarber {
  empId: number;
  empName: string;
  status: 'working' | 'off' | 'day_off' | 'absent' | 'not_checked_in' | 'unknown';
  nextAvailableAt: string | null;
}

export interface BarberQueueButtonOptions {
  scheduleLoading?: boolean;
  canCreateQueue?: boolean;
  queueGloballyDisabled?: boolean;
}

export function getBarberQueueButtonState(
  barber: BarberQueueButtonBarber,
  options: BarberQueueButtonOptions = {},
): { enabled: boolean; tooltip: string } {
  const {
    scheduleLoading = false,
    canCreateQueue = true,
    queueGloballyDisabled = false,
  } = options;

  if (scheduleLoading) {
    return { enabled: false, tooltip: 'جاري تحميل الجدول...' };
  }
  if (queueGloballyDisabled) {
    return { enabled: false, tooltip: 'إنشاء الأدوار غير متاح حالياً' };
  }
  if (!canCreateQueue) {
    return { enabled: false, tooltip: 'ليس لديك صلاحية إنشاء دور' };
  }
  if (barber.status === 'day_off') {
    return { enabled: false, tooltip: 'الحلاق غير متاح اليوم' };
  }
  if (barber.status === 'absent') {
    return { enabled: false, tooltip: 'الحلاق غائب' };
  }
  if (barber.status === 'not_checked_in') {
    return { enabled: false, tooltip: 'الحلاق غير متاح اليوم' };
  }
  if (barber.status === 'off' && !barber.nextAvailableAt) {
    return { enabled: false, tooltip: 'الحلاق خارج وقت العمل' };
  }
  if (barber.status === 'unknown' && !barber.nextAvailableAt) {
    return { enabled: false, tooltip: 'الحلاق غير متاح اليوم' };
  }

  return { enabled: true, tooltip: 'إنشاء دور مع هذا الحلاق' };
}
