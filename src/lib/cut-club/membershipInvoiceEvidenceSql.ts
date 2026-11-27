import 'server-only';
import sql from 'mssql';
import {pilotTenant} from './membershipDraft';
import {matchesPersistedInvoice,validInvoiceEvidence,type InvoiceEvidence,type PersistedInvoice} from './membershipInvoiceEvidence';
type Scope={tenantId:string;staffId:number;branchId:number};
export class InvoiceEvidenceError extends Error{constructor(public code:string){super(code);}}
const fail=(code:string):never=>{throw new InvoiceEvidenceError(code);};
const minor=(n:number)=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n*100-Math.round(n*100))<0.00001?Math.round(n*100):NaN;
async function gate(tx:sql.Transaction,s:Scope){
 if(s.tenantId.toLowerCase()!==pilotTenant||!Number.isSafeInteger(s.staffId)||s.staffId<=0||![1,3].includes(s.branchId)||process.env.CUT_CLUB_STAGING_MEMBERSHIP_INVOICE_EVIDENCE_ENABLED!=='true')fail('INVOICE_EVIDENCE_NOT_RELEASED');
 const g=await new sql.Request(tx).input('tenant',sql.UniqueIdentifier,s.tenantId).query<{Ready:number}>(`SELECT CASE WHEN DB_NAME()='last132_agent' AND SUSER_SNAME()='drvo_agent' AND @@TRANCOUNT>0 AND OBJECT_ID(N'dbo.CutClubMembershipInvoiceEvidenceVoid',N'U') IS NOT NULL AND EXISTS(SELECT 1 FROM dbo.Tenant WHERE TenantId=@tenant AND Code='CASHER_BOOT' AND Status='active') THEN 1 ELSE 0 END AS Ready`);
 if(g.recordset[0]?.Ready!==1)fail('INVOICE_EVIDENCE_NOT_RELEASED');
}
/** Called only by a trusted transaction owner, after invoice and payment rows exist.
 *  This evidence does not authorize a benefit and is never counted by the simulation ledger.
 */
export async function recordMembershipInvoiceEvidence(tx:sql.Transaction,s:Scope,e:InvoiceEvidence){
 if(!validInvoiceEvidence(e)||e.branchId!==s.branchId)fail('INVALID_INVOICE_EVIDENCE');
 await gate(tx,s);
 const q=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,s.tenantId).input('invoice',sql.Int,e.invoiceId);
 const existing=await q().query(`SELECT InvoiceID FROM dbo.CutClubMembershipInvoiceEvidence WITH(UPDLOCK,HOLDLOCK) WHERE TenantId=@tenant AND InvoiceID=@invoice`);
 if(existing.recordset.length)fail('INVOICE_ALREADY_BOUND');
 const h=await q().query<{ClientID:number;BranchID:number;BusinessDayID:number;ShiftMoveID:number;UserID:number;SubTotal:number;GrandTotal:number;DisVal:number;Dis:number;TaxVal:number;Tax:number;Payment:number;PayDue:number}>(`
 SELECT h.ClientID,h.BranchID,h.BusinessDayID,h.ShiftMoveID,h.UserID,h.SubTotal,h.GrandTotal,h.DisVal,h.Dis,h.TaxVal,h.Tax,h.Payment,h.PayDue FROM dbo.TblinvServHead h WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.TblClient c WITH(HOLDLOCK) ON c.ClientID=h.ClientID AND c.TenantId=@tenant WHERE h.invID=@invoice AND h.invType=N'مبيعات'`);
 const a=h.recordset[0];if(h.recordset.length!==1||!a||a.Dis!==0||a.Tax!==0)throw new InvoiceEvidenceError('INVOICE_NOT_MATCHED');
 const d=await q().query<{ProID:number;Qty:number;SValue:number;DisVal:number;SPriceAfterDis:number}>(`
 SELECT TOP(101) d.ProID,d.Qty,d.SValue,d.DisVal,d.SPriceAfterDis FROM dbo.TblinvServDetail d WITH(HOLDLOCK) JOIN dbo.TblPro p WITH(HOLDLOCK) ON p.ProID=d.ProID AND p.TenantId=@tenant WHERE d.invID=@invoice AND d.invType=N'مبيعات'`);
 const count=await q().query<{N:number}>(`SELECT COUNT(*) AS N FROM dbo.TblinvServDetail WITH(HOLDLOCK) WHERE invID=@invoice AND invType=N'مبيعات'`);
 if(count.recordset[0]?.N!==d.recordset.length)fail('INVOICE_LINE_SCOPE');
 const pay=await q().query<{PayValue:number}>(`SELECT TOP(21) PayValue FROM dbo.TblinvServPayment WITH(HOLDLOCK) WHERE invID=@invoice AND invType=N'مبيعات'`);
 const persisted:PersistedInvoice={clientId:a.ClientID,branchId:a.BranchID,businessDayId:a.BusinessDayID,shiftMoveId:a.ShiftMoveID,staffId:a.UserID,grossMinor:minor(a.SubTotal),netMinor:minor(a.GrandTotal),headerDiscountMinor:minor(a.DisVal),taxMinor:minor(a.TaxVal),paymentMinor:minor(a.Payment),dueMinor:minor(a.PayDue),lines:d.recordset.map(l=>({serviceId:l.ProID,units:l.Qty,grossMinor:minor(l.SValue),discountMinor:minor(l.DisVal),netMinor:minor(l.SPriceAfterDis)})),payments:pay.recordset.map(r=>minor(r.PayValue))};
 if(!matchesPersistedInvoice(e,persisted,s.staffId))fail('INVOICE_NOT_MATCHED');
 // Evidence must reference an existing application-issued trial and approval for the same program revision.
 const pins=await q().input('account',sql.UniqueIdentifier,e.accountId).input('code',sql.VarChar(40),e.programCode).input('trial',sql.Int,e.trialRevision).input('approval',sql.Int,e.approvalRevision).input('client',sql.Int,e.clientId).input('branch',sql.Int,e.branchId).query<{Ready:number}>(`
 SELECT CASE WHEN EXISTS(SELECT 1 FROM dbo.CutClubMembershipTrial t WITH(HOLDLOCK)
 JOIN dbo.CutClubMembershipApplicationFulfillment f WITH(HOLDLOCK) ON f.TenantId=t.TenantId AND f.AccountID=t.AccountID AND f.ProgramCode=t.ProgramCode AND f.TrialRevision=t.Revision
 JOIN dbo.CutClubMembershipApplication x WITH(HOLDLOCK) ON x.TenantId=f.TenantId AND x.ApplicationID=f.ApplicationID AND x.AccountID=t.AccountID AND x.LegacyClientID=t.LegacyClientID AND x.ProgramCode=t.ProgramCode AND x.BranchID=t.BranchID
 JOIN dbo.CutClubMembershipBenefitApproval b WITH(HOLDLOCK) ON b.TenantId=t.TenantId AND b.ProgramCode=t.ProgramCode AND b.ProgramRevision=t.ProgramRevision AND b.PublicationRevision=x.PublicationRevision
 WHERE t.TenantId=@tenant AND t.AccountID=@account AND t.ProgramCode=@code AND t.Revision=@trial AND t.LegacyClientID=@client AND t.BranchID=@branch AND b.Revision=@approval AND b.Action='APPROVE') THEN 1 ELSE 0 END AS Ready`);
 if(pins.recordset[0]?.Ready!==1)fail('INVOICE_PINS_NOT_MATCHED');
 const w=await q().input('account',sql.UniqueIdentifier,e.accountId).input('code',sql.VarChar(40),e.programCode).input('trial',sql.Int,e.trialRevision).input('approval',sql.Int,e.approvalRevision).input('client',sql.Int,e.clientId).input('branch',sql.Int,e.branchId).input('day',sql.Int,e.businessDayId).input('shift',sql.Int,e.shiftMoveId).input('service',sql.Int,e.serviceId).input('units',sql.Int,e.units).input('gross',sql.BigInt,e.lineGrossMinor).input('discount',sql.BigInt,e.lineDiscountMinor).input('net',sql.BigInt,e.lineNetMinor).input('invoiceGross',sql.BigInt,e.invoiceGrossMinor).input('invoiceNet',sql.BigInt,e.invoiceNetMinor).input('staff',sql.Int,s.staffId).query(`
 INSERT dbo.CutClubMembershipInvoiceEvidence(TenantId,InvoiceID,AccountID,ProgramCode,TrialRevision,ApprovalRevision,ClientID,BranchID,BusinessDayID,ShiftMoveID,ServiceID,Units,LineGrossMinor,LineDiscountMinor,LineNetMinor,InvoiceGrossMinor,InvoiceNetMinor,StaffID)
 VALUES(@tenant,@invoice,@account,@code,@trial,@approval,@client,@branch,@day,@shift,@service,@units,@gross,@discount,@net,@invoiceGross,@invoiceNet,@staff)`);
 if(w.rowsAffected[0]!==1)fail('INVOICE_EVIDENCE_WRITE_FAILED');
 return {invoiceId:e.invoiceId,evidenceOnly:true as const};
}
/** Caller must own the authorized invoice cancellation transaction; no invoice deletion here. */
export async function recordMembershipInvoiceEvidenceVoid(tx:sql.Transaction,s:Scope,invoiceId:number,reason:string){
 if(!Number.isSafeInteger(invoiceId)||invoiceId<1||invoiceId>2147483647||typeof reason!=='string'||reason.trim().length<5||reason.trim().length>300)fail('INVALID_VOID_EVIDENCE');
 await gate(tx,s);
 const q=()=>new sql.Request(tx).input('tenant',sql.UniqueIdentifier,s.tenantId).input('invoice',sql.Int,invoiceId);
 const row=await q().query<{BranchID:number;Voided:number}>(`SELECT e.BranchID,CASE WHEN v.InvoiceID IS NULL THEN 0 ELSE 1 END AS Voided FROM dbo.CutClubMembershipInvoiceEvidence e WITH(UPDLOCK,HOLDLOCK) LEFT JOIN dbo.CutClubMembershipInvoiceEvidenceVoid v WITH(HOLDLOCK) ON v.TenantId=e.TenantId AND v.InvoiceID=e.InvoiceID WHERE e.TenantId=@tenant AND e.InvoiceID=@invoice`);
 const e=row.recordset[0];if(!e||e.BranchID!==s.branchId)throw new InvoiceEvidenceError('INVOICE_EVIDENCE_NOT_FOUND');
 if(e.Voided===1)return {invoiceId,replayed:true,evidenceOnly:true as const};
 const h=await q().query<{N:number}>(`SELECT COUNT(*) AS N FROM dbo.TblinvServHead WITH(HOLDLOCK) WHERE invID=@invoice AND invType=N'مبيعات'`);
 if(h.recordset[0]?.N!==0)fail('INVOICE_STILL_PRESENT');
 const w=await q().input('staff',sql.Int,s.staffId).input('reason',sql.NVarChar(300),reason.trim()).query(`INSERT dbo.CutClubMembershipInvoiceEvidenceVoid(TenantId,InvoiceID,StaffID,Reason) VALUES(@tenant,@invoice,@staff,@reason)`);
 if(w.rowsAffected[0]!==1)fail('INVOICE_VOID_EVIDENCE_FAILED');
 return {invoiceId,replayed:false,evidenceOnly:true as const};
}
