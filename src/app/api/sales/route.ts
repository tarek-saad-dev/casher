import { NextRequest, NextResponse } from "next/server";
import { getPool, getUserFriendlyError, sql, allocateInvID } from "@/lib/db";
import { getSession } from "@/lib/session";
import type { CreateSalePayload } from "@/lib/types";
import { resolveSplitPaymentConfig } from "@/lib/clearingMethod";
import { redistributeFromClearing } from "@/lib/splitPaymentService";
import {
  sendSaleWhatsAppMessage,
  sendFirstTimeWhatsAppMessage,
  sendEmployeeSaleWhatsAppMessage,
} from "@/lib/integrations/whatsapp";
import { resolveEmployeeWhatsAppPhone } from "@/lib/integrations/whatsapp/payload-builders";

export const runtime = "nodejs";

// POST /api/sales — Create a new sale (head + details + payment + cash move)
export async function POST(req: NextRequest) {
  try {
    const body: CreateSalePayload = await req.json();

    // Validation
    if (!body.items || body.items.length === 0) {
      return NextResponse.json(
        { error: "يجب إضافة خدمة واحدة على الأقل" },
        { status: 400 },
      );
    }

    // ──── Session enforcement ────
    const sessionUser = await getSession();
    const userID = sessionUser?.UserID ?? 0;

    const db = await getPool();

    // DEBUG: confirm DB
    const dbNameResult = await db.request().query("SELECT DB_NAME() AS dbName");
    const dbName = dbNameResult.recordset[0].dbName;
    console.log(
      `[pos-api] ──── SAVE SALE START ──── DB=${dbName}, UserID=${userID}`,
    );

    // ──── Enforce active branch business day + user shift (Phase 1C) ────
    // Financial rows remain unscoped until Phase 1D; day/shift gating is branch-aware.
    const { resolveBranchDayAndShiftForWrite } = await import(
      '@/lib/branch/operationalGates'
    );
    const gated = await resolveBranchDayAndShiftForWrite(userID);
    if (!gated.ok) return gated.response;
    if (!gated.shift) {
      console.error(
        `[pos-api]   ❌ REJECTED: no active shift for UserID=${userID} branch=${gated.branch.branchCode}`,
      );
      return NextResponse.json(
        { error: "لا يوجد وردية مفتوحة لهذا المستخدم — لا يمكن إنشاء فاتورة" },
        { status: 400 },
      );
    }
    const activeDay = { ID: gated.day.id, NewDay: gated.day.newDay };
    const invDate = gated.day.newDay; // Use business day date, NOT JS Date
    const shiftMoveID = gated.shift.id;
    console.log(
      `[pos-api]   Active Day: ID=${activeDay.ID}, NewDay=${invDate}, Branch=${gated.branch.branchCode}`,
    );
    console.log(
      `[pos-api]   Active Shift: ID=${shiftMoveID}, UserID=${gated.shift.userId} (verified owner)`,
    );

    // ──── Server-side discount validation ────
    const subTotal = Math.max(0, body.subTotal || 0);
    let disPercent = Math.max(0, Math.min(100, body.dis || 0));
    let disVal = Math.max(0, body.disVal || 0);
    if (disVal > subTotal) disVal = subTotal;
    const grandTotal = Math.max(0, subTotal - disVal);

    // ──── Resolve split-payment clearing config early (needed for validation) ────
    const splitCfg = await resolveSplitPaymentConfig(db);

    // ──── Payment allocation validation ────
    const rawAllocations = body.paymentAllocations || [];

    // Reject if client attempts to submit the internal clearing method
    const clientSubmittedClearing = rawAllocations.some(
      (pa) => pa.paymentMethodId === splitCfg.clearingMethodId,
    );
    if (clientSubmittedClearing) {
      return NextResponse.json(
        { error: "طريقة الدفع المختارة غير مسموح بها" },
        { status: 400 },
      );
    }

    // Filter to non-zero, valid allocations — no negatives, no NaN
    const activeAllocations = rawAllocations.filter((pa) => {
      const amt = Number(pa.amount);
      return isFinite(amt) && amt > 0 && Number.isInteger(pa.paymentMethodId * 1);
    });

    if (activeAllocations.length === 0) {
      return NextResponse.json(
        { error: "يجب إدخال مبلغ لطريقة دفع واحدة على الأقل" },
        { status: 400 },
      );
    }

    // Duplicate payment methods check
    const methodIds = activeAllocations.map((pa) => pa.paymentMethodId);
    if (new Set(methodIds).size !== methodIds.length) {
      return NextResponse.json(
        { error: "لا يمكن تكرار طريقة الدفع" },
        { status: 400 },
      );
    }

    // Decimal-safe total comparison (round to 2dp)
    const totalAllocated = Math.round(
      activeAllocations.reduce((sum, pa) => sum + Number(pa.amount), 0) * 100,
    ) / 100;
    const grandTotalRounded = Math.round(grandTotal * 100) / 100;

    if (Math.abs(totalAllocated - grandTotalRounded) > 0.01) {
      console.error(
        `[pos-api]   ❌ REJECTED: payment total mismatch. Allocated=${totalAllocated}, GrandTotal=${grandTotalRounded}`,
      );
      return NextResponse.json(
        {
          error: `إجمالي المدفوع (${totalAllocated.toFixed(2)}) لا يساوي إجمالي الفاتورة (${grandTotalRounded.toFixed(2)})`,
        },
        { status: 400 },
      );
    }

    // Determine if this is truly a mixed (split) payment
    const isSplitPayment = activeAllocations.length > 1;

    // For single payment: use the actual payment method
    // For split payment: use the internal clearing account in the header
    const headerPaymentMethodId = isSplitPayment
      ? splitCfg.clearingMethodId
      : activeAllocations[0].paymentMethodId;

    // PayCash / PayVisa backward-compat fields (best-effort by name lookup)
    const payCash = Math.max(0, body.payCash || 0);
    const payVisa = Math.max(0, body.payVisa || 0);

    console.log(
      `[pos-api]   Discount: dis=${disPercent}%, disVal=${disVal}, subTotal=${subTotal}, grandTotal=${grandTotal}`,
    );
    console.log(
      `[pos-api]   Payment: headerMethodId=${headerPaymentMethodId}, isSplit=${isSplitPayment}, allocations=${activeAllocations.length}`,
    );

    // Format invTime as "HH.mm"
    const now = new Date();
    const invTime = `${String(now.getHours()).padStart(2, "0")}.${String(now.getMinutes()).padStart(2, "0")}`;
    const invType = "مبيعات";
    const notesText = body.notes || "مبيعات";

    // Build PayTime string matching existing format: "YYYY-MM-DD HH:MM:SS AM/PM"
    const payHours = now.getHours();
    const payAmPm = payHours >= 12 ? "PM" : "AM";
    const payH12 = payHours % 12 || 12;
    const payTimeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(payH12).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")} ${payAmPm}`;

    // Begin serializable transaction
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    console.log(`[pos-api]   Transaction started (SERIALIZABLE)`);

    try {
      // ──── 1. Allocate invID safely (no TABLOCKX) ────
      const newInvID = await allocateInvID(transaction, 'TblinvServHead', 'مبيعات', 5000);
      console.log(`[pos-api]   Generated invID=${newInvID} for invType=مبيعات`);

      // ──── 2. Insert TblinvServHead ────
      const headReq = new sql.Request(transaction);
      headReq
        .input("invID", sql.Int, newInvID)
        .input("invType", sql.NVarChar(20), invType)
        .input("invDate", sql.Date, invDate)
        .input("invTime", sql.NVarChar(50), invTime)
        .input("ClientID", sql.Int, body.clientId || null)
        .input("UserID", sql.Int, userID)
        .input("TotalQty", sql.Decimal(10, 2), body.totalQty)
        .input("SubTotal", sql.Decimal(10, 2), subTotal)
        .input("Dis", sql.Decimal(6, 2), disPercent)
        .input("DisVal", sql.Decimal(10, 2), disVal)
        .input("Tax", sql.Decimal(6, 2), 0)
        .input("TaxVal", sql.Decimal(10, 2), 0)
        .input("GrandTotal", sql.Decimal(10, 2), grandTotal)
        .input("invNotes", sql.NVarChar(50), notesText.substring(0, 50))
        .input("TotalBonus", sql.Decimal(10, 2), body.totalBonus)
        .input("ShiftMoveID", sql.Int, shiftMoveID)
        .input("Notes", sql.NVarChar(100), notesText.substring(0, 100))
        .input("isActive", sql.NVarChar(5), "no")
        .input("Notes2", sql.NVarChar(sql.MAX), "")
        .input("Payment", sql.Decimal(10, 2), grandTotal)
        .input("PayDue", sql.Decimal(10, 2), 0)
        .input("PayCash", sql.Decimal(10, 2), payCash)
        .input("PayVisa", sql.Decimal(10, 2), payVisa)
        .input("PaymentMethodID", sql.Int, headerPaymentMethodId);

      await headReq.query(`
        INSERT INTO [dbo].[TblinvServHead] (
          invID, invType, invDate, invTime, ClientID, UserID,
          TotalQty, SubTotal, Dis, DisVal, Tax, TaxVal, GrandTotal,
          invNotes, TotalBonus, ShiftMoveID,
          ReservDate, ReservTime, Notes,
          PayCash, PayVisa, isActive, Notes2, Payment, PayDue, PaymentMethodID
        ) VALUES (
          @invID, @invType, @invDate, @invTime, @ClientID, @UserID,
          @TotalQty, @SubTotal, @Dis, @DisVal, @Tax, @TaxVal, @GrandTotal,
          @invNotes, @TotalBonus, @ShiftMoveID,
          NULL, NULL, @Notes,
          @PayCash, @PayVisa, @isActive, @Notes2, @Payment, @PayDue, @PaymentMethodID
        )
      `);
      console.log(
        `[pos-api]   ✅ TblinvServHead inserted: invID=${newInvID}, ClientID=${body.clientId || "NULL"}, GrandTotal=${grandTotal}, PaymentMethodID=${headerPaymentMethodId} (${isSplitPayment ? 'CLEARING' : 'DIRECT'}), UserID=${userID}`,
      );

      // ──── 3. Insert TblinvServDetail rows ────
      let detailCount = 0;
      for (let i = 0; i < body.items.length; i++) {
        const item = body.items[i];
        const detReq = new sql.Request(transaction);
        detReq
          .input("invID", sql.Int, newInvID)
          .input("invType", sql.NVarChar(20), invType)
          .input("EmpID", sql.Int, item.empId)
          .input("ProID", sql.Int, item.proId)
          .input("Dis", sql.Decimal(8, 2), item.dis)
          .input("DisVal", sql.Decimal(8, 2), item.disVal)
          .input("SPrice", sql.Decimal(10, 2), item.sPrice)
          .input("SValue", sql.Decimal(10, 2), item.sPrice * item.qty)
          .input("SPriceAfterDis", sql.Decimal(10, 2), item.sPriceAfterDis)
          .input("PPrice", sql.Decimal(10, 2), 0)
          .input("PValue", sql.Decimal(10, 2), 0)
          .input("Qty", sql.Decimal(8, 2), item.qty)
          .input("Notes", sql.NVarChar(50), (item.notes || "").substring(0, 50))
          .input("Bonus", sql.Decimal(8, 2), item.bonus)
          .input("ReservDate", sql.Date, null);

        await detReq.query(`
          INSERT INTO [dbo].[TblinvServDetail] (
            invID, invType, EmpID, ProID,
            Dis, DisVal, SPrice, SValue, SPriceAfterDis,
            PPrice, PValue, Qty, ProType, Notes, Bonus, ReservDate
          ) VALUES (
            @invID, @invType, @EmpID, @ProID,
            @Dis, @DisVal, @SPrice, @SValue, @SPriceAfterDis,
            @PPrice, @PValue, @Qty, NULL, @Notes, @Bonus, @ReservDate
          )
        `);
        detailCount++;
      }
      console.log(
        `[pos-api]   ✅ TblinvServDetail inserted: ${detailCount} row(s)`,
      );

      // ──── 4. Insert TblinvServPayment (one row per real payment method) ────
      // Single payment: one row for the real method.
      // Mixed payment: one row per real allocation — do NOT insert the clearing method here.
      // Idempotency guard: skip if rows already exist for this invoice.
      const existingPayRows = await new sql.Request(transaction)
        .input("chkInvID", sql.Int, newInvID)
        .input("chkInvType", sql.NVarChar(20), invType)
        .query(`
          SELECT COUNT(*) AS cnt FROM [dbo].[TblinvServPayment]
          WHERE invID = @chkInvID AND invType = @chkInvType
        `);
      if (existingPayRows.recordset[0].cnt === 0) {
        for (const alloc of activeAllocations) {
          const payReq = new sql.Request(transaction);
          payReq
            .input("invID", sql.Int, newInvID)
            .input("invType", sql.NVarChar(20), invType)
            .input("PayDate", sql.Date, invDate)
            .input("PayTime", sql.NVarChar(50), payTimeStr)
            .input("PayValue", sql.Decimal(10, 2), Number(alloc.amount))
            .input("Notes", sql.NVarChar(4000), notesText.substring(0, 4000))
            .input("PaymentMethodID", sql.Int, alloc.paymentMethodId)
            .input("ShiftMoveID", sql.Int, shiftMoveID);

          await payReq.query(`
            INSERT INTO [dbo].[TblinvServPayment] (
              invID, invType, PayDate, PayTime, PayValue, Notes, PaymentMethodID, ShiftMoveID
            ) VALUES (
              @invID, @invType, @PayDate, @PayTime, @PayValue, @Notes, @PaymentMethodID, @ShiftMoveID
            )
          `);
          console.log(
            `[pos-api]   ✅ TblinvServPayment inserted: PayValue=${alloc.amount}, PaymentMethodID=${alloc.paymentMethodId}`,
          );
        }
      } else {
        console.log(`[pos-api]   ⚠️  TblinvServPayment rows already exist for invID=${newInvID} — skipping (idempotency)`);
      }

      // ──── 5. TblCashMove initial entry: handled by trigger [InsCashMoveSales] ────
      // For single payment: trigger creates one 'in' row for the actual payment method.
      // For mixed payment: trigger creates one 'in' row for the clearing account.
      // Do NOT manually insert here — the trigger is the single code path.
      console.log(
        `[pos-api]   ℹ️  TblCashMove initial entry created by trigger InsCashMoveSales (paymentMethodId=${headerPaymentMethodId})`,
      );

      // ──── 5b. Mixed payment redistribution: clearing → each real method ────
      if (isSplitPayment) {
        console.log(`[pos-api]   � Redistributing clearing account to real payment methods...`);

        // Idempotency guard: skip if split transfer rows already exist
        const existingSplitTransfers = await new sql.Request(transaction)
          .input("chkInvID2", sql.Int, newInvID)
          .input("chkCatId", sql.Int, splitCfg.expenseCatId)
          .query(`
            SELECT COUNT(*) AS cnt FROM [dbo].[TblCashMove]
            WHERE ExpINID = @chkCatId
              AND Notes LIKE N'%فاتورة ' + CAST(@chkInvID2 AS NVARCHAR) + N'%'
          `);
        if (existingSplitTransfers.recordset[0].cnt === 0) {
          await redistributeFromClearing({
            transaction,
            clearingMethodId: splitCfg.clearingMethodId,
            allocations: activeAllocations.map((a) => ({
              paymentMethodId: a.paymentMethodId,
              amount: Number(a.amount),
            })),
            invDate,
            invTime,
            clientId: body.clientId || null,
            shiftMoveId: shiftMoveID,
            invoiceId: newInvID,
            expenseCatId: splitCfg.expenseCatId,
            incomeCatId: splitCfg.incomeCatId,
          });
          console.log(`[pos-api]   ✅ Split payment redistribution complete`);
        } else {
          console.log(`[pos-api]   ⚠️  Split transfers already exist for invID=${newInvID} — skipping (idempotency)`);
        }
      }

      // ──── 5b. Durable target recalc enqueue (same TX as invoice) ────
      let targetRecalcScopes: import('@/lib/payroll/employee-target/employee-target-recalc-scope').TargetRecalcScope[] = [];
      try {
        const { enqueueTargetRecalcFromInvoiceSnapshots } = await import(
          '@/lib/payroll/employee-target/employee-target-invoice-sync'
        );
        const workDateStr = String(invDate).slice(0, 10);
        targetRecalcScopes = await enqueueTargetRecalcFromInvoiceSnapshots({
          transaction,
          beforeSnapshot: null,
          afterSnapshot: {
            header: { invDate: workDateStr },
            details: body.items.map((it) => ({ empId: it.empId })),
          },
          reason: 'invoice_create',
          sourceType: 'TblinvServHead',
          sourceRef: String(newInvID),
        });
      } catch (enqueueErr) {
        console.error(
          '[pos-api] target recalc enqueue failed — rolling back sale:',
          enqueueErr instanceof Error ? enqueueErr.message : enqueueErr,
        );
        throw enqueueErr;
      }

      // ──── 6. Commit ────
      await transaction.commit();
      console.log(
        `[pos-api]   ✅ COMMITTED — invID=${newInvID}, invType=${invType}`,
      );
      console.log(`[pos-api] ──── SAVE SALE COMPLETE ────`);

      if (targetRecalcScopes.length > 0) {
        const { tryProcessAfterInvoiceCommit } = await import(
          '@/lib/payroll/employee-target/employee-target-invoice-sync'
        );
        void tryProcessAfterInvoiceCommit({
          scopes: targetRecalcScopes,
          actorUserId: userID || null,
        });
      }

      // ──── 7 & 8. Loyalty + WhatsApp — fully async, do NOT block the response ────
      void (async () => {
        // ── 7. Loyalty Points Earning (CUT CLUB) ──
        if (body.clientId) {
          try {
            const loyaltyDb = await getPool();
            await loyaltyDb.request()
              .input('invID', sql.Int, newInvID)
              .input('invType', sql.NVarChar(20), invType)
              .input('UserID', sql.Int, userID)
              .query(`
                EXEC [dbo].[sp_Loyalty_EarnPointsFromSale]
                  @invID = @invID,
                  @invType = @invType,
                  @UserID = @UserID
              `);
            console.log(
              `[pos-api]   👑 Loyalty points awarded for ClientID=${body.clientId}, Invoice=${newInvID}`,
            );
          } catch (loyaltyErr) {
            console.error(
              `[pos-api]   ⚠️ Loyalty points error (non-critical): ${loyaltyErr instanceof Error ? loyaltyErr.message : loyaltyErr}`,
            );
          }
        }

        // ── 8. Send WhatsApp messages ──
        if (body.clientId) {
          try {
            const waDb = await getPool();

            const customerResult = await waDb
              .request()
              .input('waClientId', sql.Int, body.clientId)
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
                  .input('waInvID', sql.Int, newInvID)
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
                  .input('waFirstClientId', sql.Int, body.clientId)
                  .input('waCurrentInvID', sql.Int, newInvID)
                  .query(`
                    SELECT COUNT(*) AS cnt
                    FROM [dbo].[TblinvServHead]
                    WHERE ClientID = @waFirstClientId
                      AND invType = N'مبيعات'
                      AND invID <> @waCurrentInvID
                  `);
                const isFirstTime = (priorInvResult.recordset[0]?.cnt as number) === 0;

                await sendSaleWhatsAppMessage({
                  phone,
                  customerName,
                  invID: newInvID,
                  total: grandTotal,
                  paymentMethod: paymentMethodLabel,
                  services: serviceNames,
                  employeeNames,
                });

                if (isFirstTime) {
                  await sendFirstTimeWhatsAppMessage({
                    phone,
                    customerName,
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

        // ── 9. Notify assigned employees via WhatsApp ──
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
            .input('empWaInvID', sql.Int, newInvID)
            .query(`
              SELECT
                d.EmpID,
                e.EmpName,
                e.Mobile,
                ${whatsAppSelect},
                p.ProName AS ServiceName
              FROM [dbo].[TblinvServDetail] d
              INNER JOIN [dbo].[TblEmp] e ON d.EmpID = e.EmpID
              LEFT JOIN [dbo].[TblPro] p ON d.ProID = p.ProID
              WHERE d.invID = @empWaInvID
                AND d.invType = N'مبيعات'
                AND d.EmpID IS NOT NULL
            `);

          const byEmployee = new Map<
            number,
            { empName: string; phone: string; services: string[] }
          >();

          for (const row of empDetailResult.recordset as Array<Record<string, unknown>>) {
            const empId = row.EmpID as number;
            const phone = resolveEmployeeWhatsAppPhone(
              row.WhatsApp as string | null | undefined,
              row.Mobile as string | null | undefined,
            );
            if (!phone) continue;

            const serviceName = (row.ServiceName as string | undefined)?.trim();
            const existing = byEmployee.get(empId);
            if (existing) {
              if (serviceName && !existing.services.includes(serviceName)) {
                existing.services.push(serviceName);
              }
              continue;
            }

            byEmployee.set(empId, {
              empName: (row.EmpName as string | undefined)?.trim() || 'موظف',
              phone,
              services: serviceName ? [serviceName] : [],
            });
          }

          for (const emp of byEmployee.values()) {
            if (emp.services.length === 0) continue;
            console.log(
              `[pos-api]   📱 Employee WhatsApp: ${emp.empName} (${emp.phone}) services=${emp.services.join(', ')}`,
            );
            const empWaResult = await sendEmployeeSaleWhatsAppMessage({
              phone: emp.phone,
              employeeName: emp.empName,
              invID: newInvID,
              services: emp.services,
            });
            if (!empWaResult.sent) {
              const reason =
                'reason' in empWaResult ? empWaResult.reason : 'unknown';
              const error =
                'error' in empWaResult ? empWaResult.error : undefined;
              console.log(
                `[pos-api]   ⚠️ Employee WhatsApp not sent for ${emp.empName}: ${reason}${error ? ` — ${error}` : ''}`,
              );
            }
          }

          if (byEmployee.size === 0) {
            console.log(
              `[pos-api]   ℹ️ Employee WhatsApp skipped: no employees with phone on invoice ${newInvID}`,
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

      return NextResponse.json({ invID: newInvID, invType }, { status: 201 });
    } catch (err) {
      const rollbackReason = err instanceof Error ? err.message : String(err);
      console.error(`[pos-api]   ❌ ROLLING BACK — reason: ${rollbackReason}`);
      try {
        await transaction.rollback();
        console.log(`[pos-api]   Rollback successful`);
      } catch (rbErr) {
        console.error(
          `[pos-api]   Rollback also failed: ${rbErr instanceof Error ? rbErr.message : rbErr}`,
        );
      }
      throw err;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : "";
    console.error(`[pos-api] ❌ POST /api/sales FAILED: ${message}`);
    if (stack) console.error(`[pos-api]   Stack: ${stack}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
