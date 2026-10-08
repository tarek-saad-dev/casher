import 'server-only';

import { getPool, sql } from '@/lib/db';
import { isAppInstalledForBranchTenant } from '@/platform/public';
import {
  CUSTOMER_FIRST_TIME_TEMPLATE_KEY,
  SALE_EMPLOYEE_NOTIFICATION_TEMPLATE_KEY,
  sendSaleCustomerReceipt,
  sendTemplateMessage,
} from '@/modules/messaging';
import { resolveEmployeeWhatsAppPhone } from '@/lib/integrations/whatsapp/payload-builders';
import {
  employeeSaleGroupTotal,
  groupEmployeeSaleDetails,
} from '@/lib/sales/employee-sale-whatsapp';
import type { TargetRecalcScope } from '@/lib/payroll/employee-target/employee-target-recalc-scope';
import type { InvoicePaymentAllocationInput } from './legacySaleRepository';

export type SalePostCommitEffectsInput = {
  invID: number;
  invType: string;
  clientId: number | null;
  userID: number;
  grandTotal: number;
  isSplitPayment: boolean;
  headerPaymentMethodId: number;
  activeAllocations: InvoicePaymentAllocationInput[];
  branchId: number;
  branchName: string;
  targetRecalcScopes: TargetRecalcScope[];
};

export function runSalePostCommitEffects(input: SalePostCommitEffectsInput): void {
  const {
    invID,
    invType,
    clientId,
    userID,
    grandTotal,
    isSplitPayment,
    headerPaymentMethodId,
    activeAllocations,
    branchId,
    branchName,
    targetRecalcScopes,
  } = input;

  if (targetRecalcScopes.length > 0) {
    void import('@/lib/payroll/employee-target/employee-target-invoice-sync').then(
      ({ tryProcessAfterInvoiceCommit }) =>
        tryProcessAfterInvoiceCommit({
          scopes: targetRecalcScopes,
          actorUserId: userID || null,
        }),
    );
  }

  void (async () => {
    // Loyalty tables are global CASHER_BOOT data (DRVO-013 V1): earn only for tenants with Loyalty.
    if (clientId && (await isAppInstalledForBranchTenant(branchId, 'loyalty'))) {
      try {
        const loyaltyDb = await getPool();
        await loyaltyDb.request()
          .input('invID', sql.Int, invID)
          .input('invType', sql.NVarChar(20), invType)
          .input('UserID', sql.Int, userID)
          .query(`
            EXEC [dbo].[sp_Loyalty_EarnPointsFromSale]
              @invID = @invID,
              @invType = @invType,
              @UserID = @UserID
          `);
        console.log(
          `[pos-api]   👑 Loyalty points awarded for ClientID=${clientId}, Invoice=${invID}`,
        );
      } catch (loyaltyErr) {
        console.error(
          `[pos-api]   ⚠️ Loyalty points error (non-critical): ${loyaltyErr instanceof Error ? loyaltyErr.message : loyaltyErr}`,
        );
      }
    }

    if (clientId) {
      try {
        const waDb = await getPool();

        const customerResult = await waDb
          .request()
          .input('waClientId', sql.Int, clientId)
          .query(`
            SELECT [Name], Mobile, Phone
            FROM [dbo].[TblClient]
            WHERE ClientID = @waClientId
          `);

        if (customerResult.recordset.length > 0) {
          const cust = customerResult.recordset[0];
          const phone: string | null = cust.Mobile?.trim() || cust.Phone?.trim() || null;
          const customerName: string = cust.Name?.trim() || 'عميل';

          if (phone) {
            const detailResult = await waDb
              .request()
              .input('waInvID', sql.Int, invID)
              .query(`
                SELECT p.ProName AS ServiceName, e.EmpName AS EmpName
                FROM [dbo].[TblinvServDetail] d
                LEFT JOIN [dbo].[TblPro] p ON d.ProID = p.ProID
                LEFT JOIN [dbo].[TblEmp] e ON d.EmpID = e.EmpID
                WHERE d.invID = @waInvID AND d.invType = N'مبيعات'
              `);

            const serviceNames: string[] = detailResult.recordset
              .map((r: Record<string, unknown>) => r.ServiceName as string)
              .filter(Boolean);
            const employeeNames: string[] = detailResult.recordset
              .map((r: Record<string, unknown>) => r.EmpName as string)
              .filter(Boolean);

            let paymentMethodLabel: string | undefined;
            if (!isSplitPayment) {
              const pmResult = await waDb
                .request()
                .input('waPmId', sql.Int, headerPaymentMethodId)
                .query(`
                  SELECT PaymentMethod FROM [dbo].[TblPaymentMethods]
                  WHERE PaymentID = @waPmId
                `);
              paymentMethodLabel = pmResult.recordset[0]?.PaymentMethod as string | undefined;
            } else {
              const pmIds = activeAllocations.map((a) => a.paymentMethodId).join(',');
              if (pmIds.length > 0) {
                const pmResult = await waDb
                  .request()
                  .query(`
                    SELECT PaymentMethod FROM [dbo].[TblPaymentMethods]
                    WHERE PaymentID IN (${pmIds})
                  `);
                const names = pmResult.recordset.map(
                  (r: Record<string, unknown>) => r.PaymentMethod as string,
                );
                paymentMethodLabel = names.join(' + ');
              }
            }

            const priorInvResult = await waDb
              .request()
              .input('waFirstClientId', sql.Int, clientId)
              .input('waCurrentInvID', sql.Int, invID)
              .query(`
                SELECT COUNT(*) AS cnt
                FROM [dbo].[TblinvServHead]
                WHERE ClientID = @waFirstClientId
                  AND invType = N'مبيعات'
                  AND invID <> @waCurrentInvID
              `);
            const isFirstTime = (priorInvResult.recordset[0]?.cnt as number) === 0;

            await sendSaleCustomerReceipt({
              phone,
              customerName,
              invoiceId: invID,
              total: grandTotal,
              paymentMethod: paymentMethodLabel,
              services: serviceNames,
              employeeNames,
              branchName,
              branchId,
            });

            if (isFirstTime) {
              await sendTemplateMessage({
                templateKey: CUSTOMER_FIRST_TIME_TEMPLATE_KEY,
                recipient: { phone },
                variables: {
                  customerName,
                  branchName,
                },
                metadata: {
                  branchId,
                  invoiceId: invID,
                },
                context: { branchId, language: 'ar' },
              });
            }
          }
        }
      } catch (whatsappErr) {
        console.log(
          `[pos-api]   ⚠️ WhatsApp error (non-critical): ${whatsappErr instanceof Error ? whatsappErr.message : whatsappErr}`,
        );
      }
    }

    try {
      const empWaDb = await getPool();
      const hasWhatsAppCol = await empWaDb.request().query(`
        SELECT 1 AS ok
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'TblEmp' AND COLUMN_NAME = 'WhatsApp'
      `);
      const whatsAppSelect = hasWhatsAppCol.recordset.length > 0
        ? 'e.WhatsApp'
        : 'NULL AS WhatsApp';

      const empDetailResult = await empWaDb
        .request()
        .input('empWaInvID', sql.Int, invID)
        .query(`
          SELECT
            d.ID AS detailId,
            d.EmpID,
            e.EmpName,
            e.Mobile,
            ${whatsAppSelect},
            d.ProID,
            p.ProName AS ServiceName,
            d.SPrice,
            d.Qty,
            d.DisVal,
            d.SValue,
            d.SPriceAfterDis
          FROM [dbo].[TblinvServDetail] d
          INNER JOIN [dbo].[TblEmp] e ON d.EmpID = e.EmpID
          LEFT JOIN [dbo].[TblPro] p ON d.ProID = p.ProID
          WHERE d.invID = @empWaInvID
            AND d.invType = N'مبيعات'
            AND d.EmpID IS NOT NULL
        `);

      const byEmployee = groupEmployeeSaleDetails(
        (empDetailResult.recordset as Array<Record<string, unknown>>).map((row) => ({
          EmpID: Number(row.EmpID),
          EmpName: row.EmpName as string | null,
          WhatsApp: row.WhatsApp as string | null,
          Mobile: row.Mobile as string | null,
          ProID: row.ProID != null ? Number(row.ProID) : null,
          ServiceName: row.ServiceName as string | null,
          detailId: row.detailId != null ? Number(row.detailId) : null,
          SPrice: row.SPrice != null ? Number(row.SPrice) : null,
          Qty: row.Qty != null ? Number(row.Qty) : null,
          DisVal: row.DisVal != null ? Number(row.DisVal) : null,
          SValue: row.SValue != null ? Number(row.SValue) : null,
          SPriceAfterDis: row.SPriceAfterDis != null ? Number(row.SPriceAfterDis) : null,
        })),
        resolveEmployeeWhatsAppPhone,
      );

      const sendJobs: Promise<unknown>[] = [];

      for (const emp of byEmployee.values()) {
        if (emp.services.length === 0) continue;

        if (!emp.phone) {
          console.warn(
            `[pos-api]   ⚠️ Employee WhatsApp skipped: missing phone invoiceId=${invID} empId=${emp.empId} name=${emp.employeeName}`,
          );
          continue;
        }

        const employeeTotal = employeeSaleGroupTotal(emp);
        const servicesLabel = emp.services
          .map((s) => s.serviceName.trim())
          .filter(Boolean)
          .join(', ');

        console.log(
          `[pos-api]   📱 Employee WhatsApp: empId=${emp.empId} ${emp.employeeName} (${emp.phone}) total=${employeeTotal} services=${servicesLabel}`,
        );

        sendJobs.push(
          sendTemplateMessage({
            templateKey: SALE_EMPLOYEE_NOTIFICATION_TEMPLATE_KEY,
            recipient: { phone: emp.phone },
            variables: {
              customerName: emp.employeeName,
              employeeName: emp.employeeName,
              invoiceNumber: `INV-${invID}`,
              services: servicesLabel,
              branchName,
            },
            metadata: {
              branchId,
              invoiceId: invID,
              employeeId: emp.empId,
            },
            context: { branchId, language: 'ar' },
          }),
        );
      }

      if (sendJobs.length > 0) {
        const settled = await Promise.allSettled(sendJobs);
        let sent = 0;
        let failed = 0;
        let notRegistered = 0;
        let queued = 0;

        settled.forEach((result, idx) => {
          if (result.status === 'rejected') {
            failed += 1;
            console.log(
              `[pos-api]   ⚠️ Employee WhatsApp promise rejected #${idx}: ${
                result.reason instanceof Error ? result.reason.message : String(result.reason)
              }`,
            );
            return;
          }

          const empWaResult = result.value as {
            sent?: boolean;
            status?: string;
            reason?: string;
            error?: string;
            messageId?: string;
          };

          if (empWaResult?.sent && empWaResult.status === 'sent') {
            sent += 1;
            console.log(
              `[pos-api]   ✅ Employee WhatsApp sent #${idx} messageId=${empWaResult.messageId ?? 'n/a'}`,
            );
            return;
          }

          const reason = empWaResult?.reason ?? empWaResult?.status ?? 'unknown';
          if (reason === 'not_registered') {
            notRegistered += 1;
          } else if (reason === 'queued') {
            queued += 1;
          } else {
            failed += 1;
          }
          console.log(
            `[pos-api]   ⚠️ Employee WhatsApp ${reason} #${idx}${
              empWaResult?.error ? ` — ${empWaResult.error}` : ''
            }`,
          );
        });

        console.log(
          `[pos-api]   📊 Employee WhatsApp summary invoice=INV-${invID} employees=${sendJobs.length} sent=${sent} failed=${failed} notRegistered=${notRegistered} queued=${queued}`,
        );
      } else if (byEmployee.size === 0) {
        console.log(
          `[pos-api]   ℹ️ Employee WhatsApp skipped: no employees on invoice ${invID}`,
        );
      }
    } catch (employeeWhatsappErr) {
      console.log(
        `[pos-api]   ⚠️ Employee WhatsApp error (non-critical): ${
          employeeWhatsappErr instanceof Error ? employeeWhatsappErr.message : employeeWhatsappErr
        }`,
      );
    }
  })();
}
