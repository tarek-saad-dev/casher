-- ============================================
-- CUT CLUB ECONOMY - Sample Data Seeds
-- ============================================
-- This script inserts sample data for testing the store system
-- ============================================

PRINT 'Inserting sample store items...';

-- ============================================
-- Sample Store Items - DISCOUNTS Category
-- ============================================
DECLARE @DiscountsCategoryID INT;
SELECT @DiscountsCategoryID = CategoryID FROM [dbo].[TblLoyaltyStoreCategory] WHERE Code = 'DISCOUNTS';

IF @DiscountsCategoryID IS NOT NULL
BEGIN
    -- 50 EGP Discount
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblLoyaltyStoreItem] WHERE Code = 'DISC_50')
    BEGIN
        INSERT INTO [dbo].[TblLoyaltyStoreItem] (
            CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
            ItemType, PriceCoins, Value, MinTierID, UnlimitedStock, ExpiresAfterDays,
            BadgeText, IsFeatured, IsActive, SortOrder
        )
        VALUES (
            @DiscountsCategoryID, 'DISC_50', N'خصم 50 جنيه', 'EGP 50 Discount',
            N'خصم فوري 50 جنيه على زيارتك القادمة', 'Instant EGP 50 discount on your next visit',
            'DISCOUNT_AMOUNT', 220, 50, NULL, 1, 30,
            'HOT', 1, 1, 1
        );
        PRINT '  ✓ Added: 50 EGP Discount';
    END

    -- 100 EGP Discount
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblLoyaltyStoreItem] WHERE Code = 'DISC_100')
    BEGIN
        INSERT INTO [dbo].[TblLoyaltyStoreItem] (
            CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
            ItemType, PriceCoins, Value, MinTierID, UnlimitedStock, ExpiresAfterDays,
            IsFeatured, IsActive, SortOrder
        )
        VALUES (
            @DiscountsCategoryID, 'DISC_100', N'خصم 100 جنيه', 'EGP 100 Discount',
            N'خصم فوري 100 جنيه على زيارتك القادمة', 'Instant EGP 100 discount on your next visit',
            'DISCOUNT_AMOUNT', 400, 100, NULL, 1, 30,
            1, 1, 2
        );
        PRINT '  ✓ Added: 100 EGP Discount';
    END

    -- 20% Discount
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblLoyaltyStoreItem] WHERE Code = 'DISC_20PCT')
    BEGIN
        INSERT INTO [dbo].[TblLoyaltyStoreItem] (
            CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
            ItemType, PriceCoins, Value, MinTierID, UnlimitedStock, ExpiresAfterDays,
            BadgeText, IsFeatured, IsActive, SortOrder
        )
        VALUES (
            @DiscountsCategoryID, 'DISC_20PCT', N'خصم 20%', '20% Discount',
            N'خصم 20% على إجمالي الفاتورة', '20% discount on total invoice',
            'DISCOUNT_PERCENT', 350, 20, NULL, 1, 30,
            'POPULAR', 1, 1, 3
        );
        PRINT '  ✓ Added: 20% Discount';
    END
END

-- ============================================
-- Sample Store Items - FREE_SERVICES Category
-- ============================================
DECLARE @FreeServicesCategoryID INT;
SELECT @FreeServicesCategoryID = CategoryID FROM [dbo].[TblLoyaltyStoreCategory] WHERE Code = 'FREE_SERVICES';

IF @FreeServicesCategoryID IS NOT NULL
BEGIN
    -- Free Styling
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblLoyaltyStoreItem] WHERE Code = 'FREE_STYLING')
    BEGIN
        INSERT INTO [dbo].[TblLoyaltyStoreItem] (
            CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
            ItemType, PriceCoins, Value, MinTierID, UnlimitedStock, ExpiresAfterDays,
            IsFeatured, IsActive, SortOrder
        )
        VALUES (
            @FreeServicesCategoryID, 'FREE_STYLING', N'تسريح مجاني', 'Free Styling',
            N'خدمة تسريح مجانية مع زيارتك القادمة', 'Free styling service with your next visit',
            'FREE_SERVICE', 300, NULL, NULL, 1, 45,
            1, 1, 1
        );
        PRINT '  ✓ Added: Free Styling';
    END

    -- Free Beard Trim
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblLoyaltyStoreItem] WHERE Code = 'FREE_BEARD')
    BEGIN
        INSERT INTO [dbo].[TblLoyaltyStoreItem] (
            CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
            ItemType, PriceCoins, Value, MinTierID, UnlimitedStock, ExpiresAfterDays,
            IsFeatured, IsActive, SortOrder
        )
        VALUES (
            @FreeServicesCategoryID, 'FREE_BEARD', N'تهذيب لحية مجاني', 'Free Beard Trim',
            N'خدمة تهذيب لحية مجانية', 'Free beard trimming service',
            'FREE_SERVICE', 250, NULL, NULL, 1, 45,
            0, 1, 2
        );
        PRINT '  ✓ Added: Free Beard Trim';
    END

    -- Free Skin Cleaning
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblLoyaltyStoreItem] WHERE Code = 'FREE_SKIN')
    BEGIN
        INSERT INTO [dbo].[TblLoyaltyStoreItem] (
            CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
            ItemType, PriceCoins, Value, MinTierID, UnlimitedStock, ExpiresAfterDays,
            BadgeText, IsFeatured, IsActive, SortOrder
        )
        VALUES (
            @FreeServicesCategoryID, 'FREE_SKIN', N'تنظيف بشرة مجاني', 'Free Skin Cleaning',
            N'جلسة تنظيف بشرة مجانية', 'Free skin cleaning session',
            'FREE_SERVICE', 500, NULL, NULL, 1, 60,
            'NEW', 1, 1, 3
        );
        PRINT '  ✓ Added: Free Skin Cleaning';
    END
END

-- ============================================
-- Sample Store Items - UPGRADES Category
-- ============================================
DECLARE @UpgradesCategoryID INT;
DECLARE @GoldTierID INT;

SELECT @UpgradesCategoryID = CategoryID FROM [dbo].[TblLoyaltyStoreCategory] WHERE Code = 'UPGRADES';
SELECT @GoldTierID = TierID FROM [dbo].[TblLoyaltyTier] WHERE TierCode = 'GOLD';

IF @UpgradesCategoryID IS NOT NULL
BEGIN
    -- Double Points
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblLoyaltyStoreItem] WHERE Code = 'DOUBLE_PTS')
    BEGIN
        INSERT INTO [dbo].[TblLoyaltyStoreItem] (
            CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
            ItemType, PriceCoins, Value, MinTierID, UnlimitedStock, ExpiresAfterDays,
            BadgeText, IsFeatured, IsActive, SortOrder
        )
        VALUES (
            @UpgradesCategoryID, 'DOUBLE_PTS', N'نقاط مضاعفة', 'Double Points',
            N'احصل على نقاط مضاعفة في زيارتك القادمة', 'Get double points on your next visit',
            'DOUBLE_POINTS', 180, 2, NULL, 1, 14,
            'LIMITED', 1, 1, 1
        );
        PRINT '  ✓ Added: Double Points';
    END

    -- Bonus 100 Points
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblLoyaltyStoreItem] WHERE Code = 'BONUS_100')
    BEGIN
        INSERT INTO [dbo].[TblLoyaltyStoreItem] (
            CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
            ItemType, PriceCoins, Value, MinTierID, UnlimitedStock, ExpiresAfterDays,
            IsFeatured, IsActive, SortOrder
        )
        VALUES (
            @UpgradesCategoryID, 'BONUS_100', N'100 نقطة إضافية', '100 Bonus Points',
            N'احصل على 100 نقطة إضافية فوراً', 'Get 100 bonus points instantly',
            'BONUS_POINTS', 80, 100, NULL, 1, NULL,
            0, 1, 2
        );
        PRINT '  ✓ Added: Bonus 100 Points';
    END

    -- VIP Upgrade (Gold tier required)
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblLoyaltyStoreItem] WHERE Code = 'VIP_UPGRADE')
    BEGIN
        INSERT INTO [dbo].[TblLoyaltyStoreItem] (
            CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
            ItemType, PriceCoins, Value, MinTierID, UnlimitedStock, ExpiresAfterDays,
            BadgeText, IsFeatured, IsActive, SortOrder
        )
        VALUES (
            @UpgradesCategoryID, 'VIP_UPGRADE', N'ترقية VIP', 'VIP Upgrade',
            N'ترقية خاصة لتجربة VIP في زيارتك القادمة', 'Special VIP experience upgrade for your next visit',
            'VIP_UPGRADE', 800, NULL, @GoldTierID, 1, 30,
            'VIP', 1, 1, 3
        );
        PRINT '  ✓ Added: VIP Upgrade';
    END

    -- Priority Booking
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblLoyaltyStoreItem] WHERE Code = 'PRIORITY_BOOK')
    BEGIN
        INSERT INTO [dbo].[TblLoyaltyStoreItem] (
            CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
            ItemType, PriceCoins, Value, MinTierID, UnlimitedStock, ExpiresAfterDays,
            IsFeatured, IsActive, SortOrder
        )
        VALUES (
            @UpgradesCategoryID, 'PRIORITY_BOOK', N'حجز ذو أولوية', 'Priority Booking',
            N'احجز في أي وقت مع أولوية قصوى', 'Book anytime with top priority',
            'PRIORITY_BOOKING', 150, NULL, NULL, 1, 7,
            0, 1, 4
        );
        PRINT '  ✓ Added: Priority Booking';
    END
END

-- ============================================
-- Sample Store Items - MYSTERY Category
-- ============================================
DECLARE @MysteryCategoryID INT;
SELECT @MysteryCategoryID = CategoryID FROM [dbo].[TblLoyaltyStoreCategory] WHERE Code = 'MYSTERY';

IF @MysteryCategoryID IS NOT NULL
BEGIN
    -- Bronze Mystery Box
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblLoyaltyStoreItem] WHERE Code = 'MYSTERY_BRONZE')
    BEGIN
        INSERT INTO [dbo].[TblLoyaltyStoreItem] (
            CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
            ItemType, PriceCoins, Value, MinTierID, UnlimitedStock, ExpiresAfterDays,
            BadgeText, IsFeatured, IsActive, SortOrder
        )
        VALUES (
            @MysteryCategoryID, 'MYSTERY_BRONZE', N'صندوق برونزي', 'Bronze Mystery Box',
            N'افتح الصندوق واحصل على مكافأة عشوائية', 'Open the box and get a random reward',
            'MYSTERY_BOX', 100, NULL, NULL, 1, NULL,
            'MYSTERY', 1, 1, 1
        );
        PRINT '  ✓ Added: Bronze Mystery Box';
    END

    -- Silver Mystery Box
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblLoyaltyStoreItem] WHERE Code = 'MYSTERY_SILVER')
    BEGIN
        INSERT INTO [dbo].[TblLoyaltyStoreItem] (
            CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
            ItemType, PriceCoins, Value, MinTierID, UnlimitedStock, ExpiresAfterDays,
            BadgeText, IsFeatured, IsActive, SortOrder
        )
        VALUES (
            @MysteryCategoryID, 'MYSTERY_SILVER', N'صندوق فضي', 'Silver Mystery Box',
            N'صندوق فضي بمكافآت أفضل', 'Silver box with better rewards',
            'MYSTERY_BOX', 250, NULL, NULL, 1, NULL,
            'MYSTERY', 1, 1, 2
        );
        PRINT '  ✓ Added: Silver Mystery Box';
    END

    -- Gold Mystery Box
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblLoyaltyStoreItem] WHERE Code = 'MYSTERY_GOLD')
    BEGIN
        INSERT INTO [dbo].[TblLoyaltyStoreItem] (
            CategoryID, Code, NameAr, NameEn, DescriptionAr, DescriptionEn,
            ItemType, PriceCoins, Value, MinTierID, UnlimitedStock, ExpiresAfterDays,
            BadgeText, IsFeatured, IsActive, SortOrder
        )
        VALUES (
            @MysteryCategoryID, 'MYSTERY_GOLD', N'صندوق ذهبي', 'Gold Mystery Box',
            N'صندوق ذهبي بمكافآت نادرة', 'Gold box with rare rewards',
            'MYSTERY_BOX', 500, NULL, @GoldTierID, 1, NULL,
            'JACKPOT', 1, 1, 3
        );
        PRINT '  ✓ Added: Gold Mystery Box';
    END
END

-- ============================================
-- Sample Mystery Box Rewards - Bronze Box
-- ============================================
DECLARE @BronzeBoxID INT;
SELECT @BronzeBoxID = ItemID FROM [dbo].[TblLoyaltyStoreItem] WHERE Code = 'MYSTERY_BRONZE';

IF @BronzeBoxID IS NOT NULL
BEGIN
    -- 50 Coins (50% chance)
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblMysteryBoxReward] WHERE BoxItemID = @BronzeBoxID AND RewardType = 'COINS' AND RewardValue = 50)
    BEGIN
        INSERT INTO [dbo].[TblMysteryBoxReward] (
            BoxItemID, RewardType, RewardValue, ProbabilityWeight,
            NameAr, NameEn, DescriptionAr, DescriptionEn, IsActive
        )
        VALUES (
            @BronzeBoxID, 'COINS', 50, 50,
            N'50 عملة', '50 Coins', N'احصل على 50 عملة ذهبية', 'Get 50 gold coins', 1
        );
    END

    -- 100 Coins (30% chance)
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblMysteryBoxReward] WHERE BoxItemID = @BronzeBoxID AND RewardType = 'COINS' AND RewardValue = 100)
    BEGIN
        INSERT INTO [dbo].[TblMysteryBoxReward] (
            BoxItemID, RewardType, RewardValue, ProbabilityWeight,
            NameAr, NameEn, DescriptionAr, DescriptionEn, IsActive
        )
        VALUES (
            @BronzeBoxID, 'COINS', 100, 30,
            N'100 عملة', '100 Coins', N'احصل على 100 عملة ذهبية', 'Get 100 gold coins', 1
        );
    END

    -- 200 Coins (15% chance)
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblMysteryBoxReward] WHERE BoxItemID = @BronzeBoxID AND RewardType = 'COINS' AND RewardValue = 200)
    BEGIN
        INSERT INTO [dbo].[TblMysteryBoxReward] (
            BoxItemID, RewardType, RewardValue, ProbabilityWeight,
            NameAr, NameEn, DescriptionAr, DescriptionEn, IsActive
        )
        VALUES (
            @BronzeBoxID, 'COINS', 200, 15,
            N'200 عملة', '200 Coins', N'احصل على 200 عملة ذهبية', 'Get 200 gold coins', 1
        );
    END

    -- Jackpot 500 Coins (5% chance)
    IF NOT EXISTS (SELECT 1 FROM [dbo].[TblMysteryBoxReward] WHERE BoxItemID = @BronzeBoxID AND RewardType = 'JACKPOT')
    BEGIN
        INSERT INTO [dbo].[TblMysteryBoxReward] (
            BoxItemID, RewardType, RewardValue, ProbabilityWeight,
            NameAr, NameEn, DescriptionAr, DescriptionEn, IsActive
        )
        VALUES (
            @BronzeBoxID, 'JACKPOT', 500, 5,
            N'جائزة كبرى!', 'JACKPOT!', N'فزت بـ 500 عملة ذهبية!', 'You won 500 gold coins!', 1
        );
    END

    PRINT '  ✓ Added: Bronze Mystery Box Rewards';
END

-- ============================================
-- Sample Referral Reward Rule
-- ============================================
IF NOT EXISTS (SELECT 1 FROM [dbo].[TblReferralReward] WHERE IsDefault = 1)
BEGIN
    INSERT INTO [dbo].[TblReferralReward] (
        RuleName, ReferrerRewardCoins, ReferredRewardCoins,
        MinFirstPurchaseAmount, RequireCompletedVisit,
        IsActive, IsDefault
    )
    VALUES (
        N'Default Referral Reward', 100, 50,
        100, 1,
        1, 1
    );
    PRINT '  ✓ Added: Default Referral Reward Rule';
END

-- ============================================
PRINT '';
PRINT '============================================';
PRINT 'Sample data inserted successfully!';
PRINT '============================================';
PRINT '';
PRINT 'Summary:';
PRINT '  - Store Items: ~15 items across 4 categories';
PRINT '  - Mystery Box Rewards: 4 rewards for Bronze box';
PRINT '  - Referral Rules: 1 default rule';
PRINT '';
PRINT 'Next: Test the APIs and start building the UI!';
PRINT '============================================';
GO
