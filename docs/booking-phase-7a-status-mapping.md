# Booking Phase 7A — Status Mapping

Module: `src/lib/booking/publicBookingStatus.ts`

| Internal (examples) | Public |
|---|---|
| confirmed, rescheduled | confirmed |
| pending | pending |
| arrived, queued, in_service, in_progress | in_service |
| cancelled / Cancelled | cancelled |
| completed, done / Completed | completed |
| no_show | no_show |
| other | unknown |

Upcoming eligible: confirmed, pending, arrived, queued, in_service, in_progress, rescheduled.  
`canCancel`: confirmed or pending (and ≥30 minutes before start when AbsoluteStartUtc known).
