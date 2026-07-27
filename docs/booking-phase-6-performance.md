# Booking Phase 6 — Performance

Create does not run available-days / horizon grids.

Cost drivers: `create_precheck` evaluator + under-lock busy reload.

TX held only for locks + inserts (services/branch resolved before BEGIN).
