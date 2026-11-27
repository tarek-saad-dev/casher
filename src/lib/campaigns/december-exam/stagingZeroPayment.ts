import 'server-only';
import type {Transaction} from 'mssql';
import {sql} from '@/lib/db';
import {DecemberCheckoutError} from './stagingCheckout';

/** Free invoices are a distinct staging financial path, not a zero cash sale.
 * No fake payment method is accepted from the browser. */
export async function requireStagingZeroPayment(tx:Transaction){
 if(process.env.DECEMBER_EXAM_STAGING_ZERO_PAYMENT_ENABLED!=='true')
  throw new DecemberCheckoutError('DECEMBER_ZERO_PAYMENT_NOT_READY');
 const id=Number(process.env.DECEMBER_EXAM_ZERO_PAYMENT_METHOD_ID);
 if(!Number.isSafeInteger(id)||id<=0||id>2147483647)throw new DecemberCheckoutError('DECEMBER_ZERO_PAYMENT_NOT_READY');
 const r=await new sql.Request(tx).input('id',sql.Int,id).query<{ok:number}>(`
 SELECT CASE WHEN DB_NAME()=N'last132_agent' AND SUSER_SNAME()=N'drvo_agent'
 AND OBJECT_DEFINITION(OBJECT_ID(N'dbo.InsCashMoveSales')) LIKE N'%DECEMBER_ZERO_PAYMENT_STAGING_GUARD%'
 AND EXISTS(SELECT 1 FROM dbo.TblPaymentMethods WHERE PaymentID=@id AND PaymentMethod=N'بدون تحصيل - عرض ديسمبر')
 THEN 1 ELSE 0 END AS ok
 `);
 if(r.recordset[0]?.ok!==1)throw new DecemberCheckoutError('DECEMBER_ZERO_PAYMENT_NOT_READY');
 return id;
}
export async function assertNoZeroInvoiceCash(tx:Transaction,invoiceId:number){
 const r=await new sql.Request(tx).input('invoice',sql.Int,invoiceId).query<{ok:number}>(`
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM dbo.TblCashMove WHERE invID=@invoice AND invType=N'مبيعات')
 AND NOT EXISTS(SELECT 1 FROM dbo.TblinvServPayment WHERE invID=@invoice AND invType=N'مبيعات')
 THEN 1 ELSE 0 END AS ok
 `);
 if(r.recordset[0]?.ok!==1)throw new DecemberCheckoutError('DECEMBER_ZERO_PAYMENT_SIDE_EFFECT');
}
