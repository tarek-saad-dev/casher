import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Booking to POS conversion tenant isolation', () => {
  const conversion = fs.readFileSync(path.join(process.cwd(),'src/apps/booking/application/convertBooking.ts'),'utf8');
  it('requires source branch to belong to the actor tenant before returning even an existing invoice',()=>{
    const owner = conversion.indexOf('FROM dbo.Location');
    const replay = conversion.indexOf('if (booking.convertedInvId)');
    const create = conversion.indexOf('deps.conversion.createServiceInvoice(');
    expect(owner).toBeGreaterThan(0);
    expect(owner).toBeLessThan(replay);
    expect(replay).toBeLessThan(create);
    expect(conversion).toContain('TenantId = @tenantId AND LegacyBranchId = @branchId');
    expect(conversion).toContain("deps.actor.tenantId?.toLowerCase() !== deps.tenantId.toLowerCase()");
    expect(conversion).toContain("status: 404, error: 'حجز غير موجود'");
  });
  it('preserves the atomic POS invoice, booking completion and event transaction',()=>{
    expect(conversion).toContain('return withUnitOfWork(async ({ transaction }) =>');
    expect(conversion).toContain('new sql.Request(transaction)');
    expect(conversion).toContain('deps.conversion.createServiceInvoice(transaction');
    expect(conversion).toContain('markBookingConverted(transaction');
    expect(conversion).toContain('deps.publishOutbox(transaction');
  });
});