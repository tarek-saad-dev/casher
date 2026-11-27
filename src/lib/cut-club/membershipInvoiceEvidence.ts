/** Internal-only reconciliation of persisted invoice data; never a discount grant. */
export type InvoiceEvidence={invoiceId:number;accountId:string;programCode:string;trialRevision:number;approvalRevision:number;clientId:number;branchId:1|3;businessDayId:number;shiftMoveId:number;serviceId:number;units:number;lineGrossMinor:number;lineDiscountMinor:number;lineNetMinor:number;invoiceGrossMinor:number;invoiceNetMinor:number};
export type PersistedInvoice={clientId:number;branchId:number;businessDayId:number;shiftMoveId:number;staffId:number;grossMinor:number;netMinor:number;headerDiscountMinor:number;taxMinor:number;paymentMinor:number;dueMinor:number;lines:readonly {serviceId:number;units:number;grossMinor:number;discountMinor:number;netMinor:number}[];payments:readonly number[]};
const int=(v:number,min:number,max:number)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const id=(n:number)=>int(n,1,2147483647);
const money=(n:number)=>int(n,0,9999999999);
export function validInvoiceEvidence(e:InvoiceEvidence):boolean{
 return [e.invoiceId,e.trialRevision,e.approvalRevision,e.clientId,e.businessDayId,e.shiftMoveId,e.serviceId].every(id)&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(e.accountId)&&/^[A-Z0-9_-]{1,40}$/.test(e.programCode)&&(e.branchId===1||e.branchId===3)&&int(e.units,1,100)&&[e.lineGrossMinor,e.lineDiscountMinor,e.lineNetMinor,e.invoiceGrossMinor,e.invoiceNetMinor].every(money)&&e.lineDiscountMinor>0&&e.lineGrossMinor===e.lineDiscountMinor+e.lineNetMinor&&e.invoiceGrossMinor>=e.lineGrossMinor&&e.invoiceNetMinor>0&&e.invoiceNetMinor===e.invoiceGrossMinor-e.lineDiscountMinor;
}
export function matchesPersistedInvoice(e:InvoiceEvidence,i:PersistedInvoice,staffId:number):boolean{
 if(!validInvoiceEvidence(e)||!id(staffId)||i.staffId!==staffId||i.clientId!==e.clientId||i.branchId!==e.branchId||i.businessDayId!==e.businessDayId||i.shiftMoveId!==e.shiftMoveId||i.grossMinor!==e.invoiceGrossMinor||i.netMinor!==e.invoiceNetMinor||i.headerDiscountMinor!==0||i.taxMinor!==0||i.dueMinor!==0||i.paymentMinor!==e.invoiceNetMinor||i.lines.length<1||i.lines.length>100||i.payments.length<1||i.payments.length>20||!i.payments.every(n=>money(n)&&n>0)||i.payments.reduce((a,b)=>a+b,0)!==e.invoiceNetMinor)return false;
 if(i.lines.some(l=>!id(l.serviceId)||!int(l.units,1,100)||![l.grossMinor,l.discountMinor,l.netMinor].every(money)||l.grossMinor<=0||l.grossMinor!==l.discountMinor+l.netMinor))return false;
 const target=i.lines.filter(l=>l.serviceId===e.serviceId);
 return target.length===1&&target[0]!.units===e.units&&target[0]!.grossMinor===e.lineGrossMinor&&target[0]!.discountMinor===e.lineDiscountMinor&&target[0]!.netMinor===e.lineNetMinor&&i.lines.every(l=>l.serviceId===e.serviceId||l.discountMinor===0)&&i.lines.reduce((sum,l)=>sum+l.grossMinor,0)===e.invoiceGrossMinor&&i.lines.reduce((sum,l)=>sum+l.netMinor,0)===e.invoiceNetMinor;
}
