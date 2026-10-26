import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Source-level boundary regressions: do not load server-only modules or connect to SQL. */
const source = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

describe('Salon Pack module contracts — Phase B baseline', () => {
  it('keeps booking conversion behind the canonical POS-implemented port', () => {
    const ports = source('src/apps/booking/public/ports.ts');
    const contract = source('src/contracts/bookingConversion.ts');
    const booking = source('src/apps/booking/application/convertBooking.ts');
    const adapter = source('src/apps/pos/internal/legacyBookingConversionAdapter.ts');
    expect(ports).toContain("from '@/contracts/bookingConversion'");
    expect(contract).toContain('export interface BookingConversionPort');
    expect(contract).toContain('tx: Transaction');
    expect(contract).toContain('tenantId: string');
    expect(contract).toContain('idempotencyKey: string');
    expect(booking).toContain('await deps.conversion.createServiceInvoice(transaction');
    expect(adapter).toContain('createLegacyBookingConversionAdapter(): BookingConversionPort');
    expect(adapter).toContain('async createServiceInvoice(tx, actor, input)');
    expect(booking).not.toMatch(/from ['"]@\/apps\/pos\/(internal|application)/);
    expect(booking).not.toContain('INSERT INTO [dbo].[TblinvServHead]');
  });

  it('converts and publishes exactly once through the same UnitOfWork', () => {
    const booking = source('src/apps/booking/application/convertBooking.ts');
    const uow = source('src/platform/uow/UnitOfWork.ts');
    expect(booking).toContain('return withUnitOfWork(async ({ transaction }) =>');
    expect(booking).toContain('if (booking.convertedInvId)');
    expect(booking).toContain('await markBookingConverted(transaction');
    expect(booking).toContain('await deps.publishOutbox(transaction');
    expect(booking).toContain("eventType: 'booking.completed'");
    expect(booking).toContain("idempotencyKey: `booking.completed:${idempotencyKey}`");
    expect(uow).toContain('await transaction.commit()');
    expect(uow).toContain('await transaction.rollback()');
    expect(source('src/apps/pos/internal/legacyBookingConversionAdapter.ts')).not.toContain('new sql.Transaction(');
  });

  it('keeps queue scheduling on shared customers/catalog/workforce/calendar ports', () => {
    const ports = source('src/apps/queue/public/ports.ts');
    for (const name of ['CustomersPort', 'CatalogPort', 'OccupancyPort', 'OperationalCalendarPort']) {
      expect(ports).toContain(name);
    }
    expect(ports).toContain('publishOutbox: (');
    expect(ports).toContain('tx: Transaction');
    expect(ports).not.toMatch(/from ['"]@\/apps\/(pos|treasury)\/internal/);
  });

  it('keeps POS to Treasury handoff in a composition root with transactional cash posting', () => {
    const pos = source('src/apps/pos/application/createSale.ts');
    const composition = source('src/lib/posSaleTreasuryComposition.ts');
    expect(pos).toContain('isPosSaleTreasuryPostingEnabled()');
    expect(pos).toContain('buildSaleCashMovePoster(ports.tenantId, ports.actor)');
    expect(pos).toContain('executeLegacySaleCreateTransaction(');
    expect(pos).toContain('{ ...txInput, postSaleCashMove }');
    expect(pos).toContain('await transaction.commit()');
    expect(composition).toContain("from '@/apps/treasury/public'");
    expect(composition).toContain('return postSaleCashMove(tx, actor, {');
    expect(composition).toContain('tenantId,');
    expect(composition).toContain('idempotencyKey,');
    expect(pos).not.toMatch(/from ['"]@\/apps\/treasury\/internal/);
  });

  it('requires Treasury to validate tenant-owned cash masters inside the given transaction', () => {
    const treasury = source('src/apps/treasury/application/createIncome.ts');
    expect(treasury).toContain('tx: Transaction');
    expect(treasury).toContain('await ports.moneyMovement.post(tx, ports.actor');
    expect(treasury).toContain('TenantId = @tenantId');
    expect(treasury).toContain('idempotencyKey: input.idempotencyKey');
    expect(treasury).not.toContain('UPDATE dbo.TblNewDay');
  });

  it('documents the financial gap without declaring cross-module staging acceptance', () => {
    const doc = source('docs/drvo/SALON-PACK-MODULE-CONTRACTS-V1.md');
    expect(doc).toContain('issue #148');
    expect(doc).toContain('Stage B **In progress**');
    expect(doc).toContain('P1');
    expect(doc).toContain('shared transaction');
  });
});
