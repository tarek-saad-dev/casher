/**
 * Guard against binding real bookings to smoke/test customer identities.
 * Pure helpers — no DB I/O (safe for unit tests).
 */

import {
  isUsableCustomerPhone,
  normalizePublicBookingPhone,
  PLACEHOLDER_CUSTOMER_PHONES,
} from '@/lib/publicBookingHelpers';

export type BookingCreatePath = 'operations' | 'admin' | 'public';

export type CustomerIdentityCause =
  | 'placeholder_phone_matched_existing_client'
  | 'usable_phone_matched_smoke_named_client'
  | 'stored_name_differs_from_submitted'
  | 'stored_smoke_name_after_upsert'
  | 'unconfirmed';

export type CustomerIdentityDiagnostic = {
  submittedName: string;
  previousName: string | null;
  clientId: number;
  phoneKind: 'placeholder' | 'usable' | 'empty';
  bookingPath: BookingCreatePath;
  cause: CustomerIdentityCause;
  causeConfirmed: boolean;
  action: 'renamed_client' | 'blocked';
  detectedAtUtc: string;
};

export type CustomerIdentityGuardResult =
  | {
      ok: true;
      finalName: string;
      renamed: boolean;
      diagnostic: CustomerIdentityDiagnostic | null;
    }
  | {
      ok: false;
      finalName: string;
      diagnostic: CustomerIdentityDiagnostic;
    };

/** Detect disposable / smoke / test customer display names. */
export function isTestOrSmokeCustomerName(name: string | null | undefined): boolean {
  if (name == null) return false;
  const n = String(name).trim();
  if (!n) return false;
  const upper = n.toUpperCase();
  if (upper.includes('[TEST]') || upper.includes('[SMOKE')) return true;
  if (/\bSMOKE\s*TEST\b/i.test(n)) return true;
  if (/\bBM\s*SMOKE\b/i.test(n)) return true;
  if (/\bDRVO[\w-]*\s*SMOKE\b/i.test(n)) return true;
  if (/DRVO\d+-?SMOKE/i.test(n)) return true;
  if (/^SMOKE([\s_-]|$)/i.test(n)) return true;
  return false;
}

export function classifyBookingPhoneKind(
  phone: string | null | undefined,
): 'placeholder' | 'usable' | 'empty' {
  const cleaned = normalizePublicBookingPhone(phone ?? '');
  if (!cleaned) return 'empty';
  if (PLACEHOLDER_CUSTOMER_PHONES.has(cleaned)) return 'placeholder';
  if (isUsableCustomerPhone(cleaned)) return 'usable';
  return 'empty';
}

export function resolveBookingCreatePath(input: {
  purpose?: string;
  bookingSource?: string | null;
}): BookingCreatePath {
  if (input.purpose === 'internal_preview') {
    if (input.bookingSource === 'admin') return 'admin';
    if (input.bookingSource === 'operations') return 'operations';
    return 'operations';
  }
  return 'public';
}

function inferCause(args: {
  phoneKind: 'placeholder' | 'usable' | 'empty';
  storedIsSmoke: boolean;
  namesDiffer: boolean;
}): { cause: CustomerIdentityCause; causeConfirmed: boolean } {
  if (args.phoneKind === 'placeholder' && args.storedIsSmoke) {
    return { cause: 'placeholder_phone_matched_existing_client', causeConfirmed: true };
  }
  if (args.phoneKind === 'usable' && args.storedIsSmoke) {
    return { cause: 'usable_phone_matched_smoke_named_client', causeConfirmed: true };
  }
  if (args.storedIsSmoke) {
    return { cause: 'stored_smoke_name_after_upsert', causeConfirmed: true };
  }
  if (args.namesDiffer) {
    return { cause: 'stored_name_differs_from_submitted', causeConfirmed: true };
  }
  return { cause: 'unconfirmed', causeConfirmed: false };
}

/**
 * Decide whether the linked client name is safe for a real booking.
 * Intentional smoke/test creates (submitted name is also smoke/test) are allowed.
 * Real submitted names win over smoke / empty / differing stored names (rename).
 */
export function evaluateCustomerIdentityForBooking(args: {
  submittedName: string;
  storedName: string | null | undefined;
  clientId: number;
  phone: string | null | undefined;
  bookingPath: BookingCreatePath;
  now?: Date;
}): CustomerIdentityGuardResult {
  const submittedName = String(args.submittedName ?? '').trim();
  const storedName =
    args.storedName == null ? null : String(args.storedName).trim() || null;
  const phoneKind = classifyBookingPhoneKind(args.phone);
  const submittedIsSmoke = isTestOrSmokeCustomerName(submittedName);
  const storedIsSmoke = isTestOrSmokeCustomerName(storedName);
  const detectedAtUtc = (args.now ?? new Date()).toISOString();
  const namesDiffer =
    !!submittedName &&
    submittedName.localeCompare(storedName ?? '', undefined, { sensitivity: 'accent' }) !== 0;

  // Intentional smoke/test booking — do not rewrite or block.
  if (submittedIsSmoke) {
    return { ok: true, finalName: submittedName, renamed: false, diagnostic: null };
  }

  if (submittedName.length < 2) {
    return {
      ok: false,
      finalName: submittedName,
      diagnostic: {
        submittedName,
        previousName: storedName,
        clientId: args.clientId,
        phoneKind,
        bookingPath: args.bookingPath,
        cause: 'unconfirmed',
        causeConfirmed: false,
        action: 'blocked',
        detectedAtUtc,
      },
    };
  }

  const needsRename = storedIsSmoke || !storedName || namesDiffer;
  if (!needsRename) {
    return {
      ok: true,
      finalName: storedName || submittedName,
      renamed: false,
      diagnostic: null,
    };
  }

  const { cause, causeConfirmed } = inferCause({
    phoneKind,
    storedIsSmoke,
    namesDiffer,
  });

  return {
    ok: true,
    finalName: submittedName,
    renamed: true,
    diagnostic: {
      submittedName,
      previousName: storedName,
      clientId: args.clientId,
      phoneKind,
      bookingPath: args.bookingPath,
      cause: storedIsSmoke
        ? cause
        : namesDiffer
          ? 'stored_name_differs_from_submitted'
          : cause,
      causeConfirmed: storedIsSmoke || namesDiffer,
      action: 'renamed_client',
      detectedAtUtc,
    },
  };
}

export function formatCustomerIdentityDiagnosticBlock(
  d: CustomerIdentityDiagnostic,
): string {
  const lines = [
    '[customer-identity-diag]',
    `detectedAtUtc=${d.detectedAtUtc}`,
    `bookingPath=${d.bookingPath}`,
    `clientId=${d.clientId}`,
    `phoneKind=${d.phoneKind}`,
    `submittedName=${d.submittedName}`,
    `previousName=${d.previousName ?? ''}`,
    `cause=${d.cause}`,
    `causeConfirmed=${d.causeConfirmed ? 'yes' : 'no'}`,
    `action=${d.action}`,
    '[/customer-identity-diag]',
  ];
  return lines.join(' ');
}

/**
 * Append a diagnostic block to booking notes without destroying originals.
 * When the combined text exceeds maxLen, keep originals + a short ref and
 * return the full overflow text for server logging.
 */
export function appendBookingDiagnosticNote(
  existingNotes: string,
  diagnostic: CustomerIdentityDiagnostic,
  maxLen: number,
): { notes: string; overflowLog: string | null; diagRef: string | null } {
  const block = formatCustomerIdentityDiagnosticBlock(diagnostic);
  const base = existingNotes.trim();
  const combined = base ? `${base} ${block}` : block;
  if (combined.length <= maxLen) {
    return { notes: combined, overflowLog: null, diagRef: null };
  }

  const diagRef = `cid-${diagnostic.clientId}-${diagnostic.detectedAtUtc.replace(/[:.]/g, '')}`;
  const stub = `[customer-identity-diag ref=${diagRef} action=${diagnostic.action} cause=${diagnostic.cause}]`;
  const withStub = base ? `${base} ${stub}` : stub;
  const notes = withStub.length <= maxLen ? withStub : stub.slice(0, maxLen);
  return {
    notes,
    overflowLog: combined,
    diagRef,
  };
}

/** Mask phone for logs — keep last 4 digits only. */
export function maskPhoneForLog(phone: string | null | undefined): string {
  const cleaned = normalizePublicBookingPhone(phone ?? '');
  if (!cleaned) return '';
  if (cleaned.length <= 4) return '****';
  return `${'*'.repeat(Math.min(cleaned.length - 4, 8))}${cleaned.slice(-4)}`;
}

/**
 * Real booking creates must leave TblClient.Name equal to the submitted form name
 * (first-time insert and phone-reuse alike). Intentional smoke names are excluded.
 */
export function shouldPersistSubmittedCustomerName(
  submittedName: string | null | undefined,
): boolean {
  const n = String(submittedName ?? '').trim();
  return n.length >= 2 && !isTestOrSmokeCustomerName(n);
}
