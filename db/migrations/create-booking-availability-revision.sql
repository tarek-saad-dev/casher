-- Booking V2 B8.5 — cross-instance availability revision counters (lightweight).
-- EmpID × BusinessDate (global EmpID). Deploy-time only. No CREATE from hot path.
-- Used for L1 freshness checks across Vercel instances without Redis.

IF OBJECT_ID(N'dbo.TblBookingAvailabilityRevision', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TblBookingAvailabilityRevision (
    EmpID                     INT NOT NULL,
    BusinessDate              DATE NOT NULL,
    EffectiveWorkRevision     INT NOT NULL
      CONSTRAINT DF_AvailRev_EW DEFAULT (0),
    BookingOccupancyRevision  INT NOT NULL
      CONSTRAINT DF_AvailRev_BK DEFAULT (0),
    HoldOccupancyRevision     INT NOT NULL
      CONSTRAINT DF_AvailRev_HD DEFAULT (0),
    QueueOccupancyRevision    INT NOT NULL
      CONSTRAINT DF_AvailRev_Q DEFAULT (0),
    UpdatedAtUtc              DATETIME2(3) NOT NULL
      CONSTRAINT DF_AvailRev_Updated DEFAULT (SYSUTCDATETIME()),
    CONSTRAINT PK_TblBookingAvailabilityRevision
      PRIMARY KEY (EmpID, BusinessDate)
  );

  CREATE NONCLUSTERED INDEX IX_AvailRev_Date_Emp
    ON dbo.TblBookingAvailabilityRevision (BusinessDate, EmpID)
    INCLUDE (
      EffectiveWorkRevision,
      BookingOccupancyRevision,
      HoldOccupancyRevision,
      QueueOccupancyRevision
    );
END
GO
