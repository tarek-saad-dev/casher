import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

// GET /api/incomes/meta — categories, payment methods, open shift
export async function GET() {
  try {
    const session = await getSession();
    const db = await getPool();

    // Categories — show all from TblExpINCat (include income-typed ones)
    const catRes = await db.request().query(`
      SELECT ExpINID, ExpINType, CatName
      FROM dbo.TblExpINCat
      WHERE CatName IS NOT NULL
      ORDER BY CatName ASC
    `);

    // Payment methods
    const pmRes = await db.request().query(`
      SELECT PaymentID, PaymentMethod
      FROM dbo.TblPaymentMethods
      ORDER BY PaymentID ASC
    `);

    // Open shift for current user (or any open shift if no session)
    let openShift = null;
    if (session) {
      const shiftRes = await db.request()
        .input('userID', sql.Int, session.UserID)
        .query(`
          SELECT TOP 1
            SM.ID AS ShiftMoveID,
            SM.NewDay,
            SM.UserID,
            U.UserName,
            SM.ShiftID,
            S.ShiftName,
            SM.StartDate,
            SM.StartTime,
            SM.Status
          FROM dbo.TblShiftMove SM
          LEFT JOIN dbo.TblUser U  ON SM.UserID  = U.UserID
          LEFT JOIN dbo.TblShift S ON SM.ShiftID = S.ShiftID
          WHERE SM.Status = 1 AND SM.UserID = @userID
          ORDER BY SM.ID DESC
        `);
      if (shiftRes.recordset.length > 0) {
        openShift = shiftRes.recordset[0];
      } else {
        // Fallback: any open shift
        const anyShiftRes = await db.request().query(`
          SELECT TOP 1
            SM.ID AS ShiftMoveID, SM.NewDay, SM.UserID,
            U.UserName, SM.ShiftID, S.ShiftName,
            SM.StartDate, SM.StartTime, SM.Status
          FROM dbo.TblShiftMove SM
          LEFT JOIN dbo.TblUser U  ON SM.UserID  = U.UserID
          LEFT JOIN dbo.TblShift S ON SM.ShiftID = S.ShiftID
          WHERE SM.Status = 1
          ORDER BY SM.ID DESC
        `);
        if (anyShiftRes.recordset.length > 0) openShift = anyShiftRes.recordset[0];
      }
    }

    return NextResponse.json({
      categories:     catRes.recordset,
      paymentMethods: pmRes.recordset,
      openShift,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/incomes/meta] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
