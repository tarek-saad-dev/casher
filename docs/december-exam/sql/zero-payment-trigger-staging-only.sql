-- ISOLATED STAGING ONLY. Never execute on production.
-- Requires a separately configured no-collection payment method.
SET XACT_ABORT ON;
IF DB_NAME()<>N'last132_agent' OR SUSER_SNAME()<>N'drvo_agent'
 THROW 51400,'DECEMBER_STAGING_ONLY',1;
IF (SELECT COUNT(*) FROM dbo.TblPaymentMethods WHERE PaymentMethod=N'بدون تحصيل - عرض ديسمبر')<>1
 THROW 51401,'DECEMBER_ZERO_PAYMENT_METHOD_REQUIRED',1;
DECLARE @def NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID(N'dbo.InsCashMoveSales'));
DECLARE @needle NVARCHAR(200)=N'WHERE i.invType = N''مبيعات''';
IF @def IS NULL OR @def NOT LIKE N'%TreasuryMovementRegistry%' OR @def NOT LIKE N'%i.BranchID IS NOT NULL%'
 THROW 51402,'DECEMBER_TRIGGER_REVIEW_REQUIRED',1;
IF @def LIKE N'%DECEMBER_ZERO_PAYMENT_STAGING_GUARD%' RETURN;
IF (LEN(@def)-LEN(REPLACE(@def,@needle,N'')))/LEN(@needle)<>1
 THROW 51403,'DECEMBER_TRIGGER_REVIEW_REQUIRED',1;
DECLARE @patch NVARCHAR(MAX)=@needle+N'
    -- DECEMBER_ZERO_PAYMENT_STAGING_GUARD
    AND NOT (i.GrandTotal=0 AND EXISTS(
      SELECT 1 FROM dbo.TblPaymentMethods pm WHERE pm.PaymentID=i.PaymentMethodID
      AND pm.PaymentMethod=N''بدون تحصيل - عرض ديسمبر''))';
SET @def=REPLACE(@def,@needle,@patch);
IF CHARINDEX(N'CREATE TRIGGER',@def)>0
 SET @def=STUFF(@def,CHARINDEX(N'CREATE TRIGGER',@def),LEN(N'CREATE TRIGGER'),N'ALTER TRIGGER');
ELSE IF CHARINDEX(N'ALTER TRIGGER',@def)=0
 THROW 51404,'DECEMBER_TRIGGER_REVIEW_REQUIRED',1;
BEGIN TRANSACTION;
EXEC sys.sp_executesql @def;
COMMIT;
