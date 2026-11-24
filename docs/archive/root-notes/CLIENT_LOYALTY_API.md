# CUT CLUB Client Loyalty API

## Base URL
```
http://localhost:3000/api/public/client
```

---

## 1. Dashboard
```
GET /loyalty/me?clientId=1
```

---

## 2. Activity History
```
GET /loyalty/activity?clientId=1&page=1&limit=10
```

---

## 3. Rewards List
```
GET /loyalty/rewards?clientId=1
```

---

## 4. Redeem Reward
```
POST /loyalty/rewards/1/redeem?clientId=1
Content-Type: application/json

{
  "confirm": true
}
```

---

## 5. Referral Info
```
GET /referral?clientId=1
```

---

## TODO
- Replace `clientId` query param with auth token/OTP
