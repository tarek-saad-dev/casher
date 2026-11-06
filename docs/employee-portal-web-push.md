# CUT STAFF Web Push — ops checklist

Staff booking alerts use Web Push on `/employee-portal`. Subscribe can succeed while delivery stays silent if server send config or the outbox hook is missing.

## Required env (Next process on VPS)

| Variable | Required for | Notes |
|----------|--------------|-------|
| `VAPID_PUBLIC_KEY` | Enable + send | Browser `PushManager.subscribe` |
| `VAPID_PRIVATE_KEY` | Send only | Without it, enable still works; `sendStaffBookingPush` returns `no_vapid` |
| `VAPID_CONTACT` or `VAPID_SUBJECT` | Send only | e.g. `mailto:ops@yourdomain.com` |

Generate a key pair once and keep it stable (rotating keys invalidates existing subscriptions):

```bash
npx web-push generate-vapid-keys
```

Restart the app process after setting env.

## Delivery path (extracted booking)

1. Customer creates a booking → platform outbox `booking.created`.
2. Outbox WhatsApp confirmation runs.
3. On WhatsApp success, outbox calls staff Web Push for `AssignedEmpID` (`notifyStaffOfOutboxBookingCreated`).
4. Push failure is logged and does **not** retry the outbox row.

Inline `scheduleStaffBookingPush` in `createPublicBooking` is skipped when `suppressNotification: true` (extracted `createBooking`).

## Verify on VPS / DB

```sql
SELECT TOP 20 EmpID, TenantId, LEFT(Endpoint, 80) AS Endpoint, CreatedAt, UpdatedAt
FROM dbo.TblEmployeePortalPushSubscription
ORDER BY UpdatedAt DESC;
```

Confirm a row exists for the **same EmpID** assigned on the test booking.

After a real booking, look for:

- `[staffBookingPush]` or `[platform-outbox] staff push failed` in app logs
- absence of any staff-push log after booking → outbox tick may not be running

## Device checks

- Android Chrome: notification permission granted for the site; battery restrictions not killing the PWA.
- iOS: install CUT STAFF to Home Screen, open from the icon (standalone), iOS 16.4+.
- Service worker scope: `/employee-portal` (`/employee-portal/sw.js`).

## Production migration

Deploy readiness requires the Drvo migration key `booking-cashier-handoff` applied via [MIGRATION-CONTROL-PLANE](./drvo/MIGRATION-CONTROL-PLANE.md) before VPS deploy succeeds. Risk: `LOW`. `requiresBackup`: `false`.
