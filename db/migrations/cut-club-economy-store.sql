-- ============================================
-- CUT CLUB ECONOMY - STORE SYSTEM
-- Migration Script
-- ============================================
-- This migration creates the foundation for the CUT CLUB Store Economy
-- Transforms loyalty points into CUT Coins (CC) currency
-- Enables digital store, inventory, mystery boxes, and referral system
-- ============================================

-- ============================================
-- 1. TblLoyaltyStoreCategory
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TblLoyaltyStoreCategory]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[TblLoyaltyStoreCategory] (
        CategoryID INT IDENTITY(1,1) PRIMARY KEY,
        SalonID INT NULL, -- Multi-tenant support
        Code NVARCHAR(50) NOT NULL,
        NameAr NVARCHAR(100) NOT NULL,
        NameEn NVARCHAR(100) NOT NULL,
        DescriptionAr NVARCHAR(300) NULL,
        DescriptionEn NVARCHAR(300) NULL,
        Icon NVARCHAR(100) NULL,
        SortOrder INT NOT NULL DEFAULT 0,
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt DATETIME NULL,
        
        CONSTRAINT UQ_StoreCategory_Code UNIQUE (Code, SalonID)
    );
    
    CREATE INDEX IX_StoreCategory_SalonID_Active ON [dbo].[TblLoyaltyStoreCategory](SalonID, IsActive);
    CREATE INDEX IX_StoreCategory_SortOrder ON [dbo].[TblLoyaltyStoreCategory](SortOrder);
    
    PRINT 'Table TblLoyaltyStoreCategory created successfully';
END
ELSE
BEGIN
    PRINT 'Table TblLoyaltyStoreCategory already exists';
END
GO

-- ============================================
-- 2. TblLoyaltyStoreItem
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TblLoyaltyStoreItem]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[TblLoyaltyStoreItem] (
        ItemID INT IDENTITY(1,1) PRIMARY KEY,
        CategoryID INT NOT NULL,
        SalonID INT NULL, -- Multi-tenant support
        Code NVARCHAR(50) NOT NULL,
        NameAr NVARCHAR(100) NOT NULL,
        NameEn NVARCHAR(100) NOT NULL,
        DescriptionAr NVARCHAR(500) NOT NULL,
        DescriptionEn NVARCHAR(500) NOT NULL,
        
        -- Item Type determines behavior in POS/Booking
        ItemType NVARCHAR(50) NOT NULL,
        -- Possible Values: DISCOUNT_AMOUNT, DISCOUNT_PERCENT, FREE_SERVICE, FREE_PRODUCT, 
        --                  DOUBLE_POINTS, BONUS_POINTS, VIP_UPGRADE, PRIORITY_BOOKING, 
        --                  MYSTERY_BOX, CUSTOM
        
        PriceCoins DECIMAL(18,2) NOT NULL,
        Value DECIMAL(18,2) NULL, -- For discounts/bonuses
        
        -- References to existing entities
        ServiceID INT NULL, -- FK to TblService (for FREE_SERVICE)
        ProductID INT NULL, -- FK to TblProduct (for FREE_PRODUCT)
        
        -- Tier restriction
        MinTierID INT NULL, -- FK to TblLoyaltyTier
        
        -- Stock management
        StockQuantity INT NULL, -- NULL = unlimited
        UnlimitedStock BIT NOT NULL DEFAULT 0,
        
        -- Expiration
        ExpiresAfterDays INT NULL, -- Days until item expires after purchase
        
        -- UI/UX
        ImageUrl NVARCHAR(500) NULL,
        BadgeText NVARCHAR(50) NULL, -- e.g., "HOT", "NEW", "LIMITED"
        IsFeatured BIT NOT NULL DEFAULT 0,
        
        IsActive BIT NOT NULL DEFAULT 1,
        SortOrder INT NOT NULL DEFAULT 0,
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt DATETIME NULL,
        
        CONSTRAINT FK_StoreItem_Category FOREIGN KEY (CategoryID) 
            REFERENCES [dbo].[TblLoyaltyStoreCategory](CategoryID),
        CONSTRAINT FK_StoreItem_MinTier FOREIGN KEY (MinTierID) 
            REFERENCES [dbo].[TblLoyaltyTier](TierID),
        CONSTRAINT UQ_StoreItem_Code UNIQUE (Code, SalonID),
        CONSTRAINT CK_StoreItem_ItemType CHECK (ItemType IN (
            'DISCOUNT_AMOUNT', 'DISCOUNT_PERCENT', 'FREE_SERVICE', 'FREE_PRODUCT',
            'DOUBLE_POINTS', 'BONUS_POINTS', 'VIP_UPGRADE', 'PRIORITY_BOOKING',
            'MYSTERY_BOX', 'CUSTOM'
        )),
        CONSTRAINT CK_StoreItem_PriceCoins CHECK (PriceCoins >= 0)
    );
    
    CREATE INDEX IX_StoreItem_Category ON [dbo].[TblLoyaltyStoreItem](CategoryID);
    CREATE INDEX IX_StoreItem_SalonID_Active ON [dbo].[TblLoyaltyStoreItem](SalonID, IsActive);
    CREATE INDEX IX_StoreItem_Featured ON [dbo].[TblLoyaltyStoreItem](IsFeatured, IsActive);
    CREATE INDEX IX_StoreItem_ItemType ON [dbo].[TblLoyaltyStoreItem](ItemType);
    
    PRINT 'Table TblLoyaltyStoreItem created successfully';
END
ELSE
BEGIN
    PRINT 'Table TblLoyaltyStoreItem already exists';
END
GO

-- ============================================
-- 3. TblClientInventory
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TblClientInventory]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[TblClientInventory] (
        InventoryID INT IDENTITY(1,1) PRIMARY KEY,
        ClientID INT NOT NULL,
        ItemID INT NOT NULL,
        Quantity INT NOT NULL DEFAULT 1,
        
        -- Status lifecycle
        Status NVARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
        -- Possible Values: ACTIVE, USED, EXPIRED, CANCELLED
        
        PurchasePriceCoins DECIMAL(18,2) NOT NULL,
        VoucherCode NVARCHAR(100) NOT NULL, -- Unique code for redemption
        
        -- Timestamps
        PurchasedAt DATETIME NOT NULL DEFAULT GETDATE(),
        ExpiresAt DATETIME NULL,
        UsedAt DATETIME NULL,
        
        -- Usage tracking
        UsedInvID INT NULL, -- FK to TblInv (invoice where used)
        UsedBookingID INT NULL, -- FK to TblBooking (booking where used)
        
        Notes NVARCHAR(500) NULL,
        
        CONSTRAINT FK_ClientInventory_Client FOREIGN KEY (ClientID) 
            REFERENCES [dbo].[TblClient](ClientID),
        CONSTRAINT FK_ClientInventory_Item FOREIGN KEY (ItemID) 
            REFERENCES [dbo].[TblLoyaltyStoreItem](ItemID),
        CONSTRAINT CK_ClientInventory_Status CHECK (Status IN ('ACTIVE', 'USED', 'EXPIRED', 'CANCELLED')),
        CONSTRAINT CK_ClientInventory_Quantity CHECK (Quantity >= 0),
        CONSTRAINT UQ_ClientInventory_VoucherCode UNIQUE (VoucherCode)
    );
    
    CREATE INDEX IX_ClientInventory_Client_Status ON [dbo].[TblClientInventory](ClientID, Status);
    CREATE INDEX IX_ClientInventory_Item ON [dbo].[TblClientInventory](ItemID);
    CREATE INDEX IX_ClientInventory_ExpiresAt ON [dbo].[TblClientInventory](ExpiresAt);
    CREATE INDEX IX_ClientInventory_UsedInvID ON [dbo].[TblClientInventory](UsedInvID);
    CREATE INDEX IX_ClientInventory_VoucherCode ON [dbo].[TblClientInventory](VoucherCode);
    
    PRINT 'Table TblClientInventory created successfully';
END
ELSE
BEGIN
    PRINT 'Table TblClientInventory already exists';
END
GO

-- ============================================
-- 4. TblInventoryUsageLog
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TblInventoryUsageLog]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[TblInventoryUsageLog] (
        UsageID INT IDENTITY(1,1) PRIMARY KEY,
        InventoryID INT NOT NULL,
        ClientID INT NOT NULL,
        InvID INT NULL, -- FK to TblInv
        BookingID INT NULL, -- FK to TblBooking
        ActionType NVARCHAR(50) NOT NULL,
        -- Possible Values: USED, EXPIRED, CANCELLED, REFUNDED
        UsedAt DATETIME NOT NULL DEFAULT GETDATE(),
        Notes NVARCHAR(500) NULL,
        
        CONSTRAINT FK_InventoryUsageLog_Inventory FOREIGN KEY (InventoryID) 
            REFERENCES [dbo].[TblClientInventory](InventoryID),
        CONSTRAINT FK_InventoryUsageLog_Client FOREIGN KEY (ClientID) 
            REFERENCES [dbo].[TblClient](ClientID)
    );
    
    CREATE INDEX IX_InventoryUsageLog_Inventory ON [dbo].[TblInventoryUsageLog](InventoryID);
    CREATE INDEX IX_InventoryUsageLog_Client ON [dbo].[TblInventoryUsageLog](ClientID);
    CREATE INDEX IX_InventoryUsageLog_InvID ON [dbo].[TblInventoryUsageLog](InvID);
    CREATE INDEX IX_InventoryUsageLog_UsedAt ON [dbo].[TblInventoryUsageLog](UsedAt);
    
    PRINT 'Table TblInventoryUsageLog created successfully';
END
ELSE
BEGIN
    PRINT 'Table TblInventoryUsageLog already exists';
END
GO

-- ============================================
-- 5. TblMysteryBoxReward
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TblMysteryBoxReward]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[TblMysteryBoxReward] (
        RewardID INT IDENTITY(1,1) PRIMARY KEY,
        BoxItemID INT NOT NULL, -- FK to TblLoyaltyStoreItem (the mystery box itself)
        SalonID INT NULL, -- Multi-tenant support
        
        -- Reward details
        RewardType NVARCHAR(50) NOT NULL,
        -- Possible Values: COINS, STORE_ITEM, DISCOUNT, BONUS_POINTS, JACKPOT
        RewardValue DECIMAL(18,2) NOT NULL,
        RewardItemID INT NULL, -- FK to TblLoyaltyStoreItem (if reward is an item)
        
        -- Probability system (weighted random)
        ProbabilityWeight INT NOT NULL DEFAULT 1,
        -- Higher weight = higher chance
        -- Example: Weight 50 = 50%, Weight 25 = 25%, Weight 10 = 10%
        
        NameAr NVARCHAR(100) NOT NULL,
        NameEn NVARCHAR(100) NOT NULL,
        DescriptionAr NVARCHAR(300) NULL,
        DescriptionEn NVARCHAR(300) NULL,
        
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt DATETIME NULL,
        
        CONSTRAINT FK_MysteryBoxReward_BoxItem FOREIGN KEY (BoxItemID) 
            REFERENCES [dbo].[TblLoyaltyStoreItem](ItemID),
        CONSTRAINT FK_MysteryBoxReward_RewardItem FOREIGN KEY (RewardItemID) 
            REFERENCES [dbo].[TblLoyaltyStoreItem](ItemID),
        CONSTRAINT CK_MysteryBoxReward_Type CHECK (RewardType IN (
            'COINS', 'STORE_ITEM', 'DISCOUNT', 'BONUS_POINTS', 'JACKPOT'
        )),
        CONSTRAINT CK_MysteryBoxReward_Weight CHECK (ProbabilityWeight > 0)
    );
    
    CREATE INDEX IX_MysteryBoxReward_BoxItem ON [dbo].[TblMysteryBoxReward](BoxItemID);
    CREATE INDEX IX_MysteryBoxReward_Active ON [dbo].[TblMysteryBoxReward](IsActive);
    
    PRINT 'Table TblMysteryBoxReward created successfully';
END
ELSE
BEGIN
    PRINT 'Table TblMysteryBoxReward already exists';
END
GO

-- ============================================
-- 6. TblClientReferral
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TblClientReferral]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[TblClientReferral] (
        ReferralID INT IDENTITY(1,1) PRIMARY KEY,
        ReferrerClientID INT NOT NULL, -- Who referred
        ReferredClientID INT NULL, -- Who was referred (NULL until they register)
        SalonID INT NULL, -- Multi-tenant support
        
        ReferralCode NVARCHAR(50) NOT NULL UNIQUE,
        ReferredPhone NVARCHAR(20) NULL, -- Phone of referred person
        
        Status NVARCHAR(30) NOT NULL DEFAULT 'PENDING',
        -- Possible Values: PENDING, COMPLETED, EXPIRED, CANCELLED
        
        -- Reward tracking
        ReferrerRewardCoins DECIMAL(18,2) NULL,
        ReferredRewardCoins DECIMAL(18,2) NULL,
        ReferrerRewardGiven BIT NOT NULL DEFAULT 0,
        ReferredRewardGiven BIT NOT NULL DEFAULT 0,
        
        -- Timestamps
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        CompletedAt DATETIME NULL, -- When referred person made first purchase
        ExpiresAt DATETIME NULL,
        
        Notes NVARCHAR(500) NULL,
        
        CONSTRAINT FK_ClientReferral_Referrer FOREIGN KEY (ReferrerClientID) 
            REFERENCES [dbo].[TblClient](ClientID),
        CONSTRAINT FK_ClientReferral_Referred FOREIGN KEY (ReferredClientID) 
            REFERENCES [dbo].[TblClient](ClientID),
        CONSTRAINT CK_ClientReferral_Status CHECK (Status IN ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED'))
    );
    
    CREATE INDEX IX_ClientReferral_Referrer ON [dbo].[TblClientReferral](ReferrerClientID);
    CREATE INDEX IX_ClientReferral_Referred ON [dbo].[TblClientReferral](ReferredClientID);
    CREATE INDEX IX_ClientReferral_Code ON [dbo].[TblClientReferral](ReferralCode);
    CREATE INDEX IX_ClientReferral_Status ON [dbo].[TblClientReferral](Status);
    
    PRINT 'Table TblClientReferral created successfully';
END
ELSE
BEGIN
    PRINT 'Table TblClientReferral already exists';
END
GO

-- ============================================
-- 7. TblReferralReward
-- ============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TblReferralReward]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[TblReferralReward] (
        RewardRuleID INT IDENTITY(1,1) PRIMARY KEY,
        SalonID INT NULL, -- Multi-tenant support
        
        RuleName NVARCHAR(100) NOT NULL,
        ReferrerRewardCoins DECIMAL(18,2) NOT NULL,
        ReferredRewardCoins DECIMAL(18,2) NOT NULL,
        
        -- Conditions
        MinFirstPurchaseAmount DECIMAL(18,2) NULL, -- Referred must spend at least this
        RequireCompletedVisit BIT NOT NULL DEFAULT 1,
        
        -- Validity
        ValidFromDate DATETIME NULL,
        ValidToDate DATETIME NULL,
        
        IsActive BIT NOT NULL DEFAULT 1,
        IsDefault BIT NOT NULL DEFAULT 0, -- Default rule to use
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt DATETIME NULL
    );
    
    CREATE INDEX IX_ReferralReward_Active ON [dbo].[TblReferralReward](IsActive);
    CREATE INDEX IX_ReferralReward_Default ON [dbo].[TblReferralReward](IsDefault);
    
    PRINT 'Table TblReferralReward created successfully';
END
ELSE
BEGIN
    PRINT 'Table TblReferralReward already exists';
END
GO

-- ============================================
-- 8. Expand TblLoyaltyPointLedger for new movement types
-- ============================================
-- Add new movement types to support store economy
-- Existing types: EARN_SALE, ADJUST_ADD, ADJUST_SUBTRACT, REVERSAL, REDEEM, REFERRAL_BONUS
-- New types: STORE_PURCHASE, STORE_REFUND, INVENTORY_REWARD, MYSTERY_BOX_OPEN, 
--            DOUBLE_POINTS_BONUS, BONUS_POINTS_REWARD

PRINT 'TblLoyaltyPointLedger already exists and supports new movement types via NVARCHAR field';
PRINT 'New movement types can be used: STORE_PURCHASE, STORE_REFUND, INVENTORY_REWARD, MYSTERY_BOX_OPEN, DOUBLE_POINTS_BONUS, BONUS_POINTS_REWARD';
GO

-- ============================================
-- 9. Insert Default Store Categories
-- ============================================
IF NOT EXISTS (SELECT 1 FROM [dbo].[TblLoyaltyStoreCategory] WHERE Code = 'DISCOUNTS')
BEGIN
    INSERT INTO [dbo].[TblLoyaltyStoreCategory] (Code, NameAr, NameEn, DescriptionAr, DescriptionEn, Icon, SortOrder, IsActive)
    VALUES 
        ('DISCOUNTS', N'خصومات', 'Discounts', N'خصومات فورية على زيارتك القادمة', 'Instant discounts on your next visit', 'percent', 1, 1),
        ('FREE_SERVICES', N'خدمات مجانية', 'Free Services', N'خدمات مجانية مع زيارتك', 'Free services with your visit', 'gift', 2, 1),
        ('UPGRADES', N'ترقيات VIP', 'VIP Upgrades', N'ترقيات خاصة لتجربة VIP', 'Special upgrades for VIP experience', 'star', 3, 1),
        ('MYSTERY', N'صناديق المفاجآت', 'Mystery Boxes', N'افتح صندوق واحصل على مكافأة عشوائية', 'Open a box and get a random reward', 'box', 4, 1),
        ('SPECIAL', N'عروض خاصة', 'Special Offers', N'عروض محدودة ومميزة', 'Limited and exclusive offers', 'zap', 5, 1);
    
    PRINT 'Default store categories inserted successfully';
END
ELSE
BEGIN
    PRINT 'Default store categories already exist';
END
GO

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
PRINT '';
PRINT '============================================';
PRINT 'CUT CLUB ECONOMY - STORE SYSTEM';
PRINT 'Migration completed successfully';
PRINT '============================================';
PRINT '';
PRINT 'Tables created:';
PRINT '  - TblLoyaltyStoreCategory';
PRINT '  - TblLoyaltyStoreItem';
PRINT '  - TblClientInventory';
PRINT '  - TblInventoryUsageLog';
PRINT '  - TblMysteryBoxReward';
PRINT '  - TblClientReferral';
PRINT '  - TblReferralReward';
PRINT '';
PRINT 'Next steps:';
PRINT '  1. Run service layer implementation';
PRINT '  2. Create store APIs';
PRINT '  3. Create inventory APIs';
PRINT '  4. Create POS integration';
PRINT '  5. Test end-to-end flow';
PRINT '============================================';
GO
