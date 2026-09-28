import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from 'mssql';
import { convertBooking } from '../application/convertBooking';
import type { BookingSchedulingPorts } from '../public/ports';

type Row = Record<string, unknown>;

function makeTx(state: {
  booking: Row | null;
  services: Row[];
  converted: boolean;
  invoiceCalls: number;
  outbox: Row[];
  throwInvoice?: boolean;
}) {
  const tx = {} as Transaction;
  return {
    tx,
    state,
    deps: {
      tenantId: '11111111-1111-4111-8111-111111111111',
      actor: {
        actorType: 'staff' as const,
        actorId: '1',
        tenantId: '11111111-1111-4111-8111-111111111111',
        membershipId: '22222222-2222-4222-8222-222222222222',
        viewLocationId: null,
      },
      customers: {} as BookingSchedulingPorts['customers'],
      catalog: {} as BookingSchedulingPorts['catalog'],
      occupancy: {} as BookingSchedulingPorts['occupancy'],
      calendar: {
        resolveFinancialWriteContext: vi.fn(async () => ({
          tenantId: '11111111-1111-4111-8111-111111111111',
          locationId: 1,
          businessDayId: 10,
          businessDate: '2026-09-28',
          shiftInstanceId: 99,
          scope: 'SHIFT' as const,
        })),
      } as BookingSchedulingPorts['calendar'],
      conversion: {
        createServiceInvoice: vi.fn(async () => {
          state.invoiceCalls += 1;
          if (state.throwInvoice) {
            throw new Error('INVOICE_INSERT_FAILED');
          }
          return {
            legacyInvId: 5001,
            legacyInvType: 'خدمة',
            invoiceId: 'خدمة:5001',
          };
        }),
      },
      publishOutbox: vi.fn(async (_tx, event) => {
        state.outbox.push(event);
        return state.outbox.length;
      }),
    } satisfies BookingSchedulingPorts & { conversion: { createServiceInvoice: ReturnType<typeof vi.fn> } },
  };
}

vi.mock('../internal/bookingRepository', () => ({
  loadBookingForConversion: vi.fn(async (_tx, bookingId: number) => {
    const ctx = (globalThis as { __convertTest?: ReturnType<typeof makeTx> }).__convertTest;
    if (!ctx?.state.booking) return null;
    if (ctx.state.converted) {
      return {
        booking: {
          ...ctx.state.booking,
          convertedInvId: 4000,
          convertedInvType: 'خدمة',
        },
        services: ctx.state.services,
      };
    }
    return { booking: ctx.state.booking, services: ctx.state.services };
  }),
  markBookingConverted: vi.fn(async () => {
    const ctx = (globalThis as { __convertTest?: ReturnType<typeof makeTx> }).__convertTest;
    if (ctx) ctx.state.converted = true;
  }),
}));

vi.mock('@/platform/public', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/public')>();
  return {
    ...actual,
    withUnitOfWork: vi.fn(async (fn: (ctx: { transaction: Transaction }) => Promise<unknown>) =>
      fn({ transaction: {} as Transaction }),
    ),
  };
});

describe('convertBooking characterization', () => {
  it('returns existing invoice when linkage already exists (idempotent)', async () => {
    const ctx = makeTx({
      booking: {
        bookingId: 42,
        bookingCode: 'BK-TEST',
        clientId: 7,
        assignedEmpId: 3,
        branchId: 1,
        bookingDate: '2026-09-28',
        status: 'confirmed',
        convertedInvId: 4000,
        convertedInvType: 'خدمة',
      },
      services: [{ proId: 1, empId: 3, price: 100, qty: 1, reservationDate: '2026-09-28' }],
      converted: true,
      invoiceCalls: 0,
      outbox: [],
    });
    (globalThis as { __convertTest?: typeof ctx }).__convertTest = ctx;

    const result = await convertBooking(ctx.deps, {
      bookingId: 42,
      locationId: 1,
      userId: 1,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.invoiceId).toBe(4000);
      expect(result.idempotentReplay).toBe(true);
    }
    expect(ctx.deps.conversion.createServiceInvoice).not.toHaveBeenCalled();
  });

  it('does not mark booking converted when invoice insert throws (atomic rollback contract)', async () => {
    const ctx = makeTx({
      booking: {
        bookingId: 43,
        bookingCode: 'BK-FAIL',
        clientId: 7,
        assignedEmpId: 3,
        branchId: 1,
        bookingDate: '2026-09-28',
        status: 'confirmed',
        convertedInvId: null,
        convertedInvType: null,
      },
      services: [{ proId: 1, empId: 3, price: 100, qty: 1, reservationDate: '2026-09-28' }],
      converted: false,
      invoiceCalls: 0,
      outbox: [],
    });
    ctx.state.throwInvoice = true;
    (globalThis as { __convertTest?: typeof ctx }).__convertTest = ctx;

    const { markBookingConverted } = await import('../internal/bookingRepository');

    await expect(
      convertBooking(ctx.deps, {
        bookingId: 43,
        locationId: 1,
        userId: 1,
      }),
    ).rejects.toThrow('INVOICE_INSERT_FAILED');

    expect(markBookingConverted).not.toHaveBeenCalled();
    expect(ctx.state.outbox).toHaveLength(0);
  });
});
