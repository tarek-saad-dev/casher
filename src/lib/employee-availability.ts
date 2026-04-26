import { getPool, sql } from '@/lib/db';

interface AvailabilityResult {
  isAvailable: boolean;
  reason?: string;
  schedule?: {
    DayOfWeek: number;
    IsWorkingDay: boolean;
    StartTime?: string;
    EndTime?: string;
    Notes?: string;
  };
}

/**
 * Get employee availability base on work schedule and days off
 * @param empId Employee ID
 * @param date Date to check (YYYY-MM-DD format)
 * @returns Availability result with reason if not available
 */
export async function getEmployeeAvailabilityBase(empId: number, date: string): Promise<AvailabilityResult> {
  try {
    const db = await getPool();
    
    // Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
    const checkDate = new Date(date);
    const dayOfWeek = checkDate.getDay();
    
    // Check if employee exists
    const empCheck = await db.request()
      .input("empId", sql.Int, empId)
      .query("SELECT EmpID, EmpName, isActive FROM dbo.TblEmp WHERE EmpID = @empId");
    
    if (empCheck.recordset.length === 0) {
      return {
        isAvailable: false,
        reason: 'الموظف غير موجود'
      };
    }
    
    const employee = empCheck.recordset[0];
    
    if (!employee.isActive) {
      return {
        isAvailable: false,
        reason: 'الموظف غير نشط'
      };
    }
    
    // Check if it's a day off
    const dayOffCheck = await db.request()
      .input("empId", sql.Int, empId)
      .input("offDate", sql.Date, date)
      .query(`
        SELECT OffType, Reason FROM dbo.TblEmpDayOff 
        WHERE EmpID = @empId AND OffDate = @offDate AND IsDeleted = 0
      `);
    
    if (dayOffCheck.recordset.length > 0) {
      const dayOff = dayOffCheck.recordset[0];
      const typeLabels = {
        day_off: 'إجازة',
        sick: 'إجازة مرضية',
        emergency: 'إجازة طارئة',
        annual: 'إجازة سنوية'
      };
      
      return {
        isAvailable: false,
        reason: `${typeLabels[dayOff.OffType as keyof typeof typeLabels] || 'إجازة'}${dayOff.Reason ? `: ${dayOff.Reason}` : ''}`
      };
    }
    
    // Get work schedule for the day
    const scheduleCheck = await db.request()
      .input("empId", sql.Int, empId)
      .input("dayOfWeek", sql.TinyInt, dayOfWeek)
      .query(`
        SELECT DayOfWeek, IsWorkingDay, StartTime, EndTime, Notes
        FROM dbo.TblEmpWorkSchedule 
        WHERE EmpID = @empId AND DayOfWeek = @dayOfWeek
      `);
    
    if (scheduleCheck.recordset.length === 0) {
      return {
        isAvailable: false,
        reason: 'لم يتم تحديد جدول عمل لهذا اليوم'
      };
    }
    
    const schedule = scheduleCheck.recordset[0];
    
    if (!schedule.IsWorkingDay) {
      return {
        isAvailable: false,
        reason: schedule.Notes || 'يوم إجازة أسبوعية',
        schedule
      };
    }
    
    // Employee is available during working hours
    return {
      isAvailable: true,
      schedule
    };
    
  } catch (error) {
    console.error('Error checking employee availability:', error);
    return {
      isAvailable: false,
      reason: 'خطأ في التحقق من التوفر'
    };
  }
}

/**
 * Get employee availability with time check
 * @param empId Employee ID
 * @param date Date to check (YYYY-MM-DD format)
 * @param time Time to check (HH:mm format)
 * @returns Availability result with time-specific reason
 */
export async function getEmployeeAvailabilityAtTime(
  empId: number, 
  date: string, 
  time: string
): Promise<AvailabilityResult> {
  // First check basic availability
  const baseAvailability = await getEmployeeAvailabilityBase(empId, date);
  
  if (!baseAvailability.isAvailable) {
    return baseAvailability;
  }
  
  // If available, check if within working hours
  if (baseAvailability.schedule?.StartTime && baseAvailability.schedule?.EndTime) {
    const startTime = baseAvailability.schedule.StartTime;
    const endTime = baseAvailability.schedule.EndTime;
    
    // Handle overnight shifts (e.g., 22:00 to 02:00)
    if (startTime > endTime) {
      // Overnight shift: available if time >= startTime OR time <= endTime
      if (time < startTime && time > endTime) {
        return {
          isAvailable: false,
          reason: `خارج ساعات العمل (${startTime} - ${endTime})`,
          schedule: baseAvailability.schedule
        };
      }
    } else {
      // Normal shift: available if startTime <= time <= endTime
      if (time < startTime || time > endTime) {
        return {
          isAvailable: false,
          reason: `خارج ساعات العمل (${startTime} - ${endTime})`,
          schedule: baseAvailability.schedule
        };
      }
    }
  }
  
  return {
    isAvailable: true,
    schedule: baseAvailability.schedule
  };
}

/**
 * Get multiple employees availability for a specific date
 * @param empIds Array of employee IDs
 * @param date Date to check (YYYY-MM-DD format)
 * @returns Array of availability results
 */
export async function getMultipleEmployeesAvailability(
  empIds: number[], 
  date: string
): Promise<Array<{empId: number} & AvailabilityResult>> {
  const results = await Promise.all(
    empIds.map(async (empId) => {
      const availability = await getEmployeeAvailabilityBase(empId, date);
      return { empId, ...availability };
    })
  );
  
  return results;
}

/**
 * SQL Query for employee availability (can be used directly in database)
 */
export const EMPLOYEE_AVAILABILITY_QUERY = `
DECLARE @EmpID INT = {empId};
DECLARE @CheckDate DATE = '{date}';
DECLARE @DayOfWeek TINYINT = DATEPART(WEEKDAY, @CheckDate) - 1; -- 0 = Sunday

-- Check if employee exists and is active
IF NOT EXISTS (SELECT 1 FROM dbo.TblEmp WHERE EmpID = @EmpID AND ISNULL(isActive, 1) = 1)
BEGIN
    SELECT 0 AS IsAvailable, N'الموظف غير موجود أو غير نشط' AS Reason;
    RETURN;
END

-- Check if it's a day off
IF EXISTS (
    SELECT 1 FROM dbo.TblEmpDayOff 
    WHERE EmpID = @EmpID AND OffDate = @CheckDate AND IsDeleted = 0
)
BEGIN
    SELECT 
        0 AS IsAvailable, 
        N'إجازة: ' + OffType + CASE WHEN Reason IS NOT NULL THEN N' - ' + Reason ELSE N'' END AS Reason
    FROM dbo.TblEmpDayOff 
    WHERE EmpID = @EmpID AND OffDate = @CheckDate AND IsDeleted = 0;
    RETURN;
END

-- Check work schedule
SELECT 
    CASE 
        WHEN ws.IsWorkingDay = 1 THEN 1 
        ELSE 0 
    END AS IsAvailable,
    CASE 
        WHEN ws.IsWorkingDay = 1 THEN N'متاح'
        ELSE ws.Notes
    END AS Reason,
    ws.DayOfWeek,
    ws.IsWorkingDay,
    ws.StartTime,
    ws.EndTime,
    ws.Notes
FROM dbo.TblEmpWorkSchedule ws
WHERE ws.EmpID = @EmpID AND ws.DayOfWeek = @DayOfWeek;
`;
