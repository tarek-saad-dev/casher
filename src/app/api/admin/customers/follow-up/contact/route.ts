import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import {
  validateContactPayload,
  toFollowUpMonthDate,
  type ContactPayload,
} from '@/lib/customerFollowUpValidation';

export const runtime = 'nodejs';

// PUT /api/admin/customers/follow-up/contact
// Upsert a follow-up contact result for a customer in a given follow-up month.
export async function PUT(req: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح — يرجى تسجيل الدخول' }, { status: 401 });
    }

    // ── Parse body ──────────────────────────────────────────────────────────
    let body: ContactPayload;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 });
    }

    // ── Validate ────────────────────────────────────────────────────────────
    const errors = validateContactPayload(body);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors[0].message, errors }, { status: 422 });
    }

    const {
      clientId,
      followUpMonth,
      resultType,
      complaintEmpId = null,
      reasonText = null,
      notes = null,
    } = body;

    // Sanitise nullable strings
    const complaintType  = (body.complaintType  || null) as string | null;
    const reasonTextClean = (reasonText  || '').trim() || null;
    const notesClean      = (notes       || '').trim() || null;
    const empIdClean      = (complaintType === 'barber' && complaintEmpId && complaintEmpId > 0)
      ? complaintEmpId : null;

    const followUpMonthDate = toFollowUpMonthDate(followUpMonth);
    const now = new Date();

    const db = await getPool();

    // ── Verify client exists ────────────────────────────────────────────────
    const clientCheck = await db.request()
      .input('clientId', sql.Int, clientId)
      .query(`SELECT 1 FROM dbo.TblClient WHERE ClientID = @clientId`);

    if (clientCheck.recordset.length === 0) {
      return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 });
    }

    // ── Verify complaintEmpId if provided ───────────────────────────────────
    if (empIdClean) {
      const empCheck = await db.request()
        .input('empId', sql.Int, empIdClean)
        .query(`SELECT 1 FROM dbo.TblEmp WHERE EmpID = @empId`);
      if (empCheck.recordset.length === 0) {
        return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
      }
    }

    // ── Upsert ──────────────────────────────────────────────────────────────
    // Check whether a record already exists for this client + month
    const existing = await db.request()
      .input('clientId',        sql.Int,  clientId)
      .input('followUpMonthDt', sql.Date, followUpMonthDate)
      .query(`
        SELECT ID FROM dbo.TblCustomerFollowUp
        WHERE ClientID = @clientId AND FollowUpMonth = @followUpMonthDt
      `);

    const r = db.request()
      .input('clientId',          sql.Int,              clientId)
      .input('followUpMonthDt',   sql.Date,             followUpMonthDate)
      .input('resultType',        sql.NVarChar(40),     resultType)
      .input('complaintType',     sql.NVarChar(40),     complaintType)
      .input('complaintEmpId',    sql.Int,              empIdClean)
      .input('reasonText',        sql.NVarChar(1000),   reasonTextClean)
      .input('notes',             sql.NVarChar(1000),   notesClean)
      .input('contactedAt',       sql.DateTime2,        now)
      .input('contactedByUserId', sql.Int,              session.UserID)
      .input('now',               sql.DateTime2,        now);

    if (existing.recordset.length === 0) {
      // INSERT
      await r.query(`
        INSERT INTO dbo.TblCustomerFollowUp
          (ClientID, FollowUpMonth, ResultType, ComplaintType, ComplaintEmpID,
           ReasonText, Notes, ContactedAt, ContactedByUserID, CreatedAt)
        VALUES
          (@clientId, @followUpMonthDt, @resultType, @complaintType, @complaintEmpId,
           @reasonText, @notes, @contactedAt, @contactedByUserId, @now)
      `);
    } else {
      // UPDATE
      await r.input('existingId', sql.Int, existing.recordset[0].ID)
        .query(`
          UPDATE dbo.TblCustomerFollowUp
          SET
            ResultType        = @resultType,
            ComplaintType     = @complaintType,
            ComplaintEmpID    = @complaintEmpId,
            ReasonText        = @reasonText,
            Notes             = @notes,
            ContactedAt       = @contactedAt,
            ContactedByUserID = @contactedByUserId,
            UpdatedAt         = @now
          WHERE ID = @existingId
        `);
    }

    // ── Return the saved record with joined employee/user names ──────────────
    const saved = await db.request()
      .input('clientId',        sql.Int,  clientId)
      .input('followUpMonthDt', sql.Date, followUpMonthDate)
      .query(`
        SELECT
          fu.ID,
          fu.ResultType,
          fu.ComplaintType,
          fu.ComplaintEmpID,
          e.EmpName  AS ComplaintEmpName,
          fu.ReasonText,
          fu.Notes,
          fu.ContactedAt,
          fu.ContactedByUserID,
          u.UserName AS ContactedByUserName
        FROM dbo.TblCustomerFollowUp fu
        LEFT JOIN dbo.TblEmp  e ON e.EmpID   = fu.ComplaintEmpID
        LEFT JOIN dbo.TblUser u ON u.UserID  = fu.ContactedByUserID
        WHERE fu.ClientID = @clientId AND fu.FollowUpMonth = @followUpMonthDt
      `);

    const row = saved.recordset[0];

    console.log(
      `[follow-up/contact] Saved ClientID=${clientId} month=${followUpMonth} ` +
      `result=${resultType} by UserID=${session.UserID}`
    );

    return NextResponse.json({
      success: true,
      followUp: {
        isContacted:          true,
        resultType:           row.ResultType,
        complaintType:        row.ComplaintType,
        complaintEmpId:       row.ComplaintEmpID,
        complaintEmpName:     row.ComplaintEmpName,
        reasonText:           row.ReasonText,
        notes:                row.Notes,
        contactedAt:          row.ContactedAt,
        contactedByUserId:    row.ContactedByUserID,
        contactedByUserName:  row.ContactedByUserName,
      },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/admin/customers/follow-up/contact] PUT error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
