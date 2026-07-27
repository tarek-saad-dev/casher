# Booking Phase 6 — Any-barber assignment

1. Acquire any-assignment lock.
2. Sort precheck candidates by EmpID (temporary deterministic policy).
3. For each: Emp interval lock + under-lock busy revalidation.
4. Persist first valid EmpID; `assignmentStrategy = server_selected`.

Does not trust plan ordering. Specific + any conflict via same Emp interval lock.
