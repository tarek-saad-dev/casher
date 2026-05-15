import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { LoyaltyClientDetailResponse } from '@/lib/types';

export const runtime = 'nodejs';

// GET /api/loyalty/client/:clientId
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

    const db = await getPool();

    // Get client basic info
    const clientResult = await db.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT 
          c.ClientID,
          c.[Name] as ClientName,
          c.Mobile as Phone
        FROM [dbo].[TblClient] c
        WHERE c.ClientID = @clientId
      `);

    if (clientResult.recordset.length === 0) {
      return NextResponse.json(
        { error: 'العميل غير موجود' },
        { status: 404 }
      );
    }

    const client = clientResult.recordset[0];

    // Get loyalty data with tier info
    const loyaltyResult = await db.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT 
          cl.ClientLoyaltyID,
          cl.ClientID,
          cl.PointsBalance,
          cl.LifetimeEarnedPoints,
          cl.LifetimeRedeemedPoints,
          cl.LifetimeAdjustedPoints,
          cl.TierID,
          cl.TotalVisits,
          cl.TotalSpend,
          cl.LastVisitDate,
          cl.LastEarnAt,
          cl.IsActive,
          cl.CreatedAt,
          cl.UpdatedAt,
          lt.TierCode,
          lt.TierNameAr,
          lt.TierNameEn,
          lt.MinLifetimePoints,
          lt.PointsMultiplier
        FROM [dbo].[TblClientLoyalty] cl
        LEFT JOIN [dbo].[TblLoyaltyTier] lt ON lt.TierID = cl.TierID
        WHERE cl.ClientID = @clientId
      `);

    const loyalty = loyaltyResult.recordset[0] || null;

    // Get recent ledger entries (last 20)
    const ledgerResult = await db.request()
      .input('clientId', sql.Int, clientId)
      .query(`
        SELECT TOP 20
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
        WHERE cl.ClientID = @clientId
        ORDER BY l.CreatedAt DESC, l.LedgerID DESC
      `);

    const recentLedger = ledgerResult.recordset.map(row => ({
      ...row,
      CreatedAt: new Date(row.CreatedAt).toISOString()
    }));

    // Calculate stats
    const stats = {
      totalEarnedFromSales: 0,
      totalManualAdjustments: 0,
      totalReversed: 0,
      currentBalance: loyalty?.PointsBalance || 0
    };

    if (recentLedger.length > 0) {
      recentLedger.forEach(entry => {
        if (entry.MovementType === 'EARN_SALE') {
          stats.totalEarnedFromSales += entry.PointsDelta;
        } else if (entry.MovementType === 'ADJUST_ADD') {
          stats.totalManualAdjustments += entry.PointsDelta;
        } else if (entry.MovementType === 'ADJUST_SUBTRACT') {
          stats.totalManualAdjustments += entry.PointsDelta; // negative value
        } else if (entry.MovementType === 'REVERSAL') {
          stats.totalReversed += Math.abs(entry.PointsDelta);
        }
      });
    }

    const response: LoyaltyClientDetailResponse = {
      client: {
        ClientID: client.ClientID,
        ClientName: client.ClientName,
        Phone: client.Phone
      },
      loyalty: loyalty ? {
        ...loyalty,
        CreatedAt: new Date(loyalty.CreatedAt).toISOString(),
        UpdatedAt: loyalty.UpdatedAt ? new Date(loyalty.UpdatedAt).toISOString() : null,
        LastVisitDate: loyalty.LastVisitDate ? new Date(loyalty.LastVisitDate).toISOString() : null,
        LastEarnAt: loyalty.LastEarnAt ? new Date(loyalty.LastEarnAt).toISOString() : null,
        ClientName: client.ClientName,
        Phone: client.Phone
      } : null,
      recentLedger,
      stats
    };

    return NextResponse.json(response);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/loyalty/client] GET error:', message);
    return NextResponse.json(
      { error: 'فشل في جلب بيانات العميل', details: message },
      { status: 500 }
    );
  }
}
