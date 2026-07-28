-- Phase 10A rollback (soft) — does NOT hard-delete history
-- 1) Suspend public Camp
UPDATE dbo.TblBranch
SET LifecycleStatus=N'INTERNAL_LIVE', IsActive=1, PublicBookingEnabled=0
WHERE BranchID=3 AND BranchCode=N'CAMP_CAESAR';
UPDATE dbo.QueueBookingSettings SET BookingEnabled=0 WHERE BranchID=3;

-- 2) Soft-end Ahmed @ Camp
UPDATE dbo.TblEmpBranchAssignment
SET IsActive=0, IsHomeBranch=0, EffectiveTo=CAST(GETDATE() AS date), UpdatedAt=SYSUTCDATETIME()
WHERE EmpID=18 AND BranchID=3 AND IsActive=1;
UPDATE dbo.TblEmpBranchWorkSchedule
SET IsActive=0, UpdatedAt=SYSUTCDATETIME()
WHERE EmpID=18 AND BranchID=3 AND IsActive=1;

-- 3) Re-activate Ahmed @ GLEEM (new row — do not revive deleted history blindly)
-- Prefer admin assignment wizard; example:
-- INSERT ... IsHomeBranch=1, CanReceiveBookings=1, EffectiveFrom=today
-- Then restore GLEEM weekly schedule via admin UI.
