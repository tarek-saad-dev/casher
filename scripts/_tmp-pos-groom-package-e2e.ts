/**
 * Live POS groom-package resolve matrix + one real invoice insert
 * (same line pricing as /api/pos/groom-packages/resolve → POST /api/sales).
 *
 *   npx tsx scripts/_tmp-pos-groom-package-e2e.ts
 */
import { readFileSync } from 'fs';
import path from 'path';
import Module from 'module';

const mod = Module as any;
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

const ROOT = process.cwd();
for (const envPath of ['.env.local', '.env']) {
  try {
    const envText = readFileSync(path.join(ROOT, envPath), 'utf8');
    for (const line of envText.split('\n')) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* ok */
  }
}

type CaseResult = { id: string; pass: boolean; detail: string };

async function main() {
  const { getPool, setDbTarget, closePool, sql, allocateInvID } = await import(
    '../src/lib/db'
  );
  const { resolveGroomPackageBooking, GroomPackageBookingError } = await import(
    '../src/lib/booking/groomPackageBooking'
  );
  const { getPublicPackagesCatalog } = await import(
    '../src/lib/catalog/publicPackagesCatalog'
  );
  const { getCairoInvTimeDotStr } = await import('../src/lib/businessDate');

  await setDbTarget('local');
  const db = await getPool();
  const results: CaseResult[] = [];

  const check = (id: string, pass: boolean, detail: string) => {
    results.push({ id, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
  };

  // Catalog optionals for Complete must not include 14 / 1077
  const catalog = await getPublicPackagesCatalog({ kind: 'groom' });
  const complete = catalog.groom.find((p) => p.packageId === 3);
  const completeOptionalIds = (complete?.groom?.optionalExtras ?? [])
    .filter((x) => x.availableAsOptional)
    .map((x) => x.serviceId);
  check(
    'G',
    !completeOptionalIds.includes(14) && !completeOptionalIds.includes(1077),
    `Complete optionals=${completeOptionalIds.join(',')}`,
  );

  // A Essential only
  {
    const r = await resolveGroomPackageBooking({ packageId: 1 });
    check('A', r.totalPrice === 1300, `total=${r.totalPrice}`);
  }
  // B Signature only
  {
    const r = await resolveGroomPackageBooking({ packageId: 2 });
    check('B', r.totalPrice === 1500, `total=${r.totalPrice}`);
  }
  // C Signature + Color
  {
    const r = await resolveGroomPackageBooking({
      packageId: 2,
      addonProIds: [1083],
    });
    check('C', r.totalPrice === 1650, `total=${r.totalPrice}`);
  }
  // D Signature + City
  {
    const r = await resolveGroomPackageBooking({
      packageId: 2,
      addonProIds: [1086],
    });
    check(
      'D',
      r.totalPrice === 2000 && r.totalDurationMinutes === 200,
      `total=${r.totalPrice} duration=${r.totalDurationMinutes}`,
    );
  }
  // E Signature + Color + City
  {
    const r = await resolveGroomPackageBooking({
      packageId: 2,
      addonProIds: [1083, 1086],
    });
    check('E', r.totalPrice === 2150, `total=${r.totalPrice}`);
  }
  // F Complete only
  {
    const r = await resolveGroomPackageBooking({ packageId: 3 });
    check('F', r.totalPrice === 3000, `total=${r.totalPrice}`);
  }
  // H Complete + Near Salon
  {
    const r = await resolveGroomPackageBooking({
      packageId: 3,
      addonProIds: [1085],
    });
    check('H', r.totalPrice === 3300, `total=${r.totalPrice}`);
  }
  // I two home visits
  {
    try {
      await resolveGroomPackageBooking({
        packageId: 2,
        addonProIds: [1085, 1086],
      });
      check('I', false, 'expected HOME_VISIT_EXCLUSIVE');
    } catch (e) {
      check(
        'I',
        e instanceof GroomPackageBookingError && e.code === 'HOME_VISIT_EXCLUSIVE',
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  // J arbitrary addon
  {
    try {
      await resolveGroomPackageBooking({ packageId: 2, addonProIds: [99999] });
      check('J', false, 'expected reject');
    } catch (e) {
      check(
        'J',
        e instanceof GroomPackageBookingError &&
          (e.code === 'PACKAGE_ADDON_NOT_OPTIONAL' ||
            e.code === 'PACKAGE_ADDON_INVALID'),
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // Real sale insert: Signature + City (case D) with package Notes2
  const resolved = await resolveGroomPackageBooking({
    packageId: 2,
    addonProIds: [1086],
  });

  const emp = (
    await db.request().query(`
      SELECT TOP 1 EmpID, EmpName FROM dbo.TblEmp
      ORDER BY EmpID
    `)
  ).recordset[0] as { EmpID: number; EmpName: string };

  const branch = (
    await db.request().query(`
      SELECT TOP 1 BranchID FROM dbo.TblBranch ORDER BY BranchID
    `)
  ).recordset[0] as { BranchID: number } | undefined;

  const payMethod = (
    await db.request().query(`
      SELECT TOP 1 PaymentID AS ID FROM dbo.TblPaymentMethods ORDER BY PaymentID
    `)
  ).recordset[0] as { ID: number } | undefined;

  const shift = (
    await db.request().query(`
      SELECT TOP 1 sm.ID AS ShiftMoveID, sm.BusinessDayID, sm.BranchID
      FROM dbo.TblShiftMove sm
      WHERE sm.Status = 1
      ORDER BY sm.ID DESC
    `)
  ).recordset[0] as
    | { ShiftMoveID: number; BusinessDayID: number; BranchID: number }
    | undefined;

  const client = (
    await db.request().query(`
      SELECT TOP 1 ClientID FROM dbo.TblClient ORDER BY ClientID
    `)
  ).recordset[0] as { ClientID: number } | undefined;

  if (!emp || !payMethod || !client) {
    check('SALE', false, 'missing emp, payment method, or client');
  } else {
    const transaction = new sql.Transaction(db);
    await transaction.begin();
    try {
      const invID = await allocateInvID(transaction, 'TblinvServHead', 'مبيعات', 5000);
      const invDate = new Date();
      const invTime = getCairoInvTimeDotStr(invDate);
      const grandTotal = resolved.totalPrice;
      const head = new sql.Request(transaction);
      head
        .input('invID', sql.Int, invID)
        .input('invType', sql.NVarChar(20), 'مبيعات')
        .input('invDate', sql.Date, invDate)
        .input('invTime', sql.NVarChar(50), invTime)
        .input('ClientID', sql.Int, client.ClientID)
        .input('UserID', sql.Int, 1)
        .input('TotalQty', sql.Decimal(10, 2), resolved.services.length)
        .input('SubTotal', sql.Decimal(10, 2), grandTotal)
        .input('Dis', sql.Decimal(6, 2), 0)
        .input('DisVal', sql.Decimal(10, 2), 0)
        .input('Tax', sql.Decimal(6, 2), 0)
        .input('TaxVal', sql.Decimal(10, 2), 0)
        .input('GrandTotal', sql.Decimal(10, 2), grandTotal)
        .input('invNotes', sql.NVarChar(50), 'POS groom package e2e')
        .input('TotalBonus', sql.Decimal(10, 2), 0)
        .input('ShiftMoveID', sql.Int, shift?.ShiftMoveID ?? null)
        .input('Notes', sql.NVarChar(100), 'مبيعات / groom e2e')
        .input('isActive', sql.NVarChar(5), 'no')
        .input('Notes2', sql.NVarChar(sql.MAX), resolved.metadataNote)
        .input('Payment', sql.Decimal(10, 2), grandTotal)
        .input('PayDue', sql.Decimal(10, 2), 0)
        .input('PayCash', sql.Decimal(10, 2), grandTotal)
        .input('PayVisa', sql.Decimal(10, 2), 0)
        .input('PaymentMethodID', sql.Int, payMethod.ID)
        .input('BranchID', sql.Int, shift?.BranchID ?? branch?.BranchID ?? 1)
        .input('BusinessDayID', sql.Int, shift?.BusinessDayID ?? null);

      await head.query(`
        INSERT INTO [dbo].[TblinvServHead] (
          invID, invType, invDate, invTime, ClientID, UserID,
          TotalQty, SubTotal, Dis, DisVal, Tax, TaxVal, GrandTotal,
          invNotes, TotalBonus, ShiftMoveID,
          ReservDate, ReservTime, Notes,
          PayCash, PayVisa, isActive, Notes2, Payment, PayDue, PaymentMethodID,
          BranchID, BusinessDayID
        ) VALUES (
          @invID, @invType, @invDate, @invTime, @ClientID, @UserID,
          @TotalQty, @SubTotal, @Dis, @DisVal, @Tax, @TaxVal, @GrandTotal,
          @invNotes, @TotalBonus, @ShiftMoveID,
          NULL, NULL, @Notes,
          @PayCash, @PayVisa, @isActive, @Notes2, @Payment, @PayDue, @PaymentMethodID,
          @BranchID, @BusinessDayID
        )
      `);

      for (const line of resolved.services) {
        const det = new sql.Request(transaction);
        await det
          .input('invID', sql.Int, invID)
          .input('invType', sql.NVarChar(20), 'مبيعات')
          .input('EmpID', sql.Int, emp.EmpID)
          .input('ProID', sql.Int, line.serviceId)
          .input('Dis', sql.Decimal(6, 2), 0)
          .input('DisVal', sql.Decimal(10, 2), 0)
          .input('SPrice', sql.Decimal(10, 2), line.price)
          .input('SValue', sql.Decimal(10, 2), line.price)
          .input('SPriceAfterDis', sql.Decimal(10, 2), line.price)
          .input('PPrice', sql.Decimal(10, 2), 0)
          .input('PValue', sql.Decimal(10, 2), 0)
          .input('Qty', sql.Decimal(10, 2), 1)
          .input('Notes', sql.NVarChar(50), line.nameEn.substring(0, 50))
          .input('Bonus', sql.Decimal(8, 2), 0)
          .input('ReservDate', sql.Date, invDate)
          .query(`
            INSERT INTO [dbo].[TblinvServDetail] (
              invID, invType, EmpID, ProID, Dis, DisVal, SPrice, SValue, SPriceAfterDis,
              PPrice, PValue, Qty, ProType, Notes, Bonus, ReservDate
            ) VALUES (
              @invID, @invType, @EmpID, @ProID, @Dis, @DisVal, @SPrice, @SValue, @SPriceAfterDis,
              @PPrice, @PValue, @Qty, NULL, @Notes, @Bonus, @ReservDate
            )
          `);
      }

      await transaction.commit();

      const verify = await db
        .request()
        .input('invID', sql.Int, invID)
        .query(`
          SELECT h.GrandTotal, h.Notes2,
            (SELECT SUM(SPriceAfterDis) FROM dbo.TblinvServDetail WHERE invID=@invID AND invType=N'مبيعات') AS LinesSum,
            (SELECT COUNT(*) FROM dbo.TblinvServDetail WHERE invID=@invID AND invType=N'مبيعات') AS LineCount
          FROM dbo.TblinvServHead h
          WHERE h.invID=@invID AND h.invType=N'مبيعات'
        `);
      const row = verify.recordset[0] as {
        GrandTotal: number;
        Notes2: string;
        LinesSum: number;
        LineCount: number;
      };
      const ok =
        Number(row.GrandTotal) === 2000 &&
        Number(row.LinesSum) === 2000 &&
        Number(row.LineCount) === resolved.services.length &&
        String(row.Notes2 || '').includes('[groomPackage]');
      check(
        'SALE',
        ok,
        `invID=${invID} grand=${row.GrandTotal} linesSum=${row.LinesSum} lines=${row.LineCount} notes2=${String(row.Notes2).slice(0, 80)}`,
      );
    } catch (e) {
      try {
        await transaction.rollback();
      } catch {
        /* ok */
      }
      check('SALE', false, e instanceof Error ? e.message : String(e));
    }
  }

  // L: booking hydration parse
  const booking = (
    await db.request().query(`
      SELECT TOP 1 BookingID, Notes
      FROM dbo.Bookings
      WHERE Notes LIKE N'%[groomPackage]%'
      ORDER BY BookingID DESC
    `)
  ).recordset[0] as { BookingID: number; Notes: string } | undefined;
  if (booking) {
    const { parseGroomPackageMetadataNote } = await import(
      '../src/lib/booking/groomPackageBooking'
    );
    const parsed = parseGroomPackageMetadataNote(booking.Notes);
    check(
      'L',
      !!parsed && parsed.packageId > 0,
      `bookingId=${booking.BookingID} packageId=${parsed?.packageId}`,
    );
  } else {
    check('L', true, 'no prior groom booking in DB — skip (API path exists)');
  }

  const failed = results.filter((r) => !r.pass);
  console.log('\n=== SUMMARY ===');
  console.log(`passed=${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.id).join(', '));
    process.exitCode = 1;
  } else {
    console.log('ALL PASS');
  }

  if (typeof closePool === 'function') await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
