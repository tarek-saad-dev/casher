-- Fix InsCashMoveSales trigger to include Notes column
-- This trigger auto-inserts into TblCashMove when a sale is created

-- First, check if trigger exists and get its definition
PRINT 'Checking current trigger definition...';

SELECT 
    name,
    OBJECT_DEFINITION(object_id) AS TriggerDefinition
FROM sys.triggers
WHERE name = 'InsCashMoveSales';

GO

-- Drop and recreate the trigger with proper column list including Notes
PRINT 'Dropping existing trigger if exists...';
IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'InsCashMoveSales')
BEGIN
    DROP TRIGGER [dbo].[InsCashMoveSales];
    PRINT 'Existing trigger dropped.';
END
GO

PRINT 'Creating InsCashMoveSales trigger with Notes column...';

CREATE TRIGGER [dbo].[InsCashMoveSales]
ON [dbo].[TblinvServHead]
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Insert cash movement record for sales
    INSERT INTO [dbo].[TblCashMove] (
        invID,
        invType,
        invDate,
        invTime,
        ClientID,
        ExpINID,
        GrandTolal,
        inOut,
        Notes,
        ShiftMoveID,
        PaymentMethodID
    )
    SELECT 
        i.invID,
        i.invType,
        i.invDate,
        i.invTime,
        i.ClientID,
        NULL AS ExpINID,  -- Sales don't have expense category
        i.GrandTotal AS GrandTolal,
        N'in' AS inOut,    -- Money coming in
        ISNULL(i.invNotes, N'مبيعات') AS Notes,
        i.ShiftMoveID,
        i.PaymentMethodID
    FROM inserted i
    WHERE i.invType = N'مبيعات';  -- Only process sales
END;
GO

PRINT 'Trigger InsCashMoveSales recreated successfully with Notes column.';
