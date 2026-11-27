import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
const read=(p:string)=>readFileSync(resolve(process.cwd(),p),'utf8');
describe('December staged invoice integration source guards (not a SQL E2E test)',()=>{
 it('runs confirmation in both transactional sale adapters, before return',()=>{
  for(const file of ['src/lib/sales/legacyRouteSaleCreate.ts','src/apps/pos/internal/legacySaleCreateAdapter.ts']){
   const s=read(file);
   expect(s).toContain('await confirmStagingDecemberReferral(transaction, { invoiceId: newInvID, clientId, branchId });');
   expect(s.indexOf('await confirmStagingDecemberReferral(transaction')).toBeLessThan(s.indexOf('return { invID: newInvID, invType, targetRecalcScopes }'));
  }
 });
 it('defaults off and enforces isolated DB/login, tenant, branch and payment checks',()=>{
  const s=read('src/lib/campaigns/december-exam/stagingInvoiceReferral.ts');
  for(const marker of ["DECEMBER_EXAM_STAGING_REFERRAL_ENABLED!=='true'","DB_NAME()=N'last132_agent'","SUSER_SNAME()=N'drvo_agent'","Code=N'CASHER_BOOT'","LegacyBranchId=@branch","IdentityVerifiedAtUtc IS NOT NULL","h.GrandTotal>0","h.PayDue=0","invID<>@invoice","Status='PENDING'"])expect(s).toContain(marker);
 });
 it('guards audited edits and voids unredeemed referrals inside deletion',()=>{
  const s=read('src/app/api/sales/[id]/route.ts');
  expect(s).toContain('await guardDecemberInvoiceMutation(transaction, invID);');
  expect(s).toContain("await guardDecemberInvoiceMutation(transaction, invID, 'delete');");
  const hook=read('src/lib/campaigns/december-exam/stagingInvoiceReferral.ts');
  expect(hook.indexOf('if(redeemed.recordset.length)throw')).toBeLessThan(hook.indexOf("SET Status='VOIDED'"));
 });
 it('POS preview stays separate from sale submission',()=>{
  const panel=read('src/components/pos/PosInvoicePanel.tsx');
  expect(panel).toContain('NEXT_PUBLIC_DECEMBER_EXAM_POS_PREVIEW_ENABLED');
  const preview=read('src/app/api/pos/offers/december/preview/route.ts');
  expect(preview).toContain("requirePageAccess('/income/pos')");
  expect(preview).toContain('previewOnly:true');
  expect(preview).not.toMatch(/UPDATE dbo|INSERT dbo|DELETE FROM dbo/);
 });
});
