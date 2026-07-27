# Booking Phase 4 — Performance

- Settings + selected services loaded once per request
- Slots: one engine call per date (barbers busy loaded in parallel inside engine)
- Days: sequential dates with 8s TTL cache (busy version signals incomplete → short TTL)
- `collectAllCandidates` avoids N separate specific-mode calls for any-barber
- No new indexes in this phase
