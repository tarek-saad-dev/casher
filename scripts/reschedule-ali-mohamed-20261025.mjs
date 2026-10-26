#!/usr/bin/env node
/**
 * One-off operator script for booking-management E2E verification.
 * No direct SQL, no secrets stored, and NO writes unless --apply is explicitly set.
 *
 * Requires an authenticated Cut Salon staff Cookie scoped to the correct branch.
 * Always validates BOTH slots before changing either. Production actions must
 * be started by a human operator; never run from an automated PR/deploy job.
 */
import { pathToFileURL } from 'node:url';

export const SOURCE_DATE = '2026-10-25';
export const TARGET_DATE = '2026-10-28';
export const CONFIRM_PHRASE = 'MOVE-ALI-MOHAMED-2026-10-28';
export const EXPECTED = Object.freeze([
  { label: 'Ali Mahmoud', nameTokens: ['علي', 'محمود'], time: '23:00' },
  { label: 'Mohamed', nameTokens: ['محمد'], time: '23:30' },
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function canonical(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hhmm(value) {
  if (!value) return null;
  const match = String(value).match(/(?:^|[T\s])([01]?\d|2[0-3]):([0-5]\d)(?::|$|\s|\.)/);
  if (!match) return null;
  return String(Number(match[1])).padStart(2, '0') + ':' + match[2];
}

function bookingDay(row) {
  const value = row?.BookingDate;
  if (!value) return null;
  return String(value).slice(0, 10);
}

function barberIsOmar(value) {
  const normalized = canonical(value);
  return normalized.split(' ').some((part) => ['عمر', 'omar', 'amr'].includes(part));
}

function nameMatches(row, expected) {
  const name = canonical(row?.ClientName).split(' ');
  return expected.nameTokens.every((token) => name.includes(canonical(token)));
}

function safeId(row) {
  const id = Number(row?.BookingID);
  requireCondition(Number.isSafeInteger(id) && id > 0, 'Invalid booking ID from ERP.');
  return id;
}

function assertActiveBooking(row) {
  const status = canonical(row?.Status);
  requireCondition(
    ['pending', 'confirmed', 'rescheduled'].includes(status),
    'Booking ' + safeId(row) + ' is not editable (status=' + status + ').'
  );
}

function bookingTime(row) {
  return hhmm(row?.startTimeDisplay) || hhmm(row?.StartTime);
}

export function pickTargets(rows) {
  requireCondition(Array.isArray(rows), 'Invalid bookings list.');
  const selected = [];
  for (const expected of EXPECTED) {
    const atOriginalSlot = rows.filter((row) =>
      bookingDay(row) === SOURCE_DATE &&
      bookingTime(row) === expected.time &&
      barberIsOmar(row?.EmpName)
    );
    requireCondition(
      atOriginalSlot.length === 1,
      expected.label + ': expected exactly one Omar booking at ' + SOURCE_DATE +
        ' ' + expected.time + ', found ' + atOriginalSlot.length + '. Aborting.'
    );
    const booking = atOriginalSlot[0];
    requireCondition(
      nameMatches(booking, expected),
      expected.label + ': the booking at ' + expected.time +
        ' belongs to a different client name. Aborting; verify the two WhatsApp confirmations.'
    );
    assertActiveBooking(booking);
    safeId(booking);
    requireCondition(
      Number.isSafeInteger(Number(booking.AssignedEmpID)) && Number(booking.AssignedEmpID) > 0,
      'Missing original barber ID for ' + expected.label
    );
    selected.push({ expected, booking });
  }
  requireCondition(
    selected[0].booking.BookingID !== selected[1].booking.BookingID,
    'Two appointments unexpectedly reference the same booking ID.'
  );
  requireCondition(
    Number(selected[0].booking.AssignedEmpID) === Number(selected[1].booking.AssignedEmpID),
    'The two bookings have different barbers; review before moving.'
  );
  return selected;
}

function assertSnapshot(original, actual) {
  requireCondition(actual && typeof actual === 'object', 'Booking detail not returned.');
  requireCondition(safeId(original) === safeId(actual), 'Booking ID changed unexpectedly.');
  requireCondition(
    bookingDay(original) === bookingDay(actual) &&
      bookingTime(original) === bookingTime(actual) &&
      canonical(original.ClientName) === canonical(actual.ClientName) &&
      Number(original.AssignedEmpID) === Number(actual.AssignedEmpID) &&
      String(original.BookingCode ?? '') === String(actual.BookingCode ?? ''),
    'Booking changed since list lookup; refusing to modify.'
  );
  assertActiveBooking(actual);
}

function startUtc(time) {
  // Egypt was UTC+03:00 on 28 October 2026 (before the DST change).
  return new Date(TARGET_DATE + 'T' + time + ':00+03:00').toISOString();
}

function cleanBaseUrl(value) {
  const url = new URL(value);
  requireCondition(
    url.origin === 'https://ops.cutsaloon.com' && url.pathname === '/',
    'Only https://ops.cutsaloon.com is supported; no untrusted server targets.'
  );
  return url.origin;
}

function createClient({ baseUrl, cookie, fetchImpl }) {
  const base = cleanBaseUrl(baseUrl);
  requireCondition(typeof cookie === 'string' && cookie.trim().length > 0,
    'CUT_SESSION_COOKIE is required. Sign in to Cut Salon and use the active-branch session.');
  return async function request(path, method = 'GET', body) {
    const response = await fetchImpl(base + path, {
      method,
      redirect: 'manual',
      headers: {
        Cookie: cookie,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Expected JSON at ' + path +
      ' (HTTP ' + response.status + '). Check staff session/branch.'); }
    requireCondition(response.ok,
      'HTTP ' + response.status + ' at ' + path + ': ' + String(data.code ?? data.error ?? data.message ?? 'unknown'));
    return data;
  };
}

async function readBooking(request, id) {
  const data = await request('/api/bookings/' + id);
  requireCondition(data && data.booking, 'Missing ERP booking ' + id);
  return data.booking;
}

async function validateBoth(request, chosen) {
  for (const item of chosen) {
    const booking = item.booking;
    const body = {
      newStartAt: startUtc(item.expected.time),
      operationalDate: TARGET_DATE,
      targetEmpId: Number(booking.AssignedEmpID),
    };
    const result = await request('/api/operations/bookings/' +
      safeId(booking) + '/validate-move', 'POST', body);
    requireCondition(result.valid === true,
      'Slot validation failed for ' + item.expected.label + ' [' +
        String(result.code ?? 'NOT_AVAILABLE') + '] ' + String(result.message ?? ''));
  }
}

export async function run({
  apply = false,
  confirmation = '',
  baseUrl = 'https://ops.cutsaloon.com',
  cookie,
  fetchImpl = globalThis.fetch,
  log = console.log,
}) {
  requireCondition(!apply || confirmation === CONFIRM_PHRASE,
    'To apply, pass --apply --confirm=' + CONFIRM_PHRASE);
  const request = createClient({ baseUrl, cookie, fetchImpl });

  const list = await request('/api/bookings?date=' + SOURCE_DATE);
  const chosen = pickTargets(list.bookings);

  for (const { booking } of chosen) {
    const detail = await readBooking(request, safeId(booking));
    assertSnapshot(booking, detail);
  }

  // Validate both future slots before the first mutation.
  await validateBoth(request, chosen);
  log('Validated BOTH slots on ' + TARGET_DATE + ' for Omar.');
  for (const item of chosen) {
    log('Booking ' + safeId(item.booking) + ' (' + item.expected.label + ')' +
      ': ' + SOURCE_DATE + ' ' + item.expected.time +
      ' -> ' + TARGET_DATE + ' ' + item.expected.time);
  }

  if (!apply) {
    log('DRY RUN: no bookings were changed. Run with --apply and the exact confirmation phrase.');
    return { applied: false, validated: 2, changed: 0 };
  }

  // No automatic rollback: if one succeeds and the other fails, report partial state.
  let changed = 0;
  for (const item of chosen) {
    try {
      const current = await readBooking(request, safeId(item.booking));
      assertSnapshot(item.booking, current);
      const body = {
        newStartAt: startUtc(item.expected.time),
        operationalDate: TARGET_DATE,
        targetEmpId: Number(item.booking.AssignedEmpID),
        source: 'operator_manual_booking_reschedule_test_20261025',
      };
      const update = await request('/api/operations/bookings/' +
        safeId(item.booking) + '/reschedule', 'PATCH', body);
      requireCondition(update.ok === true && Number(update.bookingId) === safeId(item.booking),
        'ERP did not confirm update of booking ' + safeId(item.booking));
      const after = await readBooking(request, safeId(item.booking));
      requireCondition(
        bookingDay(after) === TARGET_DATE && bookingTime(after) === item.expected.time &&
        Number(after.AssignedEmpID) === Number(item.booking.AssignedEmpID),
        'Write returned success but ERP readback does not match for booking ' + safeId(item.booking)
      );
      changed += 1;
      log('VERIFIED: ' + item.expected.label + ' moved to ' +
        TARGET_DATE + ' ' + item.expected.time);
    } catch (error) {
      const note = changed ? 'PARTIAL SUCCESS: ' + changed +
        ' booking(s) moved, remaining untouched or unverified. Do NOT rerun blindly.' :
        'NO VERIFIED SUCCESS. Do NOT assume a change happened.';
      throw new Error(note + ' ' + String(error.message ?? error));
    }
  }
  log('SUCCESS: both bookings were moved and read back from the ERP.');
  return { applied: true, validated: 2, changed };
}

function argsFromCli(argv) {
  const apply = argv.includes('--apply');
  const confArg = argv.find((arg) => arg.startsWith('--confirm='));
  const confirmation = confArg ? confArg.slice('--confirm='.length) : '';
  const supported = argv.every((arg) => arg === '--apply' || arg === '--dry-run' || arg.startsWith('--confirm='));
  requireCondition(supported, 'Only --dry-run and --apply --confirm=... are supported.');
  return { apply, confirmation };
}

export async function main() {
  const flags = argsFromCli(process.argv.slice(2));
  await run({
    ...flags,
    cookie: process.env.CUT_SESSION_COOKIE,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('STOPPED:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
