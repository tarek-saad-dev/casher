# Booking Phase 6 — Locking

Transaction-owned `sp_getapplock`:

| Resource | Purpose |
|----------|---------|
| `booking:emp:{empId}:{startMs}:{endMs}` | Global EmpID absolute interval |
| `booking:any:{branchId}:{startMs}:{endMs}:{svcHash}` | Any-barber assignment |
| `operations-schedule:{empId}:{workDate}` | Existing scheduleIntegrity lock |

Timeout → `BOOKING_LOCK_TIMEOUT`. Lock keys never returned publicly.
