import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import { getCairoInvTimeDotStr } from '@/lib/businessDate';
import { lockOperationalWrite } from '@/lib/branch/operationalGates';
import type { BookingConversionPort } from '@/contracts/bookingConversion';

const INV_TYPE = 'خدمة';

/**
 * POS-owned legacy adapter for booking → service invoice conversion.
 * Booking must not import this module; wire from the composition root.
 */
export function createLegacyBookingConversionAdapter(): BookingConversionPort {
  return {
    async createServiceInvoice(tx, actor, input) {
      void actor;

      const nextInvRes = await new sql.Request(tx)
        .input('invType', sql.NVarChar, INV_TYPE)
        .query(`
          SELECT ISNULL(MAX(invID), 0) + 1 AS NextInvID
          FROM [dbo].[TblinvServHead] WITH (UPDLOCK, HOLDLOCK)
          WHERE invType = @invType
        `);
      const newInvId = Number(nextInvRes.recordset[0].NextInvID);

      await lockOperationalWrite(tx, {
        branchId: input.locationId,
        businessDayId: input.businessDayId,
        shiftSessionId: input.shiftInstanceId,
        requireShift: true,
      });

      const totalQty = input.lines.reduce((sum, line) => sum + line.quantity, 0);
      const total = input.lines.reduce(
        (sum, line) => sum + line.unitPrice * line.quantity,
        0,
      );
      const invTime = getCairoInvTimeDotStr();
      const notes = (input.notes ?? 'حجز').substring(0, 100);
      const invNotes = (input.notes ?? 'حجز').substring(0, 50);

      await new sql.Request(tx)
        .input('invID', sql.Int, newInvId)
        .input('invType', sql.NVarChar(20), INV_TYPE)
        .input('invDate', sql.Date, input.businessDate)
        .input('invTime', sql.NVarChar(50), invTime)
        .input('clientId', sql.Int, input.clientId)
        .input('userID', sql.Int, input.userId)
        .input('totalQty', sql.Decimal(10, 2), totalQty)
        .input('subTotal', sql.Decimal(10, 2), total)
        .input('grandTotal', sql.Decimal(10, 2), total)
        .input('shift', sql.Int, input.shiftInstanceId)
        .input('pmID', sql.Int, input.paymentMethodId)
        .input('notes', sql.NVarChar(100), notes)
        .input('invNotes', sql.NVarChar(50), invNotes)
        .input('branchId', sql.Int, input.locationId)
        .input('businessDayId', sql.Int, input.businessDayId)
        .query(`
          INSERT INTO [dbo].[TblinvServHead] (
            invID, invType, invDate, invTime, ClientID, UserID,
            TotalQty, SubTotal, Dis, DisVal, Tax, TaxVal, GrandTotal,
            invNotes, TotalBonus, ShiftMoveID,
            ReservDate, ReservTime, Notes,
            PayCash, PayVisa, isActive, Notes2, Payment, PayDue, PaymentMethodID,
            BranchID, BusinessDayID
          ) VALUES (
            @invID, @invType, @invDate, @invTime, @clientId, @userID,
            @totalQty, @subTotal, 0, 0, 0, 0, @grandTotal,
            @invNotes, 0, @shift,
            NULL, NULL, @notes,
            0, 0, 'no', '', @grandTotal, 0, @pmID,
            @branchId, @businessDayId
          )
        `);

      for (const line of input.lines) {
        const qty = line.quantity || 1;
        const price = line.unitPrice || 0;
        await new sql.Request(tx)
          .input('invID', sql.Int, newInvId)
          .input('invType', sql.NVarChar(20), INV_TYPE)
          .input('empId', sql.Int, line.employeeId)
          .input('proId', sql.Int, line.catalogItemId)
          .input('qty', sql.Decimal(8, 2), qty)
          .input('price', sql.Decimal(10, 2), price)
          .input('value', sql.Decimal(10, 2), price * qty)
          .input('priceAfterDis', sql.Decimal(10, 2), price)
          .input('rDate', sql.Date, line.reservationDate)
          .query(`
            INSERT INTO [dbo].[TblinvServDetail] (
              invID, invType, EmpID, ProID,
              Dis, DisVal, SPrice, SValue, SPriceAfterDis,
              PPrice, PValue, Qty, ProType, Notes, Bonus, ReservDate
            ) VALUES (
              @invID, @invType, @empId, @proId,
              0, 0, @price, @value, @priceAfterDis,
              0, 0, @qty, NULL, '', 0, @rDate
            )
          `);
      }

      return {
        legacyInvId: newInvId,
        legacyInvType: INV_TYPE,
        invoiceId: `${INV_TYPE}:${newInvId}`,
      };
    },
  };
}

export type { BookingConversionPort };
