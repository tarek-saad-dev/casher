-- Customer Follow-Up page indexes
-- Idempotent: safe to run multiple times

-- Index on TblClient.RegisterDate — supports Tab 1 (new customers range scan)
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.TblClient')
    AND name = 'IX_TblClient_RegisterDate'
)
  CREATE NONCLUSTERED INDEX IX_TblClient_RegisterDate
    ON dbo.TblClient (RegisterDate)
    INCLUDE (Name, Phone, Mobile, CameFrom, Notes);

-- Index on TblClient.BirthDate — supports Tab 2 (birthday month filter)
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.TblClient')
    AND name = 'IX_TblClient_BirthDate'
)
  CREATE NONCLUSTERED INDEX IX_TblClient_BirthDate
    ON dbo.TblClient (BirthDate)
    INCLUDE (Name, Phone, Mobile);

-- Composite index on TblinvServHead(ClientID, invDate) — supports visit stats CTE
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.TblinvServHead')
    AND name = 'IX_TblinvServHead_ClientID_invDate'
)
  CREATE NONCLUSTERED INDEX IX_TblinvServHead_ClientID_invDate
    ON dbo.TblinvServHead (ClientID, invDate)
    INCLUDE (GrandTotal, invType, isActive);
