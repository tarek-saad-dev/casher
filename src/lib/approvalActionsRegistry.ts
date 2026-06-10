// ── Approval Actions Registry ─────────────────────────────────────────────────
// Each entry defines HOW to execute a sensitive action when super_admin approves.
// This is the ONLY place where execution logic for approvals is defined.
// Never replay raw HTTP requests — always use these typed executors.

import { getPool } from '@/lib/db';
import sql from 'mssql';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ActionContext {
  entityId: string | null;
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
}

export interface ActionDefinition {
  label: string;             // human-readable Arabic label
  entityType: string;        // DB table name
  riskLevel: RiskLevel;
  execute: (ctx: ActionContext) => Promise<void>;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const APPROVAL_ACTIONS: Record<string, ActionDefinition> = {

  // 1. Delete cash movement (TblCashMove)
  delete_cash_move: {
    label: 'حذف حركة خزنة',
    entityType: 'TblCashMove',
    riskLevel: 'high',
    async execute({ entityId }) {
      if (!entityId) throw new Error('entityId مطلوب لحذف حركة الخزنة');
      const db = await getPool();
      await db.request()
        .input('id', sql.Int, parseInt(entityId))
        .query(`DELETE FROM dbo.TblCashMove WHERE ID = @id`);
    },
  },

  // 2. Delete sale invoice (TblInvServHead + TblCashMove)
  delete_invoice: {
    label: 'حذف فاتورة مبيعات',
    entityType: 'TblinvServHead',
    riskLevel: 'critical',
    async execute({ entityId }) {
      if (!entityId) throw new Error('entityId مطلوب لحذف الفاتورة');
      const invId = parseInt(entityId);
      const db = await getPool();
      const tx = db.transaction();
      await tx.begin();
      try {
        await tx.request().input('id', sql.Int, invId)
          .query(`DELETE FROM dbo.TblCashMove WHERE InvID = @id`);
        await tx.request().input('id', sql.Int, invId)
          .query(`DELETE FROM dbo.TblinvServDet WHERE invID = @id`);
        await tx.request().input('id', sql.Int, invId)
          .query(`DELETE FROM dbo.TblinvServHead WHERE invID = @id`);
        await tx.commit();
      } catch (e) {
        await tx.rollback();
        throw e;
      }
    },
  },

  // 3. Delete expense record
  delete_expense: {
    label: 'حذف مصروف',
    entityType: 'TblCashMove',
    riskLevel: 'high',
    async execute({ entityId }) {
      if (!entityId) throw new Error('entityId مطلوب لحذف المصروف');
      const db = await getPool();
      await db.request()
        .input('id', sql.Int, parseInt(entityId))
        .query(`DELETE FROM dbo.TblCashMove WHERE ID = @id AND InOut = 'out'`);
    },
  },

  // 4. Delete income / revenue record
  delete_income: {
    label: 'حذف إيراد',
    entityType: 'TblCashMove',
    riskLevel: 'high',
    async execute({ entityId }) {
      if (!entityId) throw new Error('entityId مطلوب لحذف الإيراد');
      const db = await getPool();
      await db.request()
        .input('id', sql.Int, parseInt(entityId))
        .query(`DELETE FROM dbo.TblCashMove WHERE ID = @id AND InOut = 'in'`);
    },
  },

  // 5. Close day (reconciliation / day lock)
  close_day: {
    label: 'تقفيل اليوم',
    entityType: 'TblNewDay',
    riskLevel: 'critical',
    async execute({ entityId, newData }) {
      if (!entityId) throw new Error('entityId (newDay) مطلوب لتقفيل اليوم');
      const db = await getPool();
      await db.request()
        .input('id', sql.Int, parseInt(entityId))
        .query(`UPDATE dbo.TblNewDay SET Status = 0 WHERE ID = @id`);
      // reconciliation rows from newData if provided
      if (newData?.reconciliations && Array.isArray(newData.reconciliations)) {
        for (const r of newData.reconciliations as Array<{ paymentMethodId: number; counted: number; shiftMoveId?: number }>) {
          await db.request()
            .input('day',   sql.Int,   parseInt(entityId))
            .input('pm',    sql.Int,   r.paymentMethodId)
            .input('count', sql.Decimal(18,2), r.counted)
            .input('shift', sql.Int,   r.shiftMoveId ?? null)
            .query(`
              MERGE dbo.TblTreasuryReconciliation AS t
              USING (SELECT @day AS D, @pm AS P, @shift AS S) AS s ON t.NewDay=s.D AND t.PaymentMethodID=s.P AND (t.ShiftMoveID=s.S OR (t.ShiftMoveID IS NULL AND s.S IS NULL))
              WHEN MATCHED THEN UPDATE SET CountedAmount=@count
              WHEN NOT MATCHED THEN INSERT (NewDay,PaymentMethodID,ShiftMoveID,CountedAmount) VALUES (@day,@pm,@shift,@count);
            `);
        }
      }
    },
  },

  // 6. Treasury transfer (past date)
  treasury_transfer: {
    label: 'تحويل في الخزنة',
    entityType: 'TblCashMove',
    riskLevel: 'high',
    async execute({ newData }) {
      if (!newData) throw new Error('newData مطلوب للتحويل');
      const { amount, fromPaymentMethodId, toPaymentMethodId, notes, transferDate, userId, shiftMoveId } = newData as Record<string, unknown>;
      const db = await getPool();
      const tx = db.transaction();
      await tx.begin();
      try {
        const req1 = tx.request();
        req1.input('pm',    sql.Int,         fromPaymentMethodId as number);
        req1.input('amt',   sql.Decimal(18,2), amount as number);
        req1.input('notes', sql.NVarChar,    (notes as string) ?? '');
        req1.input('date',  sql.Date,        new Date(transferDate as string));
        req1.input('uid',   sql.Int,         userId as number);
        req1.input('sid',   sql.Int,         shiftMoveId as number ?? null);
        await req1.query(`INSERT INTO dbo.TblCashMove (PaymentMethodID,Amount,InOut,Notes,InvDate,UserID,ShiftMoveID,InvType) VALUES (@pm,@amt,'out',@notes,@date,@uid,@sid,'تحويل')`);

        const req2 = tx.request();
        req2.input('pm',    sql.Int,         toPaymentMethodId as number);
        req2.input('amt',   sql.Decimal(18,2), amount as number);
        req2.input('notes', sql.NVarChar,    (notes as string) ?? '');
        req2.input('date',  sql.Date,        new Date(transferDate as string));
        req2.input('uid',   sql.Int,         userId as number);
        req2.input('sid',   sql.Int,         shiftMoveId as number ?? null);
        await req2.query(`INSERT INTO dbo.TblCashMove (PaymentMethodID,Amount,InOut,Notes,InvDate,UserID,ShiftMoveID,InvType) VALUES (@pm,@amt,'in',@notes,@date,@uid,@sid,'تحويل')`);

        await tx.commit();
      } catch (e) {
        await tx.rollback();
        throw e;
      }
    },
  },

  // 7. Update user roles (permissions)
  update_user_roles: {
    label: 'تعديل صلاحيات مستخدم',
    entityType: 'TblUserRoles',
    riskLevel: 'critical',
    async execute({ entityId, newData }) {
      if (!entityId || !newData?.roles) throw new Error('entityId و roles مطلوبان');
      const userId = parseInt(entityId);
      const roles = newData.roles as number[];
      const db = await getPool();
      const tx = db.transaction();
      await tx.begin();
      try {
        await tx.request().input('uid', sql.Int, userId)
          .query(`DELETE FROM dbo.TblUserRoles WHERE UserID = @uid`);
        for (const rid of roles) {
          await tx.request()
            .input('uid', sql.Int, userId)
            .input('rid', sql.Int, rid)
            .query(`INSERT INTO dbo.TblUserRoles (UserID, RoleID) VALUES (@uid, @rid)`);
        }
        await tx.commit();
      } catch (e) {
        await tx.rollback();
        throw e;
      }
    },
  },

  // 8. Update page access mode / roles
  update_page_access: {
    label: 'تعديل صلاحيات صفحة',
    entityType: 'TblSystemPages',
    riskLevel: 'critical',
    async execute({ entityId, newData }) {
      if (!entityId || !newData) throw new Error('entityId و newData مطلوبان');
      const pageId = parseInt(entityId);
      const db = await getPool();
      if (newData.accessMode) {
        await db.request()
          .input('mode', sql.NVarChar, newData.accessMode as string)
          .input('pid',  sql.Int,      pageId)
          .query(`UPDATE dbo.TblSystemPages SET AccessMode=@mode WHERE PageID=@pid`);
      }
      if (Array.isArray(newData.roles)) {
        await db.request().input('pid', sql.Int, pageId)
          .query(`DELETE FROM dbo.TblPageRoleAccess WHERE PageID=@pid`);
        for (const rid of newData.roles as number[]) {
          await db.request()
            .input('pid', sql.Int, pageId)
            .input('rid', sql.Int, rid)
            .query(`INSERT INTO dbo.TblPageRoleAccess (PageID,RoleID,CanView,CanEdit,CanDelete) VALUES (@pid,@rid,1,0,0)`);
        }
      }
    },
  },
  // 9. Edit income / revenue record
  edit_income: {
    label: 'تعديل إيراد',
    entityType: 'TblCashMove',
    riskLevel: 'high',
    async execute({ entityId, newData }) {
      if (!entityId || !newData) throw new Error('entityId و newData مطلوبان لتعديل الإيراد');
      const id = parseInt(entityId);
      const d = newData as Record<string, unknown>;
      const db = await getPool();
      await db.request()
        .input('id',    sql.Int,            id)
        .input('date',  sql.Date,           new Date(d.invDate as string))
        .input('expIn', sql.Int,            Number(d.expInId))
        .input('amt',   sql.Decimal(10, 2), Number(d.amount))
        .input('notes', sql.NVarChar(sql.MAX), (d.notes as string) ?? null)
        .input('pm',    sql.Int,            Number(d.paymentMethodId))
        .query(`
          UPDATE dbo.TblCashMove
          SET invDate=@date, ExpINID=@expIn, GrandTolal=@amt, Notes=@notes, PaymentMethodID=@pm
          WHERE ID=@id AND invType=N'ايرادات'
        `);
    },
  },

  // 10. Edit expense record
  edit_expense: {
    label: 'تعديل مصروف',
    entityType: 'TblCashMove',
    riskLevel: 'high',
    async execute({ entityId, newData }) {
      if (!entityId || !newData) throw new Error('entityId و newData مطلوبان لتعديل المصروف');
      const id = parseInt(entityId);
      const d = newData as Record<string, unknown>;
      const db = await getPool();
      await db.request()
        .input('id',    sql.Int,            id)
        .input('date',  sql.Date,           new Date(d.invDate as string))
        .input('expIn', sql.Int,            Number(d.expInId))
        .input('amt',   sql.Decimal(10, 2), Number(d.amount))
        .input('notes', sql.NVarChar(sql.MAX), (d.notes as string) ?? null)
        .input('pm',    sql.Int,            Number(d.paymentMethodId))
        .query(`
          UPDATE dbo.TblCashMove
          SET invDate=@date, ExpINID=@expIn, GrandTolal=@amt, Notes=@notes, PaymentMethodID=@pm
          WHERE ID=@id AND invType=N'مصروفات'
        `);
    },
  },

  // 11. Edit sale invoice (update header + details)
  edit_invoice: {
    label: 'تعديل فاتورة مبيعات',
    entityType: 'TblinvServHead',
    riskLevel: 'high',
    async execute({ entityId, newData }) {
      if (!entityId || !newData) throw new Error('entityId و newData مطلوبان لتعديل الفاتورة');
      const invId = parseInt(entityId);
      const db = await getPool();
      const tx = db.transaction();
      await tx.begin();
      try {
        // Update header
        const h = newData as Record<string, unknown>;
        await tx.request()
          .input('id',    sql.Int,          invId)
          .input('sub',   sql.Decimal(10,2), Number(h.subTotal)        || 0)
          .input('dis',   sql.Decimal(5,2),  Number(h.dis)             || 0)
          .input('disv',  sql.Decimal(10,2), Number(h.disVal)          || 0)
          .input('grand', sql.Decimal(10,2), Number(h.grandTotal)      || 0)
          .input('bonus', sql.Decimal(10,2), Number(h.totalBonus)      || 0)
          .input('cash',  sql.Decimal(10,2), Number(h.payCash)         || 0)
          .input('visa',  sql.Decimal(10,2), Number(h.payVisa)         || 0)
          .input('pm',    sql.Int,           Number(h.paymentMethodId) || 1)
          .input('notes', sql.NVarChar,      String(h.notes || 'مبيعات'))
          .query(`
            UPDATE dbo.TblinvServHead SET
              SubTotal=@sub, Dis=@dis, DisVal=@disv, GrandTotal=@grand,
              TotalBonus=@bonus, PayCash=@cash, PayVisa=@visa,
              PaymentMethodID=@pm, Notes=@notes
            WHERE invID=@id AND invType=N'مبيعات'
          `);
        // Rebuild details
        await tx.request().input('id', sql.Int, invId)
          .query(`DELETE FROM dbo.TblinvServDetail WHERE invID=@id AND invType=N'مبيعات'`);
        if (Array.isArray(h.items)) {
          for (const item of h.items as Array<Record<string, unknown>>) {
            await tx.request()
              .input('id',   sql.Int,         invId)
              .input('sid',  sql.Int,         Number(item.serviceId))
              .input('eid',  sql.Int,         Number(item.employeeId) || null)
              .input('qty',  sql.Int,         Number(item.qty)        || 1)
              .input('pr',   sql.Decimal(10,2), Number(item.price)    || 0)
              .input('disc', sql.Decimal(10,2), Number(item.discount) || 0)
              .input('tot',  sql.Decimal(10,2), Number(item.total)    || 0)
              .query(`
                INSERT INTO dbo.TblinvServDetail (invID,invType,ServiceID,EmployeeID,Qty,Price,Discount,Total)
                VALUES (@id,N'مبيعات',@sid,@eid,@qty,@pr,@disc,@tot)
              `);
          }
        }
        await tx.commit();
      } catch (e) {
        await tx.rollback();
        throw e;
      }
    },
  },
};
