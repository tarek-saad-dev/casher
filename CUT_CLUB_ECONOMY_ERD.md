# CUT CLUB ECONOMY - Entity Relationship Diagram

## 📊 Database Schema Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CUT CLUB ECONOMY SYSTEM                          │
│                     Entity Relationship Diagram                         │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│   TblClient          │
│──────────────────────│
│ ClientID (PK)        │
│ Name                 │
│ Mobile               │
│ ...                  │
└──────────┬───────────┘
           │
           │ 1:1
           │
┌──────────▼───────────┐         ┌──────────────────────┐
│ TblClientLoyalty     │         │  TblLoyaltyTier      │
│──────────────────────│         │──────────────────────│
│ ClientLoyaltyID (PK) │         │ TierID (PK)          │
│ ClientID (FK)        │         │ TierCode             │
│ PointsBalance        │◄────────┤ TierNameAr           │
│ TierID (FK)          │   N:1   │ MinLifetimePoints    │
│ LifetimeEarnedPoints │         │ PointsMultiplier     │
│ TotalVisits          │         │ IsActive             │
│ ...                  │         └──────────────────────┘
└──────────┬───────────┘
           │
           │ 1:N
           │
┌──────────▼───────────────────┐
│ TblLoyaltyPointLedger        │
│──────────────────────────────│
│ LedgerID (PK)                │
│ ClientLoyaltyID (FK)         │
│ MovementType                 │  ◄── New Types:
│ PointsDelta                  │      STORE_PURCHASE
│ PointsBefore                 │      STORE_REFUND
│ PointsAfter                  │      MYSTERY_BOX_OPEN
│ Notes                        │      BONUS_POINTS_REWARD
│ CreatedAt                    │      etc.
└──────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────┐
│                           STORE SYSTEM                               │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────┐
│ TblLoyaltyStoreCategory  │
│──────────────────────────│
│ CategoryID (PK)          │
│ SalonID (Multi-tenant)   │
│ Code (UNIQUE)            │
│ NameAr                   │
│ NameEn                   │
│ Icon                     │
│ SortOrder                │
│ IsActive                 │
└──────────┬───────────────┘
           │
           │ 1:N
           │
┌──────────▼───────────────┐         ┌──────────────────────┐
│ TblLoyaltyStoreItem      │         │  TblLoyaltyTier      │
│──────────────────────────│         │──────────────────────│
│ ItemID (PK)              │         │ TierID (PK)          │
│ CategoryID (FK)          │         │ TierCode             │
│ SalonID (Multi-tenant)   │         └──────────┬───────────┘
│ Code (UNIQUE)            │                    │
│ NameAr / NameEn          │                    │ N:1
│ ItemType                 │◄───────────────────┘
│ PriceCoins               │  MinTierID (FK)
│ Value                    │
│ ServiceID (FK)           │         ┌──────────────────────┐
│ ProductID (FK)           │         │  TblService          │
│ StockQuantity            │         │──────────────────────│
│ ExpiresAfterDays         │         │ ServiceID (PK)       │
│ IsFeatured               │         │ ServiceName          │
│ IsActive                 │         │ ...                  │
└──────────┬───────────────┘         └──────────┬───────────┘
           │                                    │
           │ N:1                                │ N:1
           └────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────┐
│                        INVENTORY SYSTEM                              │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐         ┌──────────────────────────┐
│   TblClient          │         │ TblLoyaltyStoreItem      │
│──────────────────────│         │──────────────────────────│
│ ClientID (PK)        │         │ ItemID (PK)              │
└──────────┬───────────┘         └──────────┬───────────────┘
           │                                │
           │ 1:N                            │ 1:N
           │                                │
           │         ┌──────────────────────▼──────────┐
           └────────►│ TblClientInventory              │
                     │─────────────────────────────────│
                     │ InventoryID (PK)                │
                     │ ClientID (FK)                   │
                     │ ItemID (FK)                     │
                     │ Quantity                        │
                     │ Status (ACTIVE/USED/EXPIRED)    │
                     │ PurchasePriceCoins              │
                     │ VoucherCode (UNIQUE)            │
                     │ PurchasedAt                     │
                     │ ExpiresAt                       │
                     │ UsedAt                          │
                     │ UsedInvID (FK)                  │
                     │ UsedBookingID (FK)              │
                     └──────────┬──────────────────────┘
                                │
                                │ 1:N
                                │
                     ┌──────────▼──────────────────────┐
                     │ TblInventoryUsageLog            │
                     │─────────────────────────────────│
                     │ UsageID (PK)                    │
                     │ InventoryID (FK)                │
                     │ ClientID (FK)                   │
                     │ InvID (FK)                      │
                     │ BookingID (FK)                  │
                     │ ActionType                      │
                     │ UsedAt                          │
                     │ Notes                           │
                     └─────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────┐
│                      MYSTERY BOX SYSTEM                              │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────┐
│ TblLoyaltyStoreItem      │
│──────────────────────────│
│ ItemID (PK)              │
│ ItemType = 'MYSTERY_BOX' │
└──────────┬───────────────┘
           │
           │ 1:N
           │
┌──────────▼───────────────┐         ┌──────────────────────┐
│ TblMysteryBoxReward      │         │ TblLoyaltyStoreItem  │
│──────────────────────────│         │──────────────────────│
│ RewardID (PK)            │         │ ItemID (PK)          │
│ BoxItemID (FK)           │         └──────────┬───────────┘
│ SalonID (Multi-tenant)   │                    │
│ RewardType               │                    │ N:1
│ RewardValue              │◄───────────────────┘
│ RewardItemID (FK)        │  (Optional: if reward is a store item)
│ ProbabilityWeight        │
│ NameAr / NameEn          │
│ IsActive                 │
└──────────────────────────┘


┌──────────────────────────────────────────────────────────────────────┐
│                       REFERRAL SYSTEM                                │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│   TblClient          │
│──────────────────────│
│ ClientID (PK)        │
└──────────┬───────────┘
           │
           │ 1:N (as referrer)
           │
┌──────────▼───────────────────┐
│ TblClientReferral            │
│──────────────────────────────│
│ ReferralID (PK)              │
│ ReferrerClientID (FK)        │◄─── Who referred
│ ReferredClientID (FK)        │◄─── Who was referred
│ SalonID (Multi-tenant)       │
│ ReferralCode (UNIQUE)        │
│ Status                       │
│ ReferrerRewardCoins          │
│ ReferredRewardCoins          │
│ ReferrerRewardGiven          │
│ ReferredRewardGiven          │
│ CreatedAt                    │
│ CompletedAt                  │
│ ExpiresAt                    │
└──────────────────────────────┘

┌──────────────────────────────┐
│ TblReferralReward            │
│──────────────────────────────│
│ RewardRuleID (PK)            │
│ SalonID (Multi-tenant)       │
│ RuleName                     │
│ ReferrerRewardCoins          │
│ ReferredRewardCoins          │
│ MinFirstPurchaseAmount       │
│ RequireCompletedVisit        │
│ ValidFromDate                │
│ ValidToDate                  │
│ IsActive                     │
│ IsDefault                    │
└──────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────┐
│                    POS INTEGRATION FLOW                              │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│   TblInv             │  ◄── Invoice where item is used
│──────────────────────│
│ InvID (PK)           │
│ ClientID (FK)        │
│ InvTotal             │
│ ...                  │
└──────────┬───────────┘
           │
           │ N:1
           │
┌──────────▼───────────────────┐
│ TblClientInventory           │
│──────────────────────────────│
│ InventoryID (PK)             │
│ UsedInvID (FK)               │◄─── Links to invoice
│ Status = 'USED'              │
│ UsedAt                       │
└──────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────┐
│                      MULTI-TENANT SUPPORT                            │
└──────────────────────────────────────────────────────────────────────┘

All new tables include SalonID (nullable) for multi-tenant support:
- TblLoyaltyStoreCategory
- TblLoyaltyStoreItem
- TblMysteryBoxReward
- TblClientReferral
- TblReferralReward

This allows:
✓ Each salon to have its own store
✓ Each salon to configure its own rewards
✓ Each salon to manage its own referral rules
✓ Shared items (SalonID = NULL) available to all salons
```

## 🔗 Key Relationships

### 1. Client → Loyalty → Points
- **TblClient** (1:1) **TblClientLoyalty** - Each client has one loyalty account
- **TblClientLoyalty** (1:N) **TblLoyaltyPointLedger** - Track all point movements

### 2. Store → Items → Categories
- **TblLoyaltyStoreCategory** (1:N) **TblLoyaltyStoreItem** - Items belong to categories
- **TblLoyaltyTier** (1:N) **TblLoyaltyStoreItem** - Items can require minimum tier

### 3. Client → Purchase → Inventory
- **TblClient** (1:N) **TblClientInventory** - Clients own multiple items
- **TblLoyaltyStoreItem** (1:N) **TblClientInventory** - Items can be purchased multiple times
- **TblClientInventory** (1:N) **TblInventoryUsageLog** - Track usage history

### 4. Mystery Box → Rewards
- **TblLoyaltyStoreItem** (1:N) **TblMysteryBoxReward** - Each box has multiple possible rewards
- **TblLoyaltyStoreItem** (N:1) **TblMysteryBoxReward** - Rewards can be store items

### 5. Referral System
- **TblClient** (1:N) **TblClientReferral** (as referrer) - Client can refer many
- **TblClient** (1:N) **TblClientReferral** (as referred) - Client can be referred once

### 6. POS Integration
- **TblInv** (1:N) **TblClientInventory** - Invoices can use multiple inventory items
- **TblBooking** (1:N) **TblClientInventory** - Bookings can use inventory items

## 📋 Indexes Summary

### Performance Indexes
- `IX_StoreCategory_SalonID_Active` - Fast category lookup per salon
- `IX_StoreItem_Category` - Fast item lookup by category
- `IX_StoreItem_Featured` - Fast featured items query
- `IX_ClientInventory_Client_Status` - Fast client inventory lookup
- `IX_ClientInventory_VoucherCode` - Fast voucher validation
- `IX_InventoryUsageLog_Inventory` - Fast usage history
- `IX_MysteryBoxReward_BoxItem` - Fast reward lookup
- `IX_ClientReferral_Code` - Fast referral code validation

## 🔒 Constraints

### Unique Constraints
- `UQ_StoreCategory_Code` - Unique category codes per salon
- `UQ_StoreItem_Code` - Unique item codes per salon
- `UQ_ClientInventory_VoucherCode` - Globally unique voucher codes
- `UQ_ClientReferral_Code` - Globally unique referral codes

### Check Constraints
- `CK_StoreItem_ItemType` - Valid item types only
- `CK_StoreItem_PriceCoins` - Non-negative prices
- `CK_ClientInventory_Status` - Valid status values
- `CK_MysteryBoxReward_Type` - Valid reward types
- `CK_MysteryBoxReward_Weight` - Positive probability weights

## 🎯 Data Flow Examples

### Purchase Flow
```
1. Client browses store → GET /api/public/client/store
2. Client selects item → GET /api/public/client/store/items/[itemId]
3. Client purchases → POST /api/public/client/store/buy
   ├─ Validate balance & tier
   ├─ Create inventory record
   ├─ Deduct coins from TblClientLoyalty
   ├─ Add ledger entry (STORE_PURCHASE)
   └─ Update stock if limited
4. Item added to inventory → TblClientInventory (Status: ACTIVE)
```

### Usage Flow (POS)
```
1. POS loads client → GET /api/pos/client-inventory?clientId=X
2. Cashier selects item to use
3. POS applies item → POST /api/pos/client-inventory/use
   ├─ Validate item is ACTIVE
   ├─ Apply effect based on ItemType
   ├─ Update inventory (Status: USED)
   ├─ Link to invoice (UsedInvID)
   └─ Log usage in TblInventoryUsageLog
```

### Mystery Box Flow
```
1. Client purchases mystery box → Same as purchase flow
2. Client opens box → POST /api/public/client/store/open-box
   ├─ Get all rewards for box
   ├─ Select reward using weighted random
   ├─ Mark box as USED
   ├─ Apply reward based on type:
   │  ├─ COINS → Add to balance + ledger
   │  ├─ STORE_ITEM → Create inventory record
   │  ├─ BONUS_POINTS → Add points + ledger
   │  └─ DISCOUNT → Create inventory record
   └─ Return reward details
```

---

**Built for scalability, performance, and multi-tenant architecture**
