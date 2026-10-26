# Controlled Oct 25 → Oct 28 booking move (operator only)

**Task:** [#119](https://github.com/tarek-saad-dev/casher/issues/119).

This is a one-off CLI to verify rescheduling Ali Mahmoud's 2026-10-25 23:00 booking and Mohamed's 2026-10-25 23:30 booking with the **same barber Omar**, both to Wednesday **2026-10-28** at their original times.

## Strict safeguards
- Runs through existing authenticated Cut Salon staff HTTP APIs, not direct SQL or DRVO AI credentials.
- Defaults to **dry run**; dry run lists bookings, checks exact customer/time/barber/status, and calls `validate-move` for BOTH target slots without mutation.
- Hardcoded original date, new date, names, employee and times; refuses ambiguous rows, wrong client, wrong barber, completed/cancelled/no-show status, missing permissions, or invalid slots.
- The **active branch** in your staff session controls which bookings are seen. If you are in the wrong branch the script stops. Switch to the right branch in the web UI before copying the Cookie header.
- Production write needs deliberate `--apply --confirm=MOVE-ALI-MOHAMED-2026-10-28`.
- After each PATCH, GETs the booking to verify its persisted date/time/employee. If the second write fails, reports **partial success** and stops; it does not undo the first move or retry with guesswork.
- The operations reschedule endpoint may send the existing WhatsApp customer template after a successful move. This is **not** a silent/test-only operation.

**Known discrepancy:** the provided WhatsApp confirmation copies both use Ali's name, but the customer said the 23:30 booking is in Mohamed's name. Until the actual ERP record is resolved, the script intentionally fails instead of rewriting the wrong booking.

## How an authorized operator runs it

1. Sign in at https://ops.cutsaloon.com and select the **correct branch**.
2. In browser DevTools → Network, refresh the bookings calendar and copy the `Cookie` *request header value* from an authenticated request. This is a session secret: **never send it to chat or commit it**.
3. On the workstation/VPS with the repository checked out, set the secret without adding it to shell history:

```bash
read -rsp "Paste full Cut Salon Cookie header value: " CUT_SESSION_COOKIE; echo
export CUT_SESSION_COOKIE
node scripts/reschedule-ali-mohamed-20261025.mjs --dry-run
```

4. Only after the console confirms the **two correct real bookings** and both slots valid, intentionally apply:

```bash
node scripts/reschedule-ali-mohamed-20261025.mjs --apply --confirm=MOVE-ALI-MOHAMED-2026-10-28
unset CUT_SESSION_COOKIE
```

To exercise the isolated no-network test suite:

```bash
node --test scripts/__tests__/reschedule-ali-mohamed-20261025.test.mjs
```

**Important:** PR CI runs mock tests only. No GitHub Actions workflow should execute the live `--apply` command; only an authorized operator may do that. If these are already-past bookings with completed/no-show status, stop and use the documented staff exception process instead of forcing a DB update. Do not delete or create substitute bookings to make the test pass.

No actual customer booking is changed merely by merging the PR.
