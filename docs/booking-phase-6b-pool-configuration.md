# Booking Phase 6B — Pool configuration

| Setting | Value | Change? |
|---------|-------|---------|
| max | 10 | **No** — failure was same-connection re-entrancy, not pool max |
| min | 2 | No |
| idleTimeoutMillis | 30000 | No |
| acquireTimeoutMillis | 60000 | No |
| connectionTimeout | 60000 | No |
| requestTimeout | 60000 | No |

No env override of pool sizes found. Do not raise max without Azure SQL + runtime evidence.
