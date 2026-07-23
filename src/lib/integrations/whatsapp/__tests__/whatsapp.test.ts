/**
 * WhatsApp Integration — Unit Tests
 *
 * All HTTP requests are mocked — no real WhatsApp messages are sent.
 *
 * Run with:
 *   npx vitest run src/lib/integrations/whatsapp/__tests__/whatsapp.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Helpers ──────────────────────────────────────────────────────────────────

let mockFetchResponse: {
  ok: boolean;
  status: number;
  text: string;
} = { ok: true, status: 200, text: '{}' };

// Mock global fetch before module imports
vi.stubGlobal('fetch', async (_url: string, _opts?: unknown) => ({
  ok: mockFetchResponse.ok,
  status: mockFetchResponse.status,
  text: async () => mockFetchResponse.text,
}));

// ── Environment helpers ───────────────────────────────────────────────────────

function setEnv(env: 'development' | 'production', enabled = true) {
  vi.stubEnv('NODE_ENV', env);
  vi.stubEnv('WHATSAPP_INTEGRATION_ENABLED', enabled ? 'true' : 'false');
  vi.stubEnv('WHATSAPP_API_BASE_URL', 'http://localhost:3000');
  vi.stubEnv('WHATSAPP_REQUEST_TIMEOUT_MS', '5000');
  vi.stubEnv('WHATSAPP_SALE_ENABLED', 'true');
  vi.stubEnv('WHATSAPP_BOOKING_ENABLED', 'true');
  vi.stubEnv('WHATSAPP_FIRST_TIME_ENABLED', 'true');
  vi.stubEnv('WHATSAPP_DEFAULT_BRANCH_NAME', 'جليم');
  vi.stubEnv('WHATSAPP_DEFAULT_BOOKING_LINK', 'https://cutsaloon.com/');
}

function setFetchResponse(status: number, body: Record<string, unknown>) {
  mockFetchResponse = {
    ok: status >= 200 && status < 300,
    status,
    text: JSON.stringify(body),
  };
}

// ── Import module under test (after stubs are set up) ────────────────────────

// We import lazily inside tests by re-importing after env changes.
// Since vitest module cache, we rely on getConfig() reading process.env at call time.
import {
  sendSaleWhatsAppMessage,
  sendBookingWhatsAppMessage,
  sendFirstTimeWhatsAppMessage,
  checkWhatsAppStatus,
} from '../service';
import { buildSalePayload, buildBookingPayload, buildFirstTimePayload, resolvePhone } from '../payload-builders';
import { validateSalePayload, validateBookingPayload, validateFirstTimePayload } from '../schemas';
import { WhatsAppValidationError } from '../errors';

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  setEnv('development', true);
  setFetchResponse(200, { success: true, ok: true, status: 'sent', messageId: 'wa-test-1', type: 'sale', sentAt: '2026-06-23T01:00:00.000Z' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('1. Environment gate', () => {
  it('returns development_only when NODE_ENV=production', async () => {
    setEnv('production', true);
    const result = await sendSaleWhatsAppMessage({
      phone: '01557994946',
      customerName: 'طارق',
      invID: 1001,
      total: 100,
    });
    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(true);
    expect((result as { reason: string }).reason).toBe('development_only');
  });

  it('returns development_only when flag is false in development', async () => {
    setEnv('development', false);
    const result = await sendSaleWhatsAppMessage({
      phone: '01557994946',
      customerName: 'طارق',
      invID: 1001,
      total: 100,
    });
    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(true);
    expect((result as { reason: string }).reason).toBe('development_only');
  });
});

describe('2. Status check', () => {
  it('returns not_ready when WhatsApp is not ready', async () => {
    setFetchResponse(200, { success: true, chromeConnected: false, whatsappReady: false, whatsappTabFound: false });
    const result = await checkWhatsAppStatus();
    expect(result.available).toBe(false);
    expect((result as { reason: string }).reason).toBe('not_ready');
  });

  it('returns available: true when all ready flags are true', async () => {
    setFetchResponse(200, { success: true, chromeConnected: true, whatsappReady: true, whatsappTabFound: true });
    const result = await checkWhatsAppStatus();
    expect(result.available).toBe(true);
  });

  it('returns development_only in production', async () => {
    setEnv('production');
    const result = await checkWhatsAppStatus();
    expect(result.available).toBe(false);
    expect((result as { reason: string }).reason).toBe('development_only');
  });
});

describe('3. Payload builders', () => {
  it('builds sale payload correctly', () => {
    const payload = buildSalePayload({
      phone: '01557994946',
      customerName: 'طارق',
      invID: 10025,
      total: 350,
      paymentMethod: 'كاش',
      services: ['حلاقة شعر', 'تحديد دقن'],
      employeeNames: ['محمد'],
    });
    expect(payload.type).toBe('sale');
    expect(payload.invoiceNumber).toBe('INV-10025');
    expect(payload.total).toBe(350);
    expect(payload.services).toEqual(['حلاقة شعر', 'تحديد دقن']);
    expect(payload.employeeName).toBe('محمد');
    expect(payload.branchName).toBe('جليم');
  });

  it('builds booking payload correctly', () => {
    const payload = buildBookingPayload({
      phone: '01557994946',
      customerName: 'طارق',
      bookingId: 1055,
      bookingDate: '2026-06-30',
      bookingTime: '15:00',
      barberName: 'محمد',
      services: ['حلاقة شعر'],
    });
    expect(payload.type).toBe('booking');
    expect(payload.bookingId).toBe('BK-1055');
    expect(payload.bookingDate).toBe('2026-06-30');
    expect(payload.bookingTime).toBe('15:00');
    expect(payload.bookingLink).toBe('https://cutsaloon.com/');
  });

  it('builds first_time payload correctly', () => {
    const payload = buildFirstTimePayload({ phone: '01557994946', customerName: 'طارق' });
    expect(payload.type).toBe('first_time');
    expect(payload.branchName).toBe('جليم');
    expect(payload.bookingLink).toBe('https://cutsaloon.com/');
  });

  it('deduplicates employee names', () => {
    const payload = buildSalePayload({
      phone: '01557994946',
      customerName: 'طارق',
      invID: 1,
      total: 100,
      employeeNames: ['محمد', 'محمد', 'كريم'],
    });
    expect(payload.employeeName).toBe('محمد / كريم');
  });
});

describe('4. Phone resolution', () => {
  it('prefers Mobile over Phone', () => {
    const phone = resolvePhone('01557994946', '0225000000');
    expect(phone).toBe('01557994946');
  });

  it('falls back to Phone when Mobile is empty', () => {
    const phone = resolvePhone('', '0225000000');
    expect(phone).toBe('0225000000');
  });

  it('returns null when both are empty', () => {
    const phone = resolvePhone('', '');
    expect(phone).toBeNull();
  });

  it('returns null when both are undefined', () => {
    const phone = resolvePhone(undefined, undefined);
    expect(phone).toBeNull();
  });
});

describe('5. Missing phone guard', () => {
  it('returns missing_phone when phone is empty', async () => {
    const result = await sendSaleWhatsAppMessage({
      phone: '',
      customerName: 'طارق',
      invID: 1,
      total: 100,
    });
    expect(result.sent).toBe(false);
    expect((result as { reason: string }).reason).toBe('missing_phone');
  });
});

describe('6. HTTP response mapping', () => {
  it('maps HTTP 400 invalid phone to invalid_phone', async () => {
    setFetchResponse(400, { success: false, error: 'Invalid Egyptian phone number' });
    const result = await sendSaleWhatsAppMessage({
      phone: '01557994946',
      customerName: 'طارق',
      invID: 1,
      total: 100,
    });
    expect(result.sent).toBe(false);
    expect((result as { reason: string }).reason).toBe('invalid_phone');
  });

  it('maps HTTP 503 to whatsapp_not_ready', async () => {
    setFetchResponse(503, { success: false, error: 'WhatsApp not ready' });
    const result = await sendSaleWhatsAppMessage({
      phone: '01557994946',
      customerName: 'طارق',
      invID: 1,
      total: 100,
    });
    expect(result.sent).toBe(false);
    expect((result as { reason: string }).reason).toBe('whatsapp_not_ready');
  });

  it('maps HTTP 500 to remote_error', async () => {
    setFetchResponse(500, { success: false, error: 'Selenium error' });
    const result = await sendSaleWhatsAppMessage({
      phone: '01557994946',
      customerName: 'طارق',
      invID: 1,
      total: 100,
    });
    expect(result.sent).toBe(false);
    expect((result as { reason: string }).reason).toBe('remote_error');
  });

  it('maps successful 200 to sent: true', async () => {
    setFetchResponse(200, { success: true, ok: true, status: 'sent', messageId: 'wa-test-1', type: 'sale', sentAt: '2026-06-23T01:00:00.000Z' });
    const result = await sendSaleWhatsAppMessage({
      phone: '01557994946',
      customerName: 'طارق',
      invID: 1,
      total: 100,
    });
    expect(result.sent).toBe(true);
    expect((result as { status: string }).status).toBe('sent');
    expect((result as { messageId?: string }).messageId).toBe('wa-test-1');
  });

  it('does not treat legacy submitted without messageId as sent', async () => {
    setFetchResponse(200, { success: true, status: 'submitted', type: 'sale', sentAt: '2026-06-23T01:00:00.000Z' });
    const result = await sendSaleWhatsAppMessage({
      phone: '01557994946',
      customerName: 'طارق',
      invID: 1,
      total: 100,
    });
    expect(result.sent).toBe(false);
    expect((result as { reason: string }).reason).toBe('invalid_response');
  });

  it('maps not_registered from bot', async () => {
    setFetchResponse(400, {
      ok: false,
      success: false,
      status: 'not_registered',
      phone: '201039244023',
      error: 'Phone number is not registered on WhatsApp',
    });
    const { sendEmployeeSaleWhatsAppMessage } = await import('../service');
    const result = await sendEmployeeSaleWhatsAppMessage({
      phone: '01039244023',
      employeeName: 'زياد',
      invID: 7705,
      employeeId: 12,
      services: ['Haircut'],
    });
    expect(result.sent).toBe(false);
    expect((result as { reason: string }).reason).toBe('not_registered');
  });
});

describe('7. Timeout and connection failure', () => {
  it('maps AbortError to timeout', async () => {
    vi.stubGlobal('fetch', async () => {
      const err = new DOMException('Aborted', 'AbortError');
      throw err;
    });
    const result = await sendSaleWhatsAppMessage({
      phone: '01557994946',
      customerName: 'طارق',
      invID: 1,
      total: 100,
    });
    expect(result.sent).toBe(false);
    expect((result as { reason: string }).reason).toBe('timeout');

    // Restore original mock
    vi.stubGlobal('fetch', async (_url: string, _opts?: unknown) => ({
      ok: mockFetchResponse.ok,
      status: mockFetchResponse.status,
      text: async () => mockFetchResponse.text,
    }));
  });

  it('maps ECONNREFUSED to connection_failed', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED');
    });
    const result = await sendSaleWhatsAppMessage({
      phone: '01557994946',
      customerName: 'طارق',
      invID: 1,
      total: 100,
    });
    expect(result.sent).toBe(false);
    expect((result as { reason: string }).reason).toBe('connection_failed');

    vi.stubGlobal('fetch', async (_url: string, _opts?: unknown) => ({
      ok: mockFetchResponse.ok,
      status: mockFetchResponse.status,
      text: async () => mockFetchResponse.text,
    }));
  });
});

describe('8. Booking confirmation', () => {
  it('sends booking message correctly', async () => {
    setFetchResponse(200, { success: true, ok: true, status: 'sent', messageId: 'wa-booking-1', type: 'booking', sentAt: '2026-06-23T01:00:00.000Z' });
    const result = await sendBookingWhatsAppMessage({
      phone: '01557994946',
      customerName: 'طارق',
      bookingId: 1055,
      bookingDate: '2026-06-30',
      bookingTime: '15:00',
    });
    expect(result.sent).toBe(true);
  });

  it('preserves bookingDate and bookingTime exactly as stored', () => {
    const payload = buildBookingPayload({
      phone: '01557994946',
      customerName: 'طارق',
      bookingDate: '2026-06-30',
      bookingTime: '23:30',
    });
    expect(payload.bookingDate).toBe('2026-06-30');
    expect(payload.bookingTime).toBe('23:30');
  });
});

describe('9. Validation', () => {
  it('rejects invalid date format in booking payload', () => {
    expect(() =>
      validateBookingPayload({
        type: 'booking',
        phone: '01557994946',
        customerName: 'طارق',
        bookingDate: '30-06-2026',
        bookingTime: '15:00',
      }),
    ).toThrow(WhatsAppValidationError);
  });

  it('rejects invalid time format in booking payload', () => {
    expect(() =>
      validateBookingPayload({
        type: 'booking',
        phone: '01557994946',
        customerName: 'طارق',
        bookingDate: '2026-06-30',
        bookingTime: '3pm',
      }),
    ).toThrow(WhatsAppValidationError);
  });

  it('rejects extra variables that overwrite protected fields', () => {
    expect(() =>
      validateSalePayload({
        type: 'sale',
        phone: '01557994946',
        customerName: 'طارق',
        variables: { phone: '00000000000' },
      }),
    ).toThrow(WhatsAppValidationError);
  });

  it('preserves valid extra variables', () => {
    const result = validateSalePayload({
      type: 'sale',
      phone: '01557994946',
      customerName: 'طارق',
      variables: { campaignId: 42, tag: 'vip' },
    });
    expect(result.variables?.campaignId).toBe(42);
    expect(result.variables?.tag).toBe('vip');
  });
});

describe('10. No fetch in production', () => {
  it('never calls fetch when NODE_ENV=production', async () => {
    setEnv('production', true);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await sendSaleWhatsAppMessage({ phone: '01557994946', customerName: 'طارق', invID: 1, total: 100 });
    await sendBookingWhatsAppMessage({ phone: '01557994946', customerName: 'طارق', bookingDate: '2026-06-30', bookingTime: '15:00' });
    await sendFirstTimeWhatsAppMessage({ phone: '01557994946', customerName: 'طارق' });

    expect(fetchSpy).not.toHaveBeenCalled();

    vi.stubGlobal('fetch', async (_url: string, _opts?: unknown) => ({
      ok: mockFetchResponse.ok,
      status: mockFetchResponse.status,
      text: async () => mockFetchResponse.text,
    }));
  });
});
