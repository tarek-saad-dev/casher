# CUT CLUB ECONOMY - Complete Documentation

## 🎯 Vision

Transform loyalty points into **CUT Coins (CC)** - an internal currency system where clients can:
- Shop in a digital store
- Build their inventory
- Use items during bookings or at POS
- Open mystery boxes
- Earn through referrals

**Goals:**
- ✅ Increase retention
- ✅ Gamification
- ✅ Higher client engagement
- ✅ Prepare for seasonal events
- ✅ VIP economy ready
- ✅ Multi-tenant SaaS architecture ready

---

## 📊 Database Schema

### New Tables Created

#### 1. TblLoyaltyStoreCategory
Store categories for organizing items.

| Column | Type | Description |
|--------|------|-------------|
| CategoryID | INT PK | Primary key |
| SalonID | INT NULL | Multi-tenant support |
| Code | NVARCHAR(50) | Unique code |
| NameAr | NVARCHAR(100) | Arabic name |
| NameEn | NVARCHAR(100) | English name |
| DescriptionAr | NVARCHAR(300) | Arabic description |
| DescriptionEn | NVARCHAR(300) | English description |
| Icon | NVARCHAR(100) | Icon name |
| SortOrder | INT | Display order |
| IsActive | BIT | Active status |

**Default Categories:**
- DISCOUNTS (خصومات)
- FREE_SERVICES (خدمات مجانية)
- UPGRADES (ترقيات VIP)
- MYSTERY (صناديق المفاجآت)
- SPECIAL (عروض خاصة)

---

#### 2. TblLoyaltyStoreItem
Store items that clients can purchase with CUT Coins.

| Column | Type | Description |
|--------|------|-------------|
| ItemID | INT PK | Primary key |
| CategoryID | INT FK | Category reference |
| SalonID | INT NULL | Multi-tenant support |
| Code | NVARCHAR(50) | Unique code |
| NameAr | NVARCHAR(100) | Arabic name |
| NameEn | NVARCHAR(100) | English name |
| DescriptionAr | NVARCHAR(500) | Arabic description |
| DescriptionEn | NVARCHAR(500) | English description |
| ItemType | NVARCHAR(50) | Item behavior type |
| PriceCoins | DECIMAL(18,2) | Price in CUT Coins |
| Value | DECIMAL(18,2) | Discount/bonus value |
| ServiceID | INT NULL | FK to TblService |
| ProductID | INT NULL | FK to TblProduct |
| MinTierID | INT NULL | Minimum tier required |
| StockQuantity | INT NULL | Available stock |
| UnlimitedStock | BIT | Unlimited flag |
| ExpiresAfterDays | INT NULL | Days until expiry |
| ImageUrl | NVARCHAR(500) | Item image |
| BadgeText | NVARCHAR(50) | Badge (HOT, NEW, etc) |
| IsFeatured | BIT | Featured flag |
| IsActive | BIT | Active status |
| SortOrder | INT | Display order |

**Item Types:**
- `DISCOUNT_AMOUNT` - Fixed amount discount
- `DISCOUNT_PERCENT` - Percentage discount
- `FREE_SERVICE` - Free service
- `FREE_PRODUCT` - Free product
- `DOUBLE_POINTS` - Double points multiplier
- `BONUS_POINTS` - Bonus points reward
- `VIP_UPGRADE` - VIP upgrade
- `PRIORITY_BOOKING` - Priority booking
- `MYSTERY_BOX` - Mystery box
- `CUSTOM` - Custom item

---

#### 3. TblClientInventory
Client's purchased items (inventory).

| Column | Type | Description |
|--------|------|-------------|
| InventoryID | INT PK | Primary key |
| ClientID | INT FK | Client reference |
| ItemID | INT FK | Store item reference |
| Quantity | INT | Quantity owned |
| Status | NVARCHAR(30) | Item status |
| PurchasePriceCoins | DECIMAL(18,2) | Purchase price |
| VoucherCode | NVARCHAR(100) | Unique voucher code |
| PurchasedAt | DATETIME | Purchase timestamp |
| ExpiresAt | DATETIME NULL | Expiry timestamp |
| UsedAt | DATETIME NULL | Usage timestamp |
| UsedInvID | INT NULL | Invoice where used |
| UsedBookingID | INT NULL | Booking where used |
| Notes | NVARCHAR(500) | Additional notes |

**Status Values:**
- `ACTIVE` - Ready to use
- `USED` - Already used
- `EXPIRED` - Expired
- `CANCELLED` - Cancelled/refunded

---

#### 4. TblInventoryUsageLog
Tracks inventory item usage history.

| Column | Type | Description |
|--------|------|-------------|
| UsageID | INT PK | Primary key |
| InventoryID | INT FK | Inventory reference |
| ClientID | INT FK | Client reference |
| InvID | INT NULL | Invoice reference |
| BookingID | INT NULL | Booking reference |
| ActionType | NVARCHAR(50) | Action performed |
| UsedAt | DATETIME | Action timestamp |
| Notes | NVARCHAR(500) | Additional notes |

---

#### 5. TblMysteryBoxReward
Defines possible rewards in mystery boxes.

| Column | Type | Description |
|--------|------|-------------|
| RewardID | INT PK | Primary key |
| BoxItemID | INT FK | Mystery box item |
| SalonID | INT NULL | Multi-tenant support |
| RewardType | NVARCHAR(50) | Reward type |
| RewardValue | DECIMAL(18,2) | Reward value |
| RewardItemID | INT NULL | Store item reward |
| ProbabilityWeight | INT | Probability weight |
| NameAr | NVARCHAR(100) | Arabic name |
| NameEn | NVARCHAR(100) | English name |
| DescriptionAr | NVARCHAR(300) | Arabic description |
| DescriptionEn | NVARCHAR(300) | English description |
| IsActive | BIT | Active status |

**Reward Types:**
- `COINS` - CUT Coins
- `STORE_ITEM` - Store item
- `DISCOUNT` - Discount voucher
- `BONUS_POINTS` - Bonus points
- `JACKPOT` - Jackpot reward

---

#### 6. TblClientReferral
Client referral tracking.

| Column | Type | Description |
|--------|------|-------------|
| ReferralID | INT PK | Primary key |
| ReferrerClientID | INT FK | Who referred |
| ReferredClientID | INT NULL | Who was referred |
| SalonID | INT NULL | Multi-tenant support |
| ReferralCode | NVARCHAR(50) | Unique referral code |
| ReferredPhone | NVARCHAR(20) | Referred phone |
| Status | NVARCHAR(30) | Referral status |
| ReferrerRewardCoins | DECIMAL(18,2) | Referrer reward |
| ReferredRewardCoins | DECIMAL(18,2) | Referred reward |
| ReferrerRewardGiven | BIT | Reward given flag |
| ReferredRewardGiven | BIT | Reward given flag |
| CreatedAt | DATETIME | Creation timestamp |
| CompletedAt | DATETIME NULL | Completion timestamp |
| ExpiresAt | DATETIME NULL | Expiry timestamp |
| Notes | NVARCHAR(500) | Additional notes |

**Status Values:**
- `PENDING` - Waiting for completion
- `COMPLETED` - Successfully completed
- `EXPIRED` - Expired
- `CANCELLED` - Cancelled

---

#### 7. TblReferralReward
Referral reward rules configuration.

| Column | Type | Description |
|--------|------|-------------|
| RewardRuleID | INT PK | Primary key |
| SalonID | INT NULL | Multi-tenant support |
| RuleName | NVARCHAR(100) | Rule name |
| ReferrerRewardCoins | DECIMAL(18,2) | Referrer reward |
| ReferredRewardCoins | DECIMAL(18,2) | Referred reward |
| MinFirstPurchaseAmount | DECIMAL(18,2) | Min purchase required |
| RequireCompletedVisit | BIT | Visit required flag |
| ValidFromDate | DATETIME NULL | Valid from |
| ValidToDate | DATETIME NULL | Valid to |
| IsActive | BIT | Active status |
| IsDefault | BIT | Default rule flag |

---

### Expanded Movement Types

**TblLoyaltyPointLedger** now supports new movement types:

**Existing:**
- `EARN_SALE` - Points earned from sale
- `ADJUST_ADD` - Manual addition
- `ADJUST_SUBTRACT` - Manual subtraction
- `REVERSAL` - Invoice reversal
- `REDEEM` - Legacy reward redemption
- `REFERRAL_BONUS` - Referral bonus

**New:**
- `STORE_PURCHASE` - Store item purchase
- `STORE_REFUND` - Store item refund
- `INVENTORY_REWARD` - Inventory reward
- `MYSTERY_BOX_OPEN` - Mystery box opened
- `DOUBLE_POINTS_BONUS` - Double points bonus
- `BONUS_POINTS_REWARD` - Bonus points reward

---

## 🏗️ Architecture

### Service Layer Structure

```
src/lib/store/
├── store.types.ts          # Type definitions
├── store.helpers.ts        # Helper functions
├── store.validators.ts     # Validation functions
├── store.service.ts        # Store business logic
├── inventory.service.ts    # Inventory business logic
└── mysterybox.service.ts   # Mystery box logic
```

**Key Principles:**
- ✅ No business logic in route handlers
- ✅ Separation of concerns
- ✅ Reusable services
- ✅ Type-safe operations
- ✅ Transaction support

---

## 🔌 API Endpoints

### Client Store APIs

#### 1. GET /api/public/client/store
Get complete store with categories, featured items, and all items.

**Query Params:**
- `clientId` (number) - Client ID (TODO: replace with auth)

**Response:**
```json
{
  "ok": true,
  "balance": 1240,
  "categories": [...],
  "featuredItems": [...],
  "items": [
    {
      "itemId": 1,
      "nameAr": "خصم 50 جنيه",
      "priceCoins": 220,
      "canAfford": true,
      "tierLocked": false,
      "stockStatus": "available",
      ...
    }
  ]
}
```

---

#### 2. GET /api/public/client/store/items/[itemId]
Get store item details with related items.

**Query Params:**
- `clientId` (number)

**Response:**
```json
{
  "ok": true,
  "item": {...},
  "relatedItems": [...]
}
```

---

#### 3. POST /api/public/client/store/buy
Purchase a store item.

**Query Params:**
- `clientId` (number)

**Body:**
```json
{
  "itemId": 12
}
```

**Response:**
```json
{
  "ok": true,
  "message": "تم الشراء بنجاح",
  "purchase": {
    "inventoryId": 456,
    "itemId": 12,
    "nameAr": "خصم 50 جنيه",
    "priceCoins": 220,
    "voucherCode": "CC-1-12-ABC123-XYZ",
    "expiresAt": "2026-07-05T00:00:00.000Z"
  },
  "newBalance": 1020
}
```

---

#### 4. POST /api/public/client/store/open-box
Open a mystery box.

**Query Params:**
- `clientId` (number)

**Body:**
```json
{
  "inventoryId": 789
}
```

**Response:**
```json
{
  "success": true,
  "reward": {
    "type": "COINS",
    "nameAr": "100 عملة ذهبية",
    "nameEn": "100 Gold Coins",
    "value": 100,
    "itemId": null
  },
  "newBalance": 1340
}
```

---

### Client Inventory APIs

#### 5. GET /api/public/client/inventory
Get client inventory with stats.

**Query Params:**
- `clientId` (number)
- `status` (string, optional) - Default: ACTIVE, Options: ACTIVE, USED, EXPIRED, CANCELLED, ALL

**Response:**
```json
{
  "ok": true,
  "items": [
    {
      "inventoryId": 123,
      "itemId": 5,
      "status": "ACTIVE",
      "voucherCode": "CC-1-5-ABC-XYZ",
      "purchasedAt": "2026-06-01T10:00:00.000Z",
      "expiresAt": "2026-07-01T10:00:00.000Z",
      "daysUntilExpiry": 26,
      "isExpiringSoon": false,
      "canUse": true,
      "item": {...}
    }
  ],
  "stats": {
    "totalActive": 5,
    "totalUsed": 12,
    "expiringThisWeek": 1
  }
}
```

---

#### 6. GET /api/public/client/inventory/[inventoryId]
Get inventory item details with usage history.

**Query Params:**
- `clientId` (number)

**Response:**
```json
{
  "ok": true,
  "item": {...},
  "usageHistory": [
    {
      "usageId": 1,
      "actionType": "USED",
      "usedAt": "2026-06-05T14:30:00.000Z",
      "notes": "Used in invoice #1234",
      "invId": 1234,
      "bookingId": null
    }
  ]
}
```

---

### POS Integration APIs

#### 7. GET /api/pos/client-inventory
Get client's active inventory for POS.

**Query Params:**
- `clientId` (number)

**Response:**
```json
{
  "ok": true,
  "clientId": 1,
  "clientName": "أحمد محمد",
  "activeItems": [...]
}
```

---

#### 8. POST /api/pos/client-inventory/use
Use an inventory item in POS.

**Body:**
```json
{
  "inventoryId": 123,
  "invId": 456,
  "notes": "Applied 50 EGP discount"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "تم استخدام العنصر بنجاح",
  "usedItem": {
    "inventoryId": 123,
    "itemType": "DISCOUNT_AMOUNT",
    "nameAr": "خصم 50 جنيه",
    "value": 50
  },
  "appliedEffect": "خصم 50 جنيه على الفاتورة"
}
```

---

## 🎮 POS Integration Logic

### Item Type Behaviors

| Item Type | POS Action |
|-----------|------------|
| DISCOUNT_AMOUNT | Apply fixed discount to invoice |
| DISCOUNT_PERCENT | Apply percentage discount to invoice |
| FREE_SERVICE | Inject service with price = 0 |
| FREE_PRODUCT | Inject product with price = 0 |
| DOUBLE_POINTS | Store multiplier, apply after invoice save |
| BONUS_POINTS | Grant points after invoice completion |
| VIP_UPGRADE | Flag invoice as VIP |
| PRIORITY_BOOKING | Mark for priority |

---

## 🔄 Migration from Legacy Rewards

### Current System (Legacy)
- Static rewards in code (`STATIC_REWARDS`)
- Direct redemption
- No inventory
- Limited tracking

### New System (CUT CLUB Economy)
- Dynamic store items in database
- Purchase → Inventory → Use workflow
- Full tracking and history
- Expiry management
- Mystery boxes
- Referral system

### Migration Steps

1. **Keep Legacy APIs** - Don't delete existing loyalty APIs
2. **Run in Parallel** - Both systems coexist
3. **Gradual Migration** - Move clients gradually
4. **Data Migration Script** - Convert existing redemptions to inventory (if needed)
5. **Frontend Update** - Update UI to use new store APIs
6. **Deprecate Legacy** - After full migration

---

## 🔐 Security & TODOs

### Critical TODOs

1. **Authentication**
   ```typescript
   // TODO: Replace clientId query param with:
   // - Authenticated client session
   // - OR OTP login token
   // Before production deployment
   ```

2. **Rate Limiting**
   - Add rate limiting to prevent abuse
   - Especially for mystery box opening

3. **Fraud Prevention**
   - Validate all transactions
   - Check for duplicate voucher codes
   - Monitor suspicious activity

4. **Data Validation**
   - Validate all inputs
   - Sanitize user data
   - Prevent SQL injection

---

## 🚨 Risks & Considerations

### Before Production

1. **Database Performance**
   - Add proper indexes (already included in migration)
   - Monitor query performance
   - Consider caching for store items

2. **Transaction Integrity**
   - All purchases use transactions
   - Rollback on failure
   - Idempotency keys for ledger

3. **Stock Management**
   - Handle concurrent purchases
   - Prevent overselling
   - Consider optimistic locking

4. **Expiry Management**
   - Run scheduled job to mark expired items
   - Notify clients before expiry
   - Handle timezone correctly

5. **Multi-Tenant**
   - SalonID is ready but optional
   - Test isolation between salons
   - Ensure data privacy

---

## 📈 Future Enhancements

### Phase 2 (Ready for Implementation)

1. **Seasonal Events**
   - Limited-time items
   - Special event categories
   - Seasonal mystery boxes

2. **VIP Economy**
   - Exclusive VIP items
   - VIP-only mystery boxes
   - VIP tier benefits

3. **Social Features**
   - Gift items to friends
   - Leaderboards
   - Achievements

4. **Advanced Analytics**
   - Purchase patterns
   - Popular items
   - Revenue tracking

---

## 📝 Files Created

### Database
- `db/migrations/cut-club-economy-store.sql` - Complete migration script

### Service Layer
- `src/lib/store/store.types.ts` - Type definitions
- `src/lib/store/store.helpers.ts` - Helper functions
- `src/lib/store/store.validators.ts` - Validation functions
- `src/lib/store/store.service.ts` - Store service
- `src/lib/store/inventory.service.ts` - Inventory service
- `src/lib/store/mysterybox.service.ts` - Mystery box service

### APIs
- `src/app/api/public/client/store/route.ts` - Main store
- `src/app/api/public/client/store/items/[itemId]/route.ts` - Item details
- `src/app/api/public/client/store/buy/route.ts` - Purchase item
- `src/app/api/public/client/store/open-box/route.ts` - Open mystery box
- `src/app/api/public/client/inventory/route.ts` - Get inventory
- `src/app/api/public/client/inventory/[inventoryId]/route.ts` - Inventory details
- `src/app/api/pos/client-inventory/route.ts` - POS get inventory
- `src/app/api/pos/client-inventory/use/route.ts` - POS use item

---

## 🎯 Summary

### ✅ Completed

1. ✅ Database schema with 7 new tables
2. ✅ Complete service layer architecture
3. ✅ 8 API endpoints (Store, Inventory, POS)
4. ✅ Mystery box system with weighted probabilities
5. ✅ Referral system foundation
6. ✅ Multi-tenant ready (SalonID support)
7. ✅ Backward compatible (legacy APIs intact)
8. ✅ Transaction-safe operations
9. ✅ Comprehensive type safety
10. ✅ Full documentation

### 🔄 Next Steps

1. Run migration script on database
2. Seed sample data (categories, items)
3. Test all endpoints
4. Build frontend UI
5. Implement authentication
6. Add admin management APIs
7. Deploy to staging
8. User acceptance testing
9. Production deployment

---

## 🚀 Quick Start

### 1. Run Migration
```bash
# Execute migration script
sqlcmd -S your-server -d your-database -i db/migrations/cut-club-economy-store.sql
```

### 2. Test APIs
```bash
# Get store
GET http://localhost:3000/api/public/client/store?clientId=1

# Purchase item
POST http://localhost:3000/api/public/client/store/buy?clientId=1
Body: {"itemId": 1}

# Get inventory
GET http://localhost:3000/api/public/client/inventory?clientId=1
```

### 3. POS Integration
```bash
# Get client inventory
GET http://localhost:3000/api/pos/client-inventory?clientId=1

# Use item
POST http://localhost:3000/api/pos/client-inventory/use
Body: {"inventoryId": 123, "invId": 456}
```

---

**Built with ❤️ for CUT CLUB**

*Transform loyalty into an economy. Transform clients into players.*
