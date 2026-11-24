-- STAFF EXPENSE DISTRIBUTION
-- Create system to automatically distribute shared expenses among staff members
-- Date: 2026-04-15

USE HawaiDB;
GO

-- 1. Create staff distribution table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TblStaffExpenseDistribution')
BEGIN
    CREATE TABLE [dbo].[TblStaffExpenseDistribution] (
        [ID] INT IDENTITY(1,1) PRIMARY KEY,
        [ExpenseCategoryID] INT NOT NULL,           -- FK to TblExpINCat
        [StaffMemberID] INT NOT NULL,              -- FK to TblEmp
        [DistributionPercentage] DECIMAL(5,2) NOT NULL, -- Percentage (e.g., 16.67)
        [IsActive] BIT DEFAULT 1,                  -- Enable/disable distribution
        [CreatedDate] DATETIME DEFAULT GETDATE(),
        [ModifiedDate] DATETIME DEFAULT GETDATE(),
        
        CONSTRAINT FK_StaffExpenseDist_Category FOREIGN KEY ([ExpenseCategoryID]) REFERENCES [dbo].[TblExpINCat]([ExpINID]),
        CONSTRAINT FK_StaffExpenseDist_Staff FOREIGN KEY ([StaffMemberID]) REFERENCES [dbo].[TblEmp]([EmpID]),
        CONSTRAINT CK_StaffExpenseDist_Percentage CHECK ([DistributionPercentage] > 0 AND [DistributionPercentage] <= 100)
    );
    
    CREATE INDEX IX_StaffExpenseDist_Category ON [dbo].[TblStaffExpenseDistribution]([ExpenseCategoryID]);
    CREATE INDEX IX_StaffExpenseDist_Staff ON [dbo].[TblStaffExpenseDistribution]([StaffMemberID]);
    CREATE INDEX IX_StaffExpenseDist_Active ON [dbo].[TblStaffExpenseDistribution]([IsActive]);
    
    PRINT 'Table TblStaffExpenseDistribution created successfully';
END
ELSE
BEGIN
    PRINT 'Table TblStaffExpenseDistribution already exists';
END
GO

-- 2. Create expense distribution details table (tracks actual distributions)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TblStaffExpenseDistributionDetail')
BEGIN
    CREATE TABLE [dbo].[TblStaffExpenseDistributionDetail] (
        [ID] INT IDENTITY(1,1) PRIMARY KEY,
        [OriginalExpenseID] INT NOT NULL,           -- FK to TblCashMove (original expense)
        [StaffMemberID] INT NOT NULL,               -- FK to TblEmp
        [DistributedAmount] DECIMAL(10,2) NOT NULL, -- Amount distributed to this staff member
        [CreatedDate] DATETIME DEFAULT GETDATE(),
        
        CONSTRAINT FK_StaffExpenseDistDetail_Expense FOREIGN KEY ([OriginalExpenseID]) REFERENCES [dbo].[TblCashMove]([ID]),
        CONSTRAINT FK_StaffExpenseDistDetail_Staff FOREIGN KEY ([StaffMemberID]) REFERENCES [dbo].[TblEmp]([EmpID])
    );
    
    CREATE INDEX IX_StaffExpenseDistDetail_Expense ON [dbo].[TblStaffExpenseDistributionDetail]([OriginalExpenseID]);
    CREATE INDEX IX_StaffExpenseDistDetail_Staff ON [dbo].[TblStaffExpenseDistributionDetail]([StaffMemberID]);
    
    PRINT 'Table TblStaffExpenseDistributionDetail created successfully';
END
ELSE
BEGIN
    PRINT 'Table TblStaffExpenseDistributionDetail already exists';
END
GO

-- 3. Create stored procedure to distribute expenses among staff
IF EXISTS (SELECT * FROM sys.objects WHERE type = 'P' AND name = 'sp_DistributeStaffExpense')
BEGIN
    DROP PROCEDURE [dbo].[sp_DistributeStaffExpense];
    PRINT 'Dropping existing sp_DistributeStaffExpense';
END
GO

CREATE PROCEDURE [dbo].[sp_DistributeStaffExpense]
    @ExpenseID INT,                              -- ID from TblCashMove
    @ExpenseCategoryID INT,                      -- ExpINID from TblCashMove
    @Amount DECIMAL(10,2),                       -- Total amount to distribute
    @CreatedDate DATETIME,                        -- Date of expense
    @ShiftMoveID INT,                            -- Shift for tracking
    @PaymentMethodID INT,                         -- Payment method
    @Notes NVARCHAR(MAX) = NULL                  -- Optional notes
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @TotalDistributed DECIMAL(10,2) = 0;
    DECLARE @StaffCount INT = 0;
    DECLARE @DistributionAmount DECIMAL(10,2);
    DECLARE @StaffMemberID INT;
    DECLARE @Percentage DECIMAL(5,2);
    
    -- Check if this category has active distribution setup
    IF NOT EXISTS (
        SELECT 1 FROM [dbo].[TblStaffExpenseDistribution] 
        WHERE ExpenseCategoryID = @ExpenseCategoryID AND IsActive = 1
    )
    BEGIN
        -- No distribution setup for this category
        SELECT 0 AS DistributedRecords, 0 AS TotalDistributed, 'No distribution setup for this category' AS Message;
        RETURN;
    END
    
    -- Begin transaction
    BEGIN TRY
        BEGIN TRANSACTION;
        
        -- Create cursor for staff distribution
        DECLARE StaffCursor CURSOR FOR
        SELECT StaffMemberID, DistributionPercentage
        FROM [dbo].[TblStaffExpenseDistribution]
        WHERE ExpenseCategoryID = @ExpenseCategoryID AND IsActive = 1
        ORDER BY StaffMemberID;
        
        OPEN StaffCursor;
        
        -- Generate new invID for staff expenses (type = 'staff_expense')
        DECLARE @NewInvID INT;
        SELECT @NewInvID = ISNULL(MAX(invID), 0) + 1
        FROM [dbo].[TblCashMove]
        WHERE invType = N'staff_expense';
        
        -- Create distribution records
        FETCH NEXT FROM StaffCursor INTO @StaffMemberID, @Percentage;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            -- Calculate distribution amount
            SET @DistributionAmount = (@Amount * @Percentage) / 100.0;
            SET @TotalDistributed = @TotalDistributed + @DistributionAmount;
            SET @StaffCount = @StaffCount + 1;
            
            -- Insert into distribution details table
            INSERT INTO [dbo].[TblStaffExpenseDistributionDetail] (
                OriginalExpenseID,
                StaffMemberID,
                DistributedAmount,
                CreatedDate
            ) VALUES (
                @ExpenseID,
                @StaffMemberID,
                @DistributionAmount,
                @CreatedDate
            );
            
            -- Create individual expense record for each staff member
            -- This creates a separate TblCashMove entry for each staff member
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
            ) VALUES (
                @NewInvID,
                N'staff_expense',
                @CreatedDate,
                CONVERT(NVARCHAR(8), GETDATE(), 108), -- HH:MM:SS
                NULL,
                @ExpenseCategoryID,
                @DistributionAmount,
                N'out',
                ISNULL(@Notes, N'Staff expense distribution') + N' - ' + 
                ISNULL((SELECT EmpName FROM [dbo].[TblEmp] WHERE EmpID = @StaffMemberID), N'Unknown Staff'),
                @ShiftMoveID,
                @PaymentMethodID
            );
            
            -- Increment invID for next staff member
            SET @NewInvID = @NewInvID + 1;
            
            FETCH NEXT FROM StaffCursor INTO @StaffMemberID, @Percentage;
        END
        
        CLOSE StaffCursor;
        DEALLOCATE StaffCursor;
        
        -- Handle rounding difference
        DECLARE @RoundingDiff DECIMAL(10,2) = @Amount - @TotalDistributed;
        IF ABS(@RoundingDiff) > 0.01 AND @StaffCount > 0
        BEGIN
            -- Add rounding difference to first staff member
            UPDATE [dbo].[TblStaffExpenseDistributionDetail]
            SET DistributedAmount = DistributedAmount + @RoundingDiff
            WHERE OriginalExpenseID = @ExpenseID
            AND StaffMemberID = (
                SELECT TOP 1 StaffMemberID 
                FROM [dbo].[TblStaffExpenseDistributionDetail] 
                WHERE OriginalExpenseID = @ExpenseID
                ORDER BY ID
            );
            
            -- Also update the corresponding TblCashMove record
            UPDATE cm
            SET GrandTolal = GrandTolal + @RoundingDiff
            FROM [dbo].[TblCashMove] cm
            WHERE cm.invType = N'staff_expense'
            AND cm.ExpINID = @ExpenseCategoryID
            AND cm.invDate = @CreatedDate
            AND cm.ID = (
                SELECT TOP 1 ID FROM [dbo].[TblCashMove]
                WHERE invType = N'staff_expense'
                AND ExpINID = @ExpenseCategoryID
                AND invDate = @CreatedDate
                ORDER BY ID
            );
            
            SET @TotalDistributed = @TotalDistributed + @RoundingDiff;
        END
        
        COMMIT TRANSACTION;
        
        -- Return results
        SELECT 
            @StaffCount AS DistributedRecords,
            @TotalDistributed AS TotalDistributed,
            CASE 
                WHEN @TotalDistributed = @Amount THEN 'Full distribution completed'
                ELSE 'Partial distribution - rounding difference applied'
            END AS Message;
        
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;
        
        SELECT 
            0 AS DistributedRecords,
            0 AS TotalDistributed,
            'Error: ' + ERROR_MESSAGE() AS Message;
        
        RETURN;
    END CATCH
    
END
GO

-- 4. Create trigger to automatically distribute expenses
IF EXISTS (SELECT * FROM sys.triggers WHERE name = 'trg_AutoDistributeStaffExpense')
BEGIN
    DROP TRIGGER [dbo].[trg_AutoDistributeStaffExpense];
    PRINT 'Dropping existing trg_AutoDistributeStaffExpense';
END
GO

CREATE TRIGGER [dbo].[trg_AutoDistributeStaffExpense]
ON [dbo].[TblCashMove]
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @ExpenseID INT;
    DECLARE @CategoryID INT;
    DECLARE @Amount DECIMAL(10,2);
    DECLARE @Date DATETIME;
    DECLARE @ShiftID INT;
    DECLARE @PaymentMethodID INT;
    DECLARE @Notes NVARCHAR(MAX);
    
    -- Process only expense records (not sales)
    IF EXISTS (SELECT 1 FROM inserted WHERE invType = N'expenses' AND inOut = N'out')
    BEGIN
        DECLARE ExpenseCursor CURSOR FOR
        SELECT 
            ID,
            ExpINID,
            GrandTolal,
            invDate,
            ShiftMoveID,
            PaymentMethodID,
            Notes
        FROM inserted
        WHERE invType = N'expenses' AND inOut = N'out';
        
        OPEN ExpenseCursor;
        
        FETCH NEXT FROM ExpenseCursor INTO @ExpenseID, @CategoryID, @Amount, @Date, @ShiftID, @PaymentMethodID, @Notes;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            -- Call distribution procedure
            EXEC [dbo].[sp_DistributeStaffExpense]
                @ExpenseID = @ExpenseID,
                @ExpenseCategoryID = @CategoryID,
                @Amount = @Amount,
                @CreatedDate = @Date,
                @ShiftMoveID = @ShiftID,
                @PaymentMethodID = @PaymentMethodID,
                @Notes = @Notes;
            
            FETCH NEXT FROM ExpenseCursor INTO @ExpenseID, @CategoryID, @Amount, @Date, @ShiftID, @PaymentMethodID, @Notes;
        END
        
        CLOSE ExpenseCursor;
        DEALLOCATE ExpenseCursor;
    END
END
GO

-- 5. Sample data setup for internet expense distribution
DECLARE @InternetCategoryID INT;
DECLARE @StaffMemberID INT;

-- Find or create "Internet" category
SELECT @InternetCategoryID = ExpINID FROM [dbo].[TblExpINCat] WHERE CatName LIKE N'%internet%';

IF @InternetCategoryID IS NULL
BEGIN
    -- Create Internet category if it doesn't exist
    INSERT INTO [dbo].[TblExpINCat] (CatName, ExpINType)
    VALUES (N'Internet', N'expenses');
    
    SELECT @InternetCategoryID = SCOPE_IDENTITY();
    PRINT 'Created Internet category with ID: ' + CAST(@InternetCategoryID AS NVARCHAR(10));
END

-- Setup equal distribution among staff (example: 6 staff members)
-- You would need to get actual staff member IDs from TblEmp
-- This is just example - replace with actual staff IDs

-- Example staff distribution (16.67% each for 6 staff members)
-- NOTE: Replace these IDs with actual EmpID values from TblEmp table
DECLARE @StaffIDs TABLE (EmpID INT, EmpName NVARCHAR(100));

-- Insert example staff members (replace with actual IDs)
-- INSERT INTO @StaffIDs (EmpID, EmpName) VALUES (1, N'Mohamed'), (2, N'Karim'), (3, N'Bassem'), (4, N'Hoda'), (5, N'Ziad'), (6, N'Ziad Assistant');

-- Clear existing distribution for Internet category
DELETE FROM [dbo].[TblStaffExpenseDistribution] 
WHERE ExpenseCategoryID = @InternetCategoryID;

-- Create equal distribution (you would use actual staff IDs)
/*
INSERT INTO [dbo].[TblStaffExpenseDistribution] (
    ExpenseCategoryID,
    StaffMemberID,
    DistributionPercentage,
    IsActive
)
SELECT 
    @InternetCategoryID,
    EmpID,
    16.67, -- Equal distribution for 6 staff members (100/6 = 16.67)
    1
FROM @StaffIDs;
*/

PRINT 'Setup completed for staff expense distribution';
PRINT 'To use: Add actual staff member IDs to the distribution table';
GO

-- 6. Reports for staff expense distribution
IF EXISTS (SELECT * FROM sys.views WHERE name = 'VwStaffExpenseSummary')
BEGIN
    DROP VIEW [dbo].[VwStaffExpenseSummary];
END
GO

CREATE VIEW [dbo].[VwStaffExpenseSummary] AS
SELECT 
    e.EmpID,
    e.EmpName,
    cat.CatName AS ExpenseCategory,
    COUNT(ded.ID) AS DistributionCount,
    SUM(ded.DistributedAmount) AS TotalDistributed,
    AVG(ded.DistributedAmount) AS AverageDistribution,
    MIN(ded.CreatedDate) AS FirstDistribution,
    MAX(ded.CreatedDate) AS LastDistribution
FROM [dbo].[TblEmp] e
INNER JOIN [dbo].[TblStaffExpenseDistributionDetail] ded ON e.EmpID = ded.StaffMemberID
INNER JOIN [dbo].[TblCashMove] cm ON ded.OriginalExpenseID = cm.ID
INNER JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
GROUP BY e.EmpID, e.EmpName, cat.CatName
ORDER BY e.EmpName, cat.CatName;
GO

PRINT 'Staff expense distribution system created successfully';
PRINT 'Next steps:';
PRINT '1. Add staff members to TblStaffExpenseDistribution table';
PRINT '2. Set distribution percentages for each expense category';
PRINT '3. Test by creating an expense with a distributed category';
PRINT '4. Check VwStaffExpenseSummary for distribution reports';
