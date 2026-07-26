# Phase 1R — Temporary Transfer UI

**Actions in «إدارة مواعيد اليوم»:**

- نقل اليوم لفرع آخر (outline gold)
- إلغاء النقل الطارئ (destructive, when active)

**APIs:**

- `POST .../temporary-transfer/preview`
- `POST .../temporary-transfer`
- `DELETE .../temporary-transfer`

`FromBranchID` is resolved from the schedule. Client `fromBranchId` mismatch → `TRANSFER_FROM_BRANCH_MISMATCH`.

Does **not** mutate `TblEmpBranchWorkSchedule` or legacy schedules.
