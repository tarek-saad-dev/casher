import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('paid handoff reconciliation + sale UUID integration safety', () => {
  const sale = read('src/app/api/sales/route.ts');
  const pos = read('src/app/income/pos/page.tsx');
  const reconcile = read('src/lib/booking/cashierHandoff.ts');

  it('preserves sale UUID replay before trying to create a second invoice', () => {
    expect(sale).toContain('lookupCommittedSaleReplay');
    expect(sale).toContain("if (prior) return NextResponse.json(prior, { status: 200 })");
    expect(sale).toContain('idempotency,');
    expect(sale).toContain('replayed: result.replayed === true');
  });

  it('binds handoff marker inside the idempotent sale notes2 payload', () => {
    const index = sale.indexOf('const handoffMarker');
    const input = sale.indexOf('const saleInput = {');
    const idempotentWrite = sale.indexOf('await createSale(saleInput)');
    expect(index).toBeGreaterThan(-1);
    expect(input).toBeGreaterThan(index);
    expect(idempotentWrite).toBeGreaterThan(input);
    expect(sale).toContain("notes2: String(body.notes2 ?? '').slice(0, 3800) + handoffMarker");
    expect(reconcile).toContain('paid.Notes2 ??');
    expect(reconcile).toContain('CUT_HANDOFF:');
  });

  it('never schedules another sale when linking an already paid invoice failed', () => {
    const recovery = read('src/app/api/pos/barber-handoffs/recovery/route.ts');
    const repair = read('src/app/api/pos/barber-handoffs/[id]/reconcile/route.ts');
    expect(sale).toContain("handoffSync = 'needs_reconciliation'");
    expect(recovery).not.toContain('createSale(');
    expect(repair).not.toContain('createSale(');
    expect(pos).toContain('setHandoffRepair');
    expect(pos).toContain('/api/pos/barber-handoffs/recovery');
    expect(pos).toContain('clearPendingSaleRequestId');
    expect(pos).toContain('acquirePendingSaleRequestId');
  });

  it('only links fully paid same-tenant same-handoff service lines', () => {
    expect(reconcile).toContain('matchesPaidHandoffLines');
    expect(reconcile).toContain("ChargedInvID=@invId AND HandoffID<>@handoff");
    expect(reconcile).toContain('l.TenantId=TRY_CONVERT(UNIQUEIDENTIFIER,@tenantId)');
    expect(reconcile).toContain('Number(paid.Paid) + 0.01 < Number(paid.GrandTotal)');
  });
});
