# تقرير Audit شامل - مواعيد الموظفين والحلاقين
**تاريخ التقرير:** 27 مايو 2026

---

## A) Executive Summary - الخلاصة التنفيذية

### ⚠️ الحالة الحالية: **غير موحدة - MEDIUM RISK**

النظام **ليس** موحدًا 100% في التعامل مع مواعيد الموظفين، لكنه يتجه نحو التوحيد. أغلبية المodules تستخدم `TblEmpWorkSchedule` كمصدر أساسي، لكن هناك:

- fallback على `DefaultCheckInTime/DefaultCheckOutTime` في حالات معينة
- بعض الأماكن تستخدم `new Date()` بدون Cairo timezone
- بعض الـ components الأمامية تستخدم `getHours()/getMinutes()` المحلية

### 🔴 أكثر 3 مشاكل خطورة:

1. **Timezone Inconsistency** - بعض الأماكن تستخدم `new Date()` بدون تحويل Cairo
2. **HR vs Operations Schedule Divergence** - `DefaultCheckInTime` في `TblEmp` يُستخدم fallback قد يتعارض مع `TblEmpWorkSchedule`
3. **Client-side Time Risk** - `getHours()/getMinutes()` في المتصفح يعتمد على جهاز العميل

### ✅ المصدر الفعلي الواحد:

**`lib/barberAvailability.ts`** هو أقرب ما يكون لـ Single Source of Truth - يستخدم Cairo timezone بشكل صحيح ويدعم overnight shifts.

---

## B) Source Map Table - جدول مصادر المواعيد

| Module | Files | Current Schedule Source | Timezone Handling | Overnight Support | Issues |
|--------|-------|------------------------|-------------------|-------------------|--------|
| **Public Booking - available-slots** | `app/api/public/booking/available-slots/route.ts` | ✅ `TblEmpWorkSchedule` | ✅ `Africa/Cairo` via `toLocaleDateString` | ✅ `hhmmToMinutes(end) <= hhmmToMinutes(start)` | None critical |
| **Public Booking - available-days** | `app/api/public/booking/available-days/route.ts` | ✅ `TblEmpWorkSchedule` | ✅ `getCairoDateParts` helper | ✅ Supports | None critical |
| **Public Booking - plan** | `app/api/public/booking/plan/route.ts` | ✅ `TblEmpWorkSchedule` | ✅ `new Date().toLocaleDateString('en-CA', {timeZone})` | ✅ Supported | None critical |
| **Operations - flow-board** | `app/api/operations/flow-board/route.ts` | ✅ `TblEmpWorkSchedule` | ⚠️ `new Date(`${date}T12:00:00`).getDay()` | ✅ `timeToMinutes(end) <= timeToMinutes(start)` | DayOfWeek uses noon UTC trick - safe |
| **Queue - simulate** | `lib/queueEstimateEngine.ts` | ✅ `getBarberWorkingWindow()` → `TblEmpWorkSchedule` | ✅ `SALON_TZ = 'Africa/Cairo'` | ✅ Supported | None |
| **Queue - timeline** | `lib/operationsQueueTimeline.ts` | ✅ `getBarberWorkingWindow()` | ✅ via helper | ✅ `isOvernightShift` flag | None |
| **Barber Availability** | `lib/barberAvailability.ts` | ✅ `TblEmpWorkSchedule` (primary) + `DefaultCheckInTime` (fallback) | ✅ `cairoHHMM()` + `cairoDateString()` | ✅ `withinWindow()` handles overnight | **Dual source - see below** |
| **Employee Availability** | `lib/employee-availability.ts` | ✅ `TblEmpWorkSchedule` | ⚠️ `new Date(date).getDay()` | ✅ logic exists | Uses server-local getDay() |
| **HR - Attendance** | `components/hr/AttendancePanel.tsx` | ✅ `TblEmpWorkSchedule` via API | ⚠️ Client-side `new Date()` | N/A | Client timezone risk |
| **HR - Payroll Settings** | `app/api/payroll/employees/[empId]/salary-settings` | ❌ `DefaultCheckInTime/DefaultCheckOutTime` only | N/A | ❌ Not considered | **Different source!** |
| **Schedule Overrides** | `lib/scheduleOverrides.ts` | ✅ `TblEmpWorkSchedule` base | ✅ via `available-slots` | ✅ `isOvernightBase` flag | Complex but correct |
| **Create Booking Drawer** | `components/operations/CreateBookingDrawer.tsx` | ❌ **Hardcoded** `'14:00'` default | ❌ None | N/A | **Hardcoded time!** |
| **Operations UI** | `components/operations/*.tsx` | ❌ Uses browser `getHours()/getMinutes()` | ❌ Client local time | N/A | **Timezone risk** |

---

## C) Hardcoded Times - الأوقات المُعَرفة يدويًا

| الملف | القيمة | السطر | الخطورة | المطلوب |
|-------|--------|-------|---------|---------|
| `EmployeeManagementModal.tsx` | `'09:00'` - `'17:00'` | 115-116 | ⚠️ Medium | ✅ آمن - default للـ UI فقط |
| `EmployeeManagementModal.tsx` | `'09:00'`, `'17:00'`, `'13:00'` | 696-698 | ⚠️ Medium | ✅ آمن - default للـ UI فقط |
| `CreateBookingDrawer.tsx` | `'14:00'` | 127 | 🔴 **HIGH** | ❌ يجب إزالة - يجب جلب من schedule |
| `timeUtils.ts` | `5` (cutoff hour) | 138 | ✅ Low | ✅ آمن - business logic |

### ملاحظة على `CreateBookingDrawer.tsx`:
```typescript
const [bookingTime, setBookingTime] = useState(initialTime || '14:00');
```
**المشكلة:** لو الحلاق شيفته تبدأ 11:00، الـ default يظل 14:00 وهذا مضلل.

**الحل:** جلب `workStart` من `flow-board` data واستخدامه كـ default.

---

## D) Timezone / Conversion Issues - مشاكل التحويل الزمني

### 🔴 أماكن تستخدم `new Date()` بدون Cairo (خطرة):

| الملف | السطر | الاستخدام | الخطورة |
|-------|-------|-----------|---------|
| `timeUtils.ts:getBusinessDateStr` | 139 | `new Date()` + `getHours()` | ⚠️ Medium - للعرض فقط |
| `employee-availability.ts` | 30 | `new Date(date).getDay()` | ⚠️ Medium - يفترض server = Cairo |
| `AttendancePanel.tsx` | 52 | `new Date()` + `getHours()` | 🔴 **HIGH** - client timezone! |
| `AttendanceReminder.tsx` | 34 | `new Date()` + `getHours()` | 🔴 **HIGH** - client timezone! |
| `payroll/AttendanceTab.tsx` | 56 | `new Date()` + `getHours()` | 🔴 **HIGH** - client timezone! |
| `expenses/page.tsx` | 300 | `new Date()` + `getHours()` | ⚠️ Low - للإيصال فقط |
| **Most UI components** | Various | `date.getHours()` | 🔴 **HIGH** - جميعها client-local |

### ✅ أماكن آمنة (تستخدم Cairo timezone):

| الملف | الدالة/الطريقة |
|-------|----------------|
| `barberAvailability.ts` | `cairoHHMM()` - uses `Intl.DateTimeFormat` with `timeZone: 'Africa/Cairo'` |
| `barberAvailability.ts` | `cairoDateString()` - uses `toLocaleDateString('en-CA', {timeZone: 'Africa/Cairo'})` |
| `queueEstimateEngine.ts` | `cairoDateStr()` - نفس الطريقة |
| `publicBookingHelpers.ts` | `salonDateTimeToMs()` - يحسب offset بين server و Cairo |
| `queueTicketNormalizer.ts` | `BUSINESS_DATE_CAIRO()` - صحيح |

---

## E) DayOfWeek Issues - مشاكل أيام الأسبوع

### ✅ الحالة: **متوافقة بشكل عام**

| Module | Mapping | الحالة |
|--------|---------|--------|
| `TblEmpWorkSchedule` DB | 0=Sun, 6=Sat | ✅ Standard |
| `barberAvailability.ts` | `getDay()` → 0-6 | ✅ matches DB |
| `employee-availability.ts` | `getDay()` → 0-6 | ✅ matches DB |
| `available-days.ts` | `getDay()` → 0-6 | ✅ matches DB |
| `available-slots.ts` | `getDay()` → 0-6 | ✅ matches DB |
| `flow-board.ts` | `getDay()` → 0-6 | ✅ matches DB |
| `EmployeeManagementModal.tsx` | 0-6 mapping | ✅ matches DB |

### التعليق الموجود في الكود (صحيح):
```typescript
// lib/barberAvailability.ts line 10:
"DayOfWeek: 0=Sunday … 6=Saturday (JS Date.getDay() convention, matches TblEmpWorkSchedule)"
```

**الحكم:** ✅ لا يوجد مشكلة DayOfWeek. JavaScript `getDay()` يطابق DB مباشرة.

---

## F) Overnight Shift Issues - الشيفات الممتدة

### ✅ الحالة: **مدعومة بشكل جيد**

| Module | Detection Logic | الحالة |
|--------|-----------------|--------|
| `barberAvailability.ts` | `startMin > endMin` in `withinWindow()` | ✅ Correct |
| `queueEstimateEngine.ts` | `startMin <= endMin` else overnight | ✅ Correct |
| `operationsQueueTimeline.ts` | `timeToMinutes(end) <= timeToMinutes(start)` | ✅ Correct |
| `available-slots.ts` | `hhmmToMinutes(end) <= hhmmToMinutes(start)` | ✅ Correct |
| `scheduleOverrides.ts` | `isOvernightBase` flag | ✅ Correct |
| `BarberLane.tsx` | `isOvernight && endHour <= 4` | ✅ Correct |
| `schedulerUtils.ts` | `hour >= 0 && hour <= 4` → +24 | ✅ Correct for display |

### مثال صحيح من `barberAvailability.ts`:
```typescript
function withinWindow(checkMin: number, startMin: number, endMin: number): boolean {
  if (startMin <= endMin) {
    return checkMin >= startMin && checkMin < endMin;
  }
  // Overnight: e.g. start=720 (12:00), end=120 (02:00)
  return checkMin >= startMin || checkMin < endMin;
}
```

**الحكم:** ✅ Overnight shifts مدعومة بشكل صحيح في جميع الـ backend modules.

---

## G) Queue vs Booking Status Filters - فلاتر الحالة

### ✅ موحدة بشكل جيد:

| Source | LIVE_STATUSES | DONE_STATUSES |
|--------|---------------|---------------|
| `lib/queueTicketNormalizer.ts` | `['waiting','called','arrived','in_service','skipped']` | ✅ Master source |
| `app/queue/live/page.tsx` | نفس القائمة | ✅ Consistent |
| `GroupedQueueBoard.tsx` | imports from normalizer | ✅ Consistent |
| `LiveQueueColumn.tsx` | imports from normalizer | ✅ Consistent |

### ملاحظة:
جميع الـ UI components تستورد من `queueTicketNormalizer.ts` - **هذا جيد وموحد.**

---

## H) minNoticeMinutes - التحقق من وقت الحجز

### ✅ التطبيق صحيح:

| Module | Applied to | الحالة |
|--------|-----------|--------|
| `available-slots.ts` | Public bookings | ✅ Correct |
| `available-days.ts` | Public bookings | ✅ Correct |
| `plan/route.ts` | Public bookings | ✅ Correct |
| `create/route.ts` | Public only (`!isInternalSource`) | ✅ Correct |

### الملاحظة المهمة من `create/route.ts`:
```typescript
// Line 131: Prevent bookings too soon (only for public bookings)
// Operations/admin bookings can book immediately (skip minNotice)
```

**الحكم:** ✅ `minNoticeMinutes` لا يُطبق على admin/operations bookings - هذا صحيح.

---

## I) المشكلة الخطيرة: Dual Source في Barber Availability

### الملف: `lib/barberAvailability.ts` (السطور 135-158)

```typescript
// Fallback to TblEmp.DefaultCheckInTime/DefaultCheckOutTime if TblEmpWorkSchedule row missing
const empRes = await db.request()
  .input('empId', sql.Int, empId)
  .query(`
    SELECT CONVERT(VARCHAR(5), DefaultCheckInTime, 108) AS DefaultCheckInTime,
           CONVERT(VARCHAR(5), DefaultCheckOutTime, 108) AS DefaultCheckOutTime
    FROM dbo.TblEmp WHERE EmpID = @empId
  `);
const emp = empRes.recordset[0];
if (!emp?.DefaultCheckInTime || !emp?.DefaultCheckOutTime) {
  return { available: true, reason: 'متاح', startTime: null, endTime: null };
}
```

### 🔴 المشكلة:
1. `DefaultCheckInTime` في `TblEmp` هو **موعد حضور ثابت** لغرض الـ Payroll/HR
2. `TblEmpWorkSchedule` هو **الجدول الأسبوعي المتغير** لغرض Operations
3. الحلاق قد يكون له حضور 09:00 في `TblEmp` لكن جدوله الفعلي في `TblEmpWorkSchedule` يبدأ 14:00 يوم الجمعة مثلاً
4. الـ fallback قد يُظهر الحلاق متاحًا في 09:00 بينما هو في إجازة فعلياً!

### التوصية:
**إزالة** fallback على `DefaultCheckInTime/DefaultCheckOutTime` من `barberAvailability.ts`. إذا لم يوجد schedule في `TblEmpWorkSchedule`:
- إما اعتبر الحلاق غير متاح (`available: false`)
- أو return `null` ليتم التعامل معه في الطبقة العليا

---

## J) Recommended Architecture - المعماريّة المقترحة

### الهيكل المقترح:

```
src/lib/scheduling/
├── employeeSchedule.ts          # المصدر الواحد للمواعيد
├── timezone.ts                  # Cairo timezone helpers
├── statusFilters.ts             # LIVE_STATUSES, etc.
└── types.ts                     # Shared interfaces
```

### الدوال المطلوبة في `employeeSchedule.ts`:

```typescript
// Core schedule retrieval
export async function getEmployeeSchedule(empId: number, date: Date): Promise<ScheduleResult>

// Working window
export async function getWorkingWindow(empId: number, date: Date): Promise<WorkingWindow>

// Availability check (uses getWorkingWindow internally)
export async function isEmployeeAvailable(empId: number, dateTime: Date): Promise<boolean>

// Timezone-safe helpers
export function getCairoDateString(date: Date): string
export function getCairoTimeString(date: Date): string
export function getCairoDayOfWeek(date: Date): number // 0-6

// Overnight detection
export function isOvernightShift(startTime: string, endTime: string): boolean

// Status filters (moved from queueTicketNormalizer)
export const LIVE_QUEUE_STATUSES = ['waiting', 'called', 'arrived', 'in_service', 'skipped']
export const DONE_QUEUE_STATUSES = ['done', 'cancelled', 'no_show']
export const ACTIVE_BOOKING_STATUSES = ['confirmed', 'arrived']
```

### الخطوات المطلوبة:

#### Phase 1: Foundation (آمن وصغير)
1. **Create** `src/lib/scheduling/timezone.ts` with Cairo helpers
2. **Move** all Cairo-related functions from various files to this central location
3. **Create** `src/lib/scheduling/statusFilters.ts` and move LIVE_STATUSES there
4. **Update** imports (safe refactoring)

#### Phase 2: Unify Schedule Source (يحتاج اختبار)
1. **Modify** `barberAvailability.ts` to remove `DefaultCheckInTime` fallback
2. **Test** all scenarios (day off, overnight, missing schedule)
3. **Update** `employee-availability.ts` to use `getCairoDayOfWeek()`

#### Phase 3: Fix Client-Side Time (متوسط الخطورة)
1. **Create** server API endpoint for current Cairo time
2. **Update** all UI components to fetch time from server instead of `new Date()`
3. **Or**: Pass server time via props/context

#### Phase 4: Remove Hardcoded Defaults (سهل)
1. **Update** `CreateBookingDrawer.tsx` to use `workStart` from flow-board data
2. **Remove** `'14:00'` hardcoded default

---

## K) Test Cases Required - حالات الاختبار المطلوبة

بعد أي إصلاح، يجب اختبار:

| السيناريو | التوقعات | الأولوية |
|-----------|----------|----------|
| حلاق شيفته عادية (09:00-17:00) | يظهر متاح في الساعات الصحيحة | P1 |
| حلاق شيفته overnight (14:00-02:00) | يظهر متاح بعد منتصف الليل | P1 |
| يوم إجازة أسبوعية | يظهر "يوم إجازة" | P1 |
| حجز عبر public بعد 12:00 ص | يُحجز في اليوم الصحيح | P1 |
| queue ticket stale (من الأمس) | لا يُعتمد في حساب التوفر | P2 |
| جهاز client timezone مختلف | يعرض الأوقات بشكل صحيح | P2 |
| حلاق بدون schedule في TblEmpWorkSchedule | يظهر "غير متاح" أو "لا يوجد جدول" | P2 |

---

## L) القرارات المطلوبة منك

### 1. هل نحذف fallback على `DefaultCheckInTime`؟
- ✅ **موصى به**: نعم، احذفه - `TblEmpWorkSchedule` فقط هو المصدر
- ⚠️ **الخطر**: لو جدول الموظفين غير مكتمل، سيظهر الجميع غير متاحين

### 2. كيف نتعامل مع Client-side Time؟
- **خيار A**: Server API endpoint للوقت الحالي (أكثر أمانًا)
- **خيار B**: Pass server time via page props (أسهل)
- **خيار C**: افترض أن Cairo = Server (المستخدم الحالي)

### 3. هل نبدأ بـ Phase 1 فورًا؟
- ✅ آمن ولا يغير سلوك النظام
- يحسن الصيانة المستقبلية فقط

---

## M) قائمة الملفات التي تحتاج تعديل (مرتبة حسب الأولوية)

| الأولوية | الملف | التعديل المطلوب |
|----------|-------|----------------|
| 🔴 P1 | `lib/barberAvailability.ts` | إزالة fallback على DefaultCheckInTime |
| 🔴 P1 | `components/operations/CreateBookingDrawer.tsx` | استخدام workStart من flow-board بدلاً من '14:00' |
| 🟡 P2 | `lib/employee-availability.ts` | استخدام Cairo timezone helpers |
| 🟡 P2 | `components/hr/AttendancePanel.tsx` | استخدام server time بدلاً من client time |
| 🟡 P2 | `components/hr/AttendanceReminder.tsx` | استخدام server time |
| 🟢 P3 | Create `lib/scheduling/` | توحيد helpers في مكان واحد |
| 🟢 P3 | `lib/queueTicketNormalizer.ts` | نقل LIVE_STATUSES إلى scheduling module |

---

**نهاية التقرير**
