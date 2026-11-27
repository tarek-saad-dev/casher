import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const read=(p:string)=>readFileSync(resolve(process.cwd(),p),'utf8');
describe('December staged checkout integration source contract (not SQL acceptance)',()=>{
 it('revalidates the quote before either invoice allocation and persists redemption before commit',()=>{
  for(const file of ['src/lib/sales/legacyRouteSaleCreate.ts','src/apps/pos/internal/legacySaleCreateAdapter.ts']){
   const s=read(file);
   expect(s.indexOf('await quoteDecemberInTransaction(transaction')).toBeGreaterThan(0);
   expect(s.indexOf('await quoteDecemberInTransaction(transaction')).toBeLessThan(s.indexOf('await allocateInvID'));
   expect(s).toContain('decemberQuote.discountPiasters !== Math.round(disVal * 100)');
   expect(s.indexOf('await persistDecemberRedemption(transaction')).toBeLessThan(s.indexOf('return { invID: newInvID, invType, targetRecalcScopes }'));
   expect(s).toContain('await assertNoZeroInvoiceCash(transaction, newInvID)');
  }
 });
 it('keeps the quote restricted to staging, authoritative catalog, and verified identity',()=>{
  const s=read('src/lib/campaigns/december-exam/stagingCheckout.ts');
  for(const x of ["DECEMBER_EXAM_STAGING_CHECKOUT_ENABLED!=='true'","DB_NAME()=N'last132_agent'","SUSER_SNAME()=N'drvo_agent'","DECEMBER_ALREADY_REDEEMED","p.SPrice1","minor(item.sPrice)!==price","a.LinkStatus=\'ACTIVE\'","l.IsActive=1","clubActive:f.ClubLinked===1","INSERT dbo.CutOfferRedemption"])expect(s).toContain(x);
 });
 it('permits zero payment only after verified campaign and zero-payment method guards',()=>{
  const s=read('src/app/api/sales/route.ts');
  expect(s).toContain('decemberZeroMethod = await getStagingZeroPaymentMethod()');
  expect(s).toContain('activeAllocations.length === 0 && decemberZeroMethod === undefined');
  expect(s).toContain('discountPercent: decemberQuote?.percent ?? body.dis');
  const guard=read('src/lib/campaigns/december-exam/stagingZeroPayment.ts');
  expect(guard).toContain('DECEMBER_ZERO_PAYMENT_STAGING_GUARD');
  expect(guard).toContain('NOT EXISTS(SELECT 1 FROM dbo.TblCashMove');
  expect(guard).toContain('NOT EXISTS(SELECT 1 FROM dbo.TblinvServPayment');
  expect(read('src/apps/pos/internal/legacySaleCreateAdapter.ts')).toContain('input.postSaleCashMove && !decemberZero');
 });
 it('requires a fresh UI quote and keeps manual header discounts separate',()=>{
  const s=read('src/app/income/pos/page.tsx');
  expect(s).toContain('decemberQuote.key!==decemberKey');
  expect(s).toContain('dis: decemberQuote ? 0 : state.discountPercent');
  expect(s).toContain('decemberExam:{expectedDiscountMinor:decemberQuote.discountMinor}');
  expect(s).toContain('NEXT_PUBLIC_DECEMBER_EXAM_STAGING_CHECKOUT_ENABLED');
 });
});
