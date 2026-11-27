-- MANUAL, FINANCE-APPROVED RELEASE STEP. Never executed by CI or auto deploy.
-- Run only after backup, comparison against the tested staging trigger and DBA approval.
-- Populate the 3 variables below. Defaults intentionally abort. Keep original trigger definition in backup.
SET XACT_ABORT ON;
DECLARE @tenant UNIQUEIDENTIFIER=NULL;
DECLARE @approvedTriggerHash VARCHAR(64)=NULL; -- hash from reviewed production definition
DECLARE @approval NVARCHAR(200)=NULL; -- approved release / backup reference
IF DB_NAME()<>N'last132' OR @tenant IS NULL OR NULLIF(LTRIM(RTRIM(@approval)),N'') IS NULL OR LEN(ISNULL(@approvedTriggerHash,''))<>64
 THROW 51410,'DECEMBER_PRODUCTION_APPROVAL_REQUIRED',1;
IF NOT EXISTS(SELECT 1 FROM dbo.Tenant WHERE TenantId=@tenant AND Code=N'CASHER_BOOT' AND Status=N'active')
 THROW 51411,'DECEMBER_TENANT_REQUIRED',1;
BEGIN TRY
 BEGIN TRANSACTION;
 DECLARE @def NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.InsCashMoveSales'));
 IF @def IS NULL OR CONVERT(varchar(64),HASHBYTES('SHA2_256',@def),2)<>UPPER(@approvedTriggerHash)
  THROW 51412,'DECEMBER_TRIGGER_HASH_MISMATCH',1;
 SET @def=REPLACE(@def,NCHAR(13),N'');
 DECLARE @needle NVARCHAR(200)=N'WHERE i.invType = N''مبيعات'''+NCHAR(10);
 IF @def NOT LIKE N'%TreasuryMovementRegistry%' OR @def NOT LIKE N'%i.BranchID IS NOT NULL%' OR @def LIKE N'%DECEMBER_ZERO_PAYMENT_STAGING_GUARD%'
  OR (LEN(@def)-LEN(REPLACE(@def,@needle,N'')))/LEN(@needle)<>1
  THROW 51413,'DECEMBER_TRIGGER_REVIEW_REQUIRED',1;
 IF NOT EXISTS(SELECT 1 FROM dbo.TblPaymentMethods WITH(UPDLOCK,HOLDLOCK) WHERE TenantId=@tenant AND PaymentMethod=N'بدون تحصيل - عرض ديسمبر')
  INSERT dbo.TblPaymentMethods(TenantId,PaymentMethod) VALUES(@tenant,N'بدون تحصيل - عرض ديسمبر');
 IF (SELECT COUNT(*) FROM dbo.TblPaymentMethods WHERE PaymentMethod=N'بدون تحصيل - عرض ديسمبر')<>1
  THROW 51414,'DECEMBER_ZERO_PAYMENT_METHOD_CONFLICT',1;
 DECLARE @method INT=(SELECT PaymentID FROM dbo.TblPaymentMethods WHERE TenantId=@tenant AND PaymentMethod=N'بدون تحصيل - عرض ديسمبر');
 IF @method IS NULL THROW 51415,'DECEMBER_ZERO_PAYMENT_METHOD_REQUIRED',1;
 DECLARE @patch NVARCHAR(MAX)=REPLACE(@needle,NCHAR(10),N'')+N'
    -- DECEMBER_ZERO_PAYMENT_STAGING_GUARD (reviewed release)
    AND NOT (i.GrandTotal=0 AND i.PaymentMethodID='+CONVERT(NVARCHAR(12),@method)+N' AND EXISTS(
      SELECT 1 FROM dbo.TblPaymentMethods pm WHERE pm.PaymentID=i.PaymentMethodID
      AND pm.TenantId=CONVERT(uniqueidentifier,N'''+CONVERT(NVARCHAR(36),@tenant)+N''')
      AND pm.PaymentMethod=N''بدون تحصيل - عرض ديسمبر''))'+NCHAR(10);
 SET @def=REPLACE(@def,@needle,@patch);
 IF CHARINDEX(N'CREATE OR ALTER TRIGGER',@def)>0
  SET @def=STUFF(@def,CHARINDEX(N'CREATE OR ALTER TRIGGER',@def),LEN(N'CREATE OR ALTER TRIGGER'),N'ALTER TRIGGER');
 ELSE IF CHARINDEX(N'CREATE TRIGGER',@def)>0
  SET @def=STUFF(@def,CHARINDEX(N'CREATE TRIGGER',@def),LEN(N'CREATE TRIGGER'),N'ALTER TRIGGER');
 ELSE IF CHARINDEX(N'ALTER TRIGGER',@def)=0 THROW 51416,'DECEMBER_TRIGGER_REVIEW_REQUIRED',1;
 EXEC sys.sp_executesql @def;
 IF OBJECT_DEFINITION(OBJECT_ID(N'dbo.InsCashMoveSales')) NOT LIKE N'%DECEMBER_ZERO_PAYMENT_STAGING_GUARD%'
  THROW 51417,'DECEMBER_TRIGGER_VERIFICATION_FAILED',1;
 COMMIT;
 SELECT @method AS PaymentMethodId,CONVERT(varchar(64),HASHBYTES('SHA2_256',OBJECT_DEFINITION(OBJECT_ID(N'dbo.InsCashMoveSales'))),2) AS TriggerHash;
END TRY
BEGIN CATCH
 IF XACT_STATE()<>0 ROLLBACK;
 THROW;
END CATCH;
