import {describe,it,expect} from 'vitest';
import {matchesPersistedInvoice,type InvoiceEvidence,type PersistedInvoice} from '@/lib/cut-club/membershipInvoiceEvidence';
const e:InvoiceEvidence={invoiceId:90001,accountId:'22222222-2222-4222-8222-222222222222',programCode:'EVIDENCE_SQL',trialRevision:1,approvalRevision:1,clientId:7,branchId:1,businessDayId:4,shiftMoveId:5,serviceId:9,units:1,lineGrossMinor:20001,lineDiscountMinor:2000,lineNetMinor:18001,invoiceGrossMinor:25001,invoiceNetMinor:23001};
const i:PersistedInvoice={clientId:7,branchId:1,businessDayId:4,shiftMoveId:5,staffId:71,grossMinor:25001,netMinor:23001,headerDiscountMinor:0,taxMinor:0,paymentMinor:23001,dueMinor:0,lines:[{serviceId:9,units:1,grossMinor:20001,discountMinor:2000,netMinor:18001},{serviceId:39,units:1,grossMinor:5000,discountMinor:0,netMinor:5000}],payments:[10000,13001]};
describe('membership invoice evidence',()=>{
 it('matches the paid persisted invoice',()=>expect(matchesPersistedInvoice(e,i,71)).toBe(true));
 it('rejects inconsistent client, branch, shift, staff, discounts, lines or payments',()=>{
 for(const patch of [{clientId:8},{branchId:3},{shiftMoveId:6},{staffId:72},{headerDiscountMinor:1},{taxMinor:1},{paymentMinor:23000},{payments:[23000]},{dueMinor:1},{lines:[...i.lines,i.lines[0]!]},{lines:[{...i.lines[0]!,discountMinor:1999},i.lines[1]!]}])expect(matchesPersistedInvoice(e,{...i,...patch},71)).toBe(false);
 expect(matchesPersistedInvoice({...e,lineDiscountMinor:0},i,71)).toBe(false);
 });
});
