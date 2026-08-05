'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type {
  AvailabilityLayerKey,
  AvailabilityLayerView,
} from '@/lib/availability/buildAvailabilityLayers';
import { AVAILABILITY_LAYER_TITLE_AR } from '@/lib/availability/workforceUiLabels';
import type { DailyAdjustmentType } from '@/lib/availability/dailyAdjustments';
import { WeeklyScheduleLayerControl } from '@/components/admin/workforce/layer-controls/WeeklyScheduleLayerControl';
import { AttendanceLayerControl } from '@/components/admin/workforce/layer-controls/AttendanceLayerControl';
import { LegacyOverridesLayerControl } from '@/components/admin/workforce/layer-controls/LegacyOverridesLayerControl';
import { DailyAdjustmentHistory } from '@/components/admin/workforce/DailyAdjustmentHistory';
import type { HistoryAdjustment } from '@/components/admin/workforce/DailyAdjustmentHistory';
import { DAILY_ADJUSTMENT_TYPE_AR } from '@/lib/availability/workforceUiLabels';

export function LayerControlModal({
  open,
  layerKey,
  layer,
  employeeId,
  employeeName,
  employmentType,
  isActive,
  job,
  businessDate,
  branchName,
  dailyAdjustments,
  onClose,
  onSaved,
  onOpenHrForm,
  onOpenTransfer,
  onOpenDailyAdjustment,
  onCancelAdjustment,
  cancellingId,
  onRefresh,
}: {
  open: boolean;
  layerKey: AvailabilityLayerKey | null;
  layer?: AvailabilityLayerView | null;
  employeeId: number;
  employeeName: string;
  employmentType?: string | null;
  isActive?: boolean;
  job?: string | null;
  businessDate: string;
  branchName?: string | null;
  dailyAdjustments: HistoryAdjustment[];
  onClose: () => void;
  onSaved: () => void;
  onOpenHrForm: () => void;
  onOpenTransfer: () => void;
  onOpenDailyAdjustment: (type: DailyAdjustmentType) => void;
  onCancelAdjustment: (id: number) => void;
  cancellingId: number | null;
  onRefresh: () => void;
}) {
  if (!open || !layerKey) return null;

  const title = AVAILABILITY_LAYER_TITLE_AR[layerKey] ?? layerKey;
  const attendance = (layer?.data?.attendance ?? null) as {
    status?: string | null;
    checkInTime?: string | null;
    checkOutTime?: string | null;
  } | null;

  const overridesFromPlan = (layer?.data?.overrides ?? []) as Array<{
    overrideId?: number;
    type?: string;
    typeAr?: string;
    startTime?: string | null;
    endTime?: string | null;
    reason?: string | null;
  }>;

  const overrideRows = overridesFromPlan.map((o) => ({
    overrideId: Number(o.overrideId ?? 0),
    type: o.type,
    startTime: o.startTime,
    endTime: o.endTime,
    reason: o.reason,
  }));

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-100"
        dir="rtl"
      >
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            تحكم · {title}
            <Badge variant="outline" className="text-[10px] font-normal">
              {employeeName}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-500">
            {businessDate}
            {branchName ? ` · ${branchName}` : ''} · تحكم كامل في هذه الطبقة من هنا
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          {layerKey === 'EMPLOYMENT' && (
            <div className="space-y-3">
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-zinc-500">الاسم</dt>
                  <dd className="text-zinc-200">{employeeName}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">الوظيفة</dt>
                  <dd className="text-zinc-200">{job || '—'}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">نوع التوظيف</dt>
                  <dd className="text-zinc-200">{employmentType || '—'}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">الحالة</dt>
                  <dd className="text-zinc-200">{isActive ? 'نشط' : 'موقوف'}</dd>
                </div>
              </dl>
              <p className="text-[11px] text-zinc-400">
                عدّل بيانات الموظف ونوع التوظيف والراتب الافتراضي من نموذج الموارد البشرية.
              </p>
              <Button type="button" onClick={onOpenHrForm}>
                فتح نموذج الموظف الكامل
              </Button>
            </div>
          )}

          {layerKey === 'BASE_SCHEDULE' && (
            <WeeklyScheduleLayerControl
              empId={employeeId}
              employeeName={employeeName}
              onSaved={onSaved}
            />
          )}

          {layerKey === 'TRANSFER_OR_FREELANCE' && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400">
                النقل المؤقت لهذا اليوم، أو فتح عمل للمستقل عبر الحضور.
              </p>
              {layer?.summaryAr && (
                <p className="text-[11px] text-zinc-300 rounded border border-zinc-800 px-2 py-1.5">
                  {layer.summaryAr}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={onOpenTransfer}>
                  فتح نافذة النقل المؤقت
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenDailyAdjustment('ADD_WINDOW')}
                >
                  إضافة فترة عمل اليوم
                </Button>
              </div>
              <p className="text-[11px] text-zinc-500">
                لفتح عمل المستقل: سجّل حضورًا من طبقة الحضور بعد اختيار «تحكم في هذه الطبقة» هناك.
              </p>
            </div>
          )}

          {layerKey === 'LEGACY_OVERRIDES' && (
            <LegacyOverridesLayerControl
              overrides={overrideRows}
              onOpenDaily={onOpenDailyAdjustment}
              onSaved={onSaved}
            />
          )}

          {layerKey === 'ATTENDANCE' && (
            <AttendanceLayerControl
              empId={employeeId}
              employeeName={employeeName}
              businessDate={businessDate}
              currentStatus={attendance?.status}
              checkInTime={attendance?.checkInTime}
              checkOutTime={attendance?.checkOutTime}
              onSaved={onSaved}
            />
          )}

          {layerKey === 'DAILY_ADJUSTMENTS' && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-400">
                التعديلات اليومية تتحكم في نوافذ هذا التاريخ فقط دون تغيير الجدول الأسبوعي.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    'CLOSE_DAY',
                    'REPLACE_WINDOWS',
                    'ADD_WINDOW',
                    'BLOCK_WINDOW',
                  ] as DailyAdjustmentType[]
                ).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={t === 'CLOSE_DAY' ? 'outline' : 'secondary'}
                    onClick={() => onOpenDailyAdjustment(t)}
                  >
                    {DAILY_ADJUSTMENT_TYPE_AR[t]}
                  </Button>
                ))}
              </div>
              <div>
                <h4 className="text-xs font-medium text-zinc-300 mb-1.5">التعديلات النشطة</h4>
                <DailyAdjustmentHistory
                  adjustments={dailyAdjustments}
                  cancellingId={cancellingId}
                  onRequestCancel={onCancelAdjustment}
                  emptyLabel="لا توجد تعديلات يومية نشطة."
                />
              </div>
            </div>
          )}

          {layerKey === 'FINAL_RESULT' && (
            <div className="space-y-3">
              <p className="text-xs text-zinc-300 whitespace-pre-line">
                {layer?.effectAr || layer?.summaryAr || 'النتيجة النهائية للقراءة فقط.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={onRefresh}>
                  تحديث الحساب
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      JSON.stringify(
                        {
                          employeeId,
                          businessDate,
                          layer: layer
                            ? {
                                key: layer.key,
                                status: layer.status,
                                summaryAr: layer.summaryAr,
                                data: layer.data,
                              }
                            : null,
                        },
                        null,
                        2,
                      ),
                    );
                  }}
                >
                  نسخ الملخص التقني
                </Button>
              </div>
              <p className="text-[11px] text-zinc-500">
                للتحكم: افتح الطبقة المسؤولة عن القرار (عادة الطبقة الموسومة «مصدر القرار»).
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
