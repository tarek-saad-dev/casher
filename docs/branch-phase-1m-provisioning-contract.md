# Phase 1M — Provisioning Contract

## API

`POST /api/admin/branches/provision` (admin only)

## Server operation

`provisionBranch(input, authenticatedUser)`

### Always

1. Validate unique code/name/shortName  
2. Create branch with `LifecycleStatus=SETUP`, `IsActive=0`, `PublicBookingEnabled=0`, `ExternalNotificationsEnabled=0`  
3. Seed `QueueBookingSettings` with `BookingEnabled=0`  
4. Never copy sales, bookings, queue, cash, inventory qty, attendance, payroll, ledger, targets, employees, plans  
5. Reject body: `branchId`, `isActive`, `lifecycleStatus`, `publicBookingEnabled`, `createdBy`  
6. Write lifecycle audit row  
7. Optionally grant actor branch access  

### Selective template copy (explicit)

- Queue/booking intervals from source (BookingEnabled forced off)  
- Partner share **percentages** (not balances)  

### UI

`/admin/branches/new` — final button: **Create branch in setup mode**

## Non-goals

- No real second production branch creation in this phase’s live GO path without smoke PASS  
- No silent employee / payroll / target cloning  
