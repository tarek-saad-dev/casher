import fs from 'node:fs';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import {resolveInvoiceTargetRecalculationScope} from '../../../src/lib/payroll/employee-target/employee-target-recalc-scope';

describe('Salon POS sale → employee target integration',()=>{
 it('enqueues the correct employee, branch and date scope from a new sale',()=>{
   const scopes=resolveInvoiceTargetRecalculationScope({
     afterSnapshot:{header:{invDate:'2026-10-26',branchId:101},
       details:[{empId:201},{empId:202},{empId:201}]},
     reasons:['invoice_create'],
   });
   expect(scopes.map(s=>({empId:s.empId,branchId:s.branchId,workDate:s.workDate})))
     .toEqual([{empId:201,branchId:101,workDate:'2026-10-26'},
               {empId:202,branchId:101,workDate:'2026-10-26'}]);
 });
 it('guards the POS adapter against omitting branchId from the enqueue snapshot',()=>{
   const src=fs.readFileSync(path.join(process.cwd(),
     'src/apps/pos/internal/legacySaleCreateAdapter.ts'),'utf8');
   expect(src).toContain('header: { invDate: workDateStr, branchId }');
   expect(src).toContain('enqueueTargetRecalcFromInvoiceSnapshots({');
   expect(src).toContain('transaction,');
   expect(src).toContain('POS_TARGET_RECALC_SCOPE_MISSING');
   expect(src).toContain('targetRecalcScopes.length === 0');
   expect(src.indexOf('POS_TARGET_RECALC_SCOPE_MISSING')).toBeLessThan(src.indexOf('return { invID: newInvID, invType, targetRecalcScopes }'));
 });
});