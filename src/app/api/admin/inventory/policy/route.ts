import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import {
  getInventoryStockPolicy,
  listNegativeBalances,
  updateInventoryStockPolicy,
} from '@/lib/inventory/stockPolicy.service';
import { InventoryDomainError } from '@/lib/inventory/inventoryMutation.service';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  try {
    const [policy, negatives] = await Promise.all([
      getInventoryStockPolicy(auth.tenantId),
      listNegativeBalances(auth.tenantId),
    ]);
    return NextResponse.json({ policy, negativeBalances: negatives });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  try {
    const body = await req.json();
    const policy = await updateInventoryStockPolicy({
      tenantId: auth.tenantId,
      userId: auth.userId,
      openingStockRegistered: body.openingStockRegistered,
      negativeBalancesReconciled: body.negativeBalancesReconciled,
      activateStrictMode: Boolean(body.activateStrictMode),
      allowNegativeStock: body.allowNegativeStock,
      notes: body.notes ?? null,
    });
    const negatives = await listNegativeBalances(auth.tenantId);
    return NextResponse.json({ policy, negativeBalances: negatives });
  } catch (err: unknown) {
    if (err instanceof InventoryDomainError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
