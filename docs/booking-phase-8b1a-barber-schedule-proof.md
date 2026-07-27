# Booking Phase 8B1A — Barber / Schedule Proof

## Public barber candidates (GLEEM, Job∈حلاق/Barber, CanReceiveBookings=1)

| EmpID | Display name | Notes |
|---|---|---|
| 5 | كريم | Weekly overnight windows present |
| 7 | محمد | Weekly 11:00–23:00 all DOW |
| 12 | زياد | **day_off override on 2026-07-27** |
| 18 | احمد | Assignment eligible |
| 25 | عمر | Assignment eligible |

Assignment count with job filter: **5**.  
Weekly working schedule rows at GLEEM: **75**.  
Employees with IsWorking=1 for today’s DOW (Mon=1): **11** (includes non-public-job staff rows).

## Why available-days showed `global_leave`

1. Specific-barber path only (`classifySpecificBarberDay`).
2. Maps `isGlobalDayOff` → `global_leave`.
3. While `BookingEnabled=0`, public branch filter excludes GLEEM → resolver returns zero public working branches → `isGlobalDayOff=true` for all.
4. Emp 12 also has a real `day_off` override today.

## 14-day capacity (SQL weekly view, ignoring public filter)

Weekly schedules indicate working capacity exists for the horizon.  
**Public** capacity cannot be proven end-to-end until `BookingEnabled=1` because discovery/availability gates reject the branch.

## Do not treat as GO

Public barber configuration data exists, but **public operational readiness is blocked** by booking pause + public visibility coupling.
