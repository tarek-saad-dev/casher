import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { LoyaltyLedgerWithClient } from '@/lib/types';

export const runtime = 'nodejs';

// GET /api/loyalty/ledger
// Query params:
//   - search: search by client name or phone
//   - movementType: filter by movement type
//   - dateFrom: filter from date (ISO format)
//   - dateTo: filter to date (ISO format)
//   - page: page number (default 1)
//   - limit: items per page (default 20)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const movementType = searchParams.get('movementType') || '';
    const dateFrom = searchParams.get('dateFrom') || '';
    const dateTo = searchParams.get('dateTo') || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const offset = (page - 1) * limit;

    const db = await getPool();

    // Build WHERE clause
    const whereConditions: string[] = [];
    
    if (search.trim()) {
      whereConditions.push(`(c.[Name] LIKE N'%${search}%' OR c.Mobile LIKE N'%${search}%')`);
    }
    
    if (movementType) {
      whereConditions.push(`l.MovementType = N'${movementType}'`);
    }
    
    if (dateFrom) {
      whereConditions.push(`l.CreatedAt >= @dateFrom`);
    }
    
    if (dateTo) {
      whereConditions.push(`l.CreatedAt <= @dateTo`);
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}` 
      : '';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM [dbo].[TblLoyaltyPointLedger] l
      INNER JOIN [dbo].[TblClientLoyalty] cl ON cl.ClientLoyaltyID = l.ClientLoyaltyID
      INNER JOIN [dbo].[TblClient] c ON c.ClientID = cl.ClientID
      ${whereClause}
    `;
    
    const countRequest = db.request();
    if (dateFrom) countRequest.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo) countRequest.input('dateTo', sql.DateTime, new Date(dateTo));
    
    const countResult = await countRequest.query(countQuery);
    const totalCount = countResult.recordset[0]?.total || 0;

    // Get ledger entries with client info
    const query = `
      SELECT 
        l.LedgerID,
        c.ClientID,
        c.[Name] as ClientName,
        c.Mobile as Phone,
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
      INNER JOIN [dbo].[TblClient] c ON c.ClientID = cl.ClientID
      ${whereClause}
      ORDER BY l.CreatedAt DESC, l.LedgerID DESC
      OFFSET ${offset} ROWS
      FETCH NEXT ${limit} ROWS ONLY
    `;

    const request = db.request();
    if (dateFrom) request.input('dateFrom', sql.DateTime, new Date(dateFrom));
    if (dateTo) request.input('dateTo', sql.DateTime, new Date(dateTo));

    const result = await request.query(query);
    
    const ledger: LoyaltyLedgerWithClient[] = result.recordset.map(row => ({
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
    console.error('[api/loyalty/ledger] GET error:', message);
    return NextResponse.json(
      { error: 'فشل في جلب سجل الحركات العام', details: message },
      { status: 500 }
    );
  }
}
