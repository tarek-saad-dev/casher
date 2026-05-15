import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { LoyaltyLedgerEntry } from '@/lib/types';

export const runtime = 'nodejs';

// GET /api/loyalty/client/:clientId/ledger
// Query params:
//   - page: page number (default 1)
//   - limit: items per page (default 20)
//   - movementType: filter by movement type
//   - dateFrom: filter from date (ISO format)
//   - dateTo: filter to date (ISO format)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId: clientIdStr } = await params;
    const clientId = parseInt(clientIdStr, 10);
    
    if (isNaN(clientId) || clientId <= 0) {
      return NextResponse.json(
        { error: 'معرف العميل غير صالح' },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;
    const movementType = searchParams.get('movementType') || '';
    const dateFrom = searchParams.get('dateFrom') || '';
    const dateTo = searchParams.get('dateTo') || '';

    const db = await getPool();

    // Build WHERE clause
    const whereConditions: string[] = ['cl.ClientID = @clientId'];
    
    if (movementType) {
      whereConditions.push('l.MovementType = @movementType');
    }
    
    if (dateFrom) {
      whereConditions.push('l.CreatedAt >= @dateFrom');
    }
    
    if (dateTo) {
      whereConditions.push('l.CreatedAt <= @dateTo');
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM [dbo].[TblLoyaltyPointLedger] l
      INNER JOIN [dbo].[TblClientLoyalty] cl ON cl.ClientLoyaltyID = l.ClientLoyaltyID
      ${whereClause}
    `;
    
    const countRequest = db.request().input('clientId', sql.Int, clientId);
    if (movementType) countRequest.input('movementType', sql.NVarChar(20), movementType);
    if (dateFrom) countRequest.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo) countRequest.input('dateTo', sql.DateTime, new Date(dateTo));
    
    const countResult = await countRequest.query(countQuery);
    const totalCount = countResult.recordset[0]?.total || 0;

    // Get ledger entries
    const query = `
      SELECT 
        l.LedgerID,
        l.ClientLoyaltyID,
        l.MovementType,
        l.PointsDelta,
        l.PointsBefore,
        l.PointsAfter,
        l.SourceInvID,
        l.SourceInvType,
        l.InvoiceAmount,
        l.MultiplierApplied,
        l.ShiftMoveID,
        l.UserID,
        l.Notes,
        l.IdempotencyKey,
        l.CreatedAt
      FROM [dbo].[TblLoyaltyPointLedger] l
      INNER JOIN [dbo].[TblClientLoyalty] cl ON cl.ClientLoyaltyID = l.ClientLoyaltyID
      ${whereClause}
      ORDER BY l.CreatedAt DESC, l.LedgerID DESC
      OFFSET ${offset} ROWS
      FETCH NEXT ${limit} ROWS ONLY
    `;

    const request = db.request().input('clientId', sql.Int, clientId);
    if (movementType) request.input('movementType', sql.NVarChar(20), movementType);
    if (dateFrom) request.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo) request.input('dateTo', sql.DateTime, new Date(dateTo));

    const result = await request.query(query);
    
    const ledger: LoyaltyLedgerEntry[] = result.recordset.map(row => ({
      ...row,
      CreatedAt: new Date(row.CreatedAt).toISOString()
    }));

    return NextResponse.json({
      ledger,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/loyalty/client/ledger] GET error:', message);
    return NextResponse.json(
      { error: 'فشل في جلب سجل الحركات', details: message },
      { status: 500 }
    );
  }
}
