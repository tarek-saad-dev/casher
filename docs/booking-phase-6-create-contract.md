# Booking Phase 6 — Create contract

`POST /api/public/booking/create` → `createPublicBooking`.

Required: branchCode, date (WorkDate), time, dayOffset 0|1, serviceIds, customer.name/phone.
Optional: planToken, notes, empId (specific), mode, clientRequestId / Idempotency-Key.

Policy: `any_barber` **ignores** client empId. Legacy `nearest`/`specific` accepted.

planToken becomes mandatory after cutsaloon.com migration; today `absent_legacy` allowed with full revalidation.
