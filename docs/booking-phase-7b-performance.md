# Booking Phase 7B — Performance

Cancel path avoids available-days ranges, horizon loops, catalog rebuilds.

Typical SQL:
1. Ensure tables/columns (cached)
2. Preload booking by code
3. Idempotency claim TX
4. Cancel TX: locks + reload + update + complete
5. Post-commit cache invalidate + optional interval probe

Transaction closed before fresh availability probe.
