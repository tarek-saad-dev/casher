import 'server-only';
import { lookupClientIdByPhone } from '@/lib/client/clientPhoneLookup';
import { getPool, sql } from '@/lib/db';
import { listPublicUpcomingBookings } from '@/lib/booking/publicBookingReader';
import type { AiToolCallRequest, AiToolExecutionContext, AiToolResult } from './types';

export async function executeGetCustomerContext(
  _request: AiToolCallRequest,
  ctx: AiToolExecutionContext,
): Promise<Omit<AiToolResult, 'durationMs'>> {
  const phone = String(ctx.phone || '').trim();
  const input = { phoneSuffix: phone.slice(-4) };

  if (!phone) {
    return {
      name: 'get_customer_context',
      ok: false,
      input,
      errorCode: 'PHONE_REQUIRED',
      errorMessage: 'Conversation phone missing',
    };
  }

  try {
    const lookup = await lookupClientIdByPhone(phone);
    if (lookup.ambiguous) {
      return {
        name: 'get_customer_context',
        ok: true,
        input,
        data: {
          knownCustomer: false,
          ambiguous: true,
          displayName: null,
          upcomingBookings: [],
        },
      };
    }
    if (!lookup.clientId) {
      return {
        name: 'get_customer_context',
        ok: true,
        input,
        data: {
          knownCustomer: false,
          ambiguous: false,
          displayName: null,
          upcomingBookings: [],
        },
      };
    }

    const pool = await getPool();
    const nameRow = await pool
      .request()
      .input('clientId', sql.Int, lookup.clientId)
      .query(`
        SELECT TOP 1 LTRIM(RTRIM(ISNULL([Name], N''))) AS DisplayName
        FROM dbo.TblClient
        WHERE ClientID = @clientId
      `);
    const displayName = String(nameRow.recordset[0]?.DisplayName ?? '').trim() || null;

    let upcoming: Array<{
      bookingCode: string | null;
      date: string | null;
      time: string | null;
      branchName: string | null;
      status: string | null;
    }> = [];
    try {
      const upcomingResp = await listPublicUpcomingBookings({ phone, limit: 3 });
      upcoming = upcomingResp.bookings.map((b) => ({
        bookingCode: b.code ?? null,
        date: b.workDate ?? b.calendarDate ?? null,
        time: b.time ?? null,
        branchName: b.branch?.branchName ?? null,
        status: b.status ?? null,
      }));
    } catch {
      upcoming = [];
    }

    return {
      name: 'get_customer_context',
      ok: true,
      input,
      data: {
        knownCustomer: true,
        ambiguous: false,
        displayName,
        upcomingBookings: upcoming,
      },
    };
  } catch (err) {
    return {
      name: 'get_customer_context',
      ok: false,
      input,
      errorCode: 'CUSTOMER_LOOKUP_FAILED',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
