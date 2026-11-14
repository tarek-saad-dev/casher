import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGroomPackageMetadataNote, parseGroomPackageMetadataNote } from '@/lib/booking/groomPackageMetadata';
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Paid invoice to barber handoff recovery contract', () => {
  const handoff = read('src/lib/booking/cashierHandoff.ts');
  const sale = read('src/app/api/sales/route.ts');
  const repair = read('src/app/api/pos/barber-handoffs/[id]/reconcile/route.ts');
  const ui = read('src/app/income/pos/page.tsx');

  it('never creates a new sale during repair, requires cashier and open branch authorization', () => {
    expect(repair).toContain("requirePageAccess('/income/pos')");
    expect(repair).toContain('resolveBranchDayAndShiftForWrite');
    expect(repair).toContain('markHandoffCharged');
    expect(repair).not.toContain('createSale(');
  });

  it('verifies actual paid invoice, same tenant branch and customer under SQL transaction', () => {
    expect(handoff).toContain('ISOLATION_LEVEL.SERIALIZABLE');
    expect(handoff).toContain('WITH (UPDLOCK,HOLDLOCK)');
    expect(handoff).toContain('dbo.TblinvServHead');
    expect(handoff).toContain('dbo.TblinvServPayment');
    expect(handoff).toContain('l.TenantId=TRY_CONVERT(UNIQUEIDENTIFIER,@tenantId)');
    expect(handoff).toContain('row.ClientID != null && paid.ClientID !== row.ClientID');
    expect(handoff).toContain('Number(paid.Paid) + 0.01 < Number(paid.GrandTotal)');
    expect(handoff).toContain("'CUT_HANDOFF:' + input.handoffId + '|'");
    expect(handoff).toContain('paid.Notes2 ??');
    expect(handoff).toContain('ChargedInvID=@invId AND HandoffID<>@handoff');
  });

  it('requires paid invoice lines with original/alternate employee attribution', () => {
    expect(handoff).toContain('ISNULL(bs.EmpID,b.AssignedEmpID) AS EmpID');
    expect(handoff).toContain('dbo.TblinvServDetail');
    expect(handoff).toContain('matchesPaidHandoffLines');
    expect(handoff).toContain('bookedLines');
    expect(handoff).toContain('await tx.rollback()');
  });

  it('never overwrites a handoff linked to a different paid invoice', () => {
    expect(handoff).toContain('row.Status ===');
    expect(handoff).toContain('row.ChargedInvID === input.invId');
    expect(handoff).toContain('row.ConvertedInvID !== input.invId');
    expect(handoff).toContain('(ConvertedInvID IS NULL OR ConvertedInvID=@invId)');
  });

  it('persists an invoice marker and offers post-reload recovery inbox without creating new sales', () => {
    const inbox = read('src/app/api/pos/barber-handoffs/recovery/route.ts');
    expect(inbox).toContain("requirePageAccess('/income/pos')");
    expect(inbox).toContain('e.TenantId=@tenant');
    expect(inbox).toContain("h.Status IN (N'pending',N'loaded')");
    expect(inbox).toContain("N'CUT_HANDOFF:'");
    expect(inbox).toContain('ISNULL(payment.Paid,0)+0.01>=inv.GrandTotal');
    expect(inbox).not.toContain('INSERT INTO');
    expect(sale).toContain("CUT_HANDOFF:");
    expect(sale).toContain("sourceHandoffId + '|'");
    expect(ui).toContain("'/api/pos/barber-handoffs/recovery'");
  });

  it('preserves Groom package metadata after appending durable handoff reference', () => {
    const groomNote = buildGroomPackageMetadataNote({
      packageId: 3, packagePrice: 1300, addonProIds: [9, 16],
      requiredServiceIds: [9, 16, 43], totalPrice: 1550,
    });
    const savedNotes = groomNote + '\nCUT_HANDOFF:246|';
    expect(parseGroomPackageMetadataNote(savedNotes)).toEqual(
      parseGroomPackageMetadataNote(groomNote),
    );
    // The sale route must emit a real newline escape, NOT a literal slash+n:
    // the parser reads the total until the next newline.
    expect(sale).toContain(String.raw`? '\nCUT_HANDOFF:'`);
    expect(sale).not.toContain(String.raw`? '\\nCUT_HANDOFF:'`);
  });

  it('keeps sale successful while clearly signaling recovery, and prevents user from retrying the payment', () => {
    expect(sale).toContain('handoffSync');
    expect(sale).toContain("handoffSync = 'needs_reconciliation'");
    expect(ui).toContain('ممنوع تعمل فاتورة تانية');
    expect(ui).toContain('إصلاح الربط بالفاتورة الموجودة');
    expect(ui).toContain('/reconcile');
  });
});
