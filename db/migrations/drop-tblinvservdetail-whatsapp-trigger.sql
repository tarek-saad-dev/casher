-- ============================================================
-- Drop legacy WhatsApp INSERT trigger on TblinvServDetail.
-- App post-commit WhatsApp is the sole notification path.
-- Idempotent: safe to re-run.
-- ============================================================

IF OBJECT_ID(N'dbo.trg_TblinvServDetail_WhatsAppNotification', N'TR') IS NOT NULL
BEGIN
  DROP TRIGGER dbo.trg_TblinvServDetail_WhatsAppNotification;
  PRINT 'Dropped dbo.trg_TblinvServDetail_WhatsAppNotification';
END
ELSE
BEGIN
  PRINT 'Trigger dbo.trg_TblinvServDetail_WhatsAppNotification already absent';
END
GO
