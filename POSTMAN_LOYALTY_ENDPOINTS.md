# Loyalty Points API - Postman Documentation

## Base URL
```
http://localhost:3000/api/public/client/loyalty
```

---

## 1. Get Client Loyalty Dashboard

**Endpoint:** `GET /me`

**Description:** Get complete loyalty dashboard including points balance, tier, rewards, activity, and referral info.

**Query Parameters:**
- `clientId` (required): Client ID number

**Example Request:**
```
GET http://localhost:3000/api/public/client/loyalty/me?clientId=1
```

**Success Response (200):**
```json
{
  "ok": true,
  "client": {
    "id": 1,
    "name": "John Doe",
    "phone": "1234567890"
  },
  "membership": {
    "memberId": "CUT-001",
    "tierCode": "BRONZE",
    "tierNameAr": "برونز",
    "tierNameEn": "Bronze",
    "pointsBalance": 150,
    "lifetimeEarnedPoints": 500,
    "lifetimeRedeemedPoints": 350,
    "totalVisits": 10,
    "totalSpend": 1500,
    "memberSince": "2024-01-01T00:00:00.000Z",
    "isActive": true
  },
  "rewards": [...],
  "nextReward": {...},
  "stats": {...},
  "levels": [...],
  "referral": {...},
  "recentActivity": [...]
}
```

---

## 2. Get Rewards List

**Endpoint:** `GET /rewards`

**Description:** Get all available rewards with status (available, locked, tier_locked).

**Query Parameters:**
- `clientId` (required): Client ID number

**Example Request:**
```
GET http://localhost:3000/api/public/client/loyalty/rewards?clientId=1
```

**Success Response (200):**
```json
{
  "ok": true,
  "rewards": [
    {
      "id": 1,
      "titleAr": "خصم 10%",
      "titleEn": "10% Discount",
      "descriptionAr": "خصم 10% على الخدمة القادمة",
      "descriptionEn": "10% off your next service",
      "requiredPoints": 100,
      "status": "available",
      "remainingPoints": 0,
      "progress": 100,
      "minTierCode": null
    }
  ],
  "nextReward": {
    "id": 2,
    "titleAr": "خصم 20%",
    "titleEn": "20% Discount",
    "requiredPoints": 200,
    "remainingPoints": 50,
    "progress": 75
  }
}
```

**Reward Status Values:**
- `available`: Client has enough points to redeem
- `locked`: Not enough points yet
- `tier_locked`: Requires higher membership tier

---

## 3. Redeem Reward

**Endpoint:** `POST /rewards/{rewardId}/redeem`

**Description:** Redeem a loyalty reward using points.

**Path Parameters:**
- `rewardId` (required): Reward ID to redeem

**Query Parameters:**
- `clientId` (required): Client ID number

**Request Body:**
```json
{
  "confirm": true
}
```

**Example Request:**
```
POST http://localhost:3000/api/public/client/loyalty/rewards/1/redeem?clientId=1
Content-Type: application/json

{
  "confirm": true
}
```

**Success Response (200):**
```json
{
  "ok": true,
  "message": "تم استبدال المكافأة بنجاح",
  "redemption": {
    "rewardId": 1,
    "titleAr": "خصم 10%",
    "titleEn": "10% Discount",
    "pointsCost": 100,
    "code": "REDEEM-1-1-1234567890"
  },
  "newBalance": 50
}
```

**Error Responses:**

*Insufficient Points (400):*
```json
{
  "ok": false,
  "error": "رصيد النقاط غير كافي لاستبدال هذه المكافأة"
}
```

*Tier Locked (400):*
```json
{
  "ok": false,
  "error": "This reward requires a higher membership tier"
}
```

*Missing Confirmation (400):*
```json
{
  "ok": false,
  "error": "Confirmation required. Set confirm: true to redeem."
}
```

---

## 4. Get Activity History

**Endpoint:** `GET /activity`

**Description:** Get paginated loyalty points activity history.

**Query Parameters:**
- `clientId` (required): Client ID number
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10, max: 50)
- `movementType` (optional): Filter by type (EARN, REDEEM, ADJUST, EXPIRE)
- `dateFrom` (optional): Filter from date (ISO format)
- `dateTo` (optional): Filter to date (ISO format)

**Example Request:**
```
GET http://localhost:3000/api/public/client/loyalty/activity?clientId=1&page=1&limit=10
```

**With Filters:**
```
GET http://localhost:3000/api/public/client/loyalty/activity?clientId=1&movementType=EARN&dateFrom=2024-01-01&dateTo=2024-12-31
```

**Success Response (200):**
```json
{
  "ok": true,
  "activity": [
    {
      "id": 123,
      "type": "EARN",
      "typeAr": "كسب نقاط",
      "typeEn": "Points Earned",
      "points": 50,
      "balanceBefore": 100,
      "balanceAfter": 150,
      "description": "Earned from invoice #456",
      "date": "2024-06-05T18:30:00.000Z"
    },
    {
      "id": 122,
      "type": "REDEEM",
      "typeAr": "استبدال",
      "typeEn": "Redeemed",
      "points": -100,
      "balanceBefore": 200,
      "balanceAfter": 100,
      "description": "Redeemed reward: خصم 10%",
      "date": "2024-06-04T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "totalCount": 25,
    "totalPages": 3
  }
}
```

**Movement Types:**
- `EARN`: Points earned from purchases
- `REDEEM`: Points spent on rewards
- `ADJUST`: Manual adjustment by admin
- `EXPIRE`: Points expired

---

## Common Error Responses

**Invalid Client ID (400):**
```json
{
  "ok": false,
  "error": "Invalid clientId"
}
```

**Client Not Found (404):**
```json
{
  "ok": false,
  "error": "Client not found"
}
```

**Reward Not Found (404):**
```json
{
  "ok": false,
  "error": "Reward not found"
}
```

**Server Error (500):**
```json
{
  "ok": false,
  "error": "Failed to load loyalty data"
}
```

---

## CORS Headers

All endpoints support CORS with the following headers:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization`

---

## Notes

1. **Authentication:** Currently using `clientId` query parameter for development. Will be replaced with authenticated session/OTP token in production.

2. **All endpoints support OPTIONS** method for CORS preflight requests.

3. **Date formats:** All dates are in ISO 8601 format (e.g., `2024-06-05T18:30:00.000Z`).

4. **Points:** All point values are decimal numbers (can have up to 2 decimal places).

---

## Postman Collection Setup

### Environment Variables
Create a Postman environment with:
- `base_url`: `http://localhost:3000/api/public/client/loyalty`
- `client_id`: `1` (or your test client ID)

### Example Collection Structure

**Folder: Loyalty Points API**

1. **GET Dashboard**
   - URL: `{{base_url}}/me?clientId={{client_id}}`
   - Method: GET

2. **GET Rewards**
   - URL: `{{base_url}}/rewards?clientId={{client_id}}`
   - Method: GET

3. **POST Redeem Reward**
   - URL: `{{base_url}}/rewards/1/redeem?clientId={{client_id}}`
   - Method: POST
   - Body (JSON):
     ```json
     {
       "confirm": true
     }
     ```

4. **GET Activity (Basic)**
   - URL: `{{base_url}}/activity?clientId={{client_id}}&page=1&limit=10`
   - Method: GET

5. **GET Activity (Filtered)**
   - URL: `{{base_url}}/activity?clientId={{client_id}}&movementType=EARN&page=1&limit=20`
   - Method: GET
