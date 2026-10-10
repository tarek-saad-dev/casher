import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/session";
import type { CreateSalePayload } from "@/lib/types";
import { resolveSplitPaymentConfig } from "@/lib/clearingMethod";
import {
  computeInvoiceItemsTotals,
} from "@/lib/sales/service-line-totals";
import { roundMoney } from "@/lib/reportMonthUtils";
import {
  resolveBranchDayAndShiftForWrite,
} from "@/lib/branch/operationalGates";
import { finalizeCurrentFinancialWrite } from "@/lib/branch/financialOwnershipPolicy";
import {
  createSale,
  isPosPortEnabled,
} from '@/apps/pos/public';
import { createSaleLegacyFromRoute } from '@/lib/sales/legacyRouteSaleCreate';
import { findForeignServiceIds } from '@/lib/catalog/tenantCatalogGuards';

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

    const sessionUser = await getSession();
    if (!sessionUser?.TenantId) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
    }

    // Lines may only name services/products of the caller's tenant.
    {
      const lineProIds = body.items.map((i) => Number(i.proId));
      const foreign = await findForeignServiceIds(await getPool(), sessionUser.TenantId, lineProIds);
      if (foreign.length > 0) {
        return NextResponse.json({ error: "خدمة غير موجودة" }, { status: 404 });
      }
    }

    // Home-visit tiers are mutually exclusive on one invoice.
    {
      const { listHomeVisitProIds } = await import('@/lib/catalog/publicPackagesCatalog');
      const { hasConflictingHomeVisitProIds } = await import(
        '@/lib/catalog/groomOptionalAddons'
      );
      const homeVisitProIds = await listHomeVisitProIds(sessionUser.TenantId);
      const lineProIds = body.items.map((i) => Number(i.proId));
      if (hasConflictingHomeVisitProIds(lineProIds, homeVisitProIds)) {
        return NextResponse.json(
          {
            error:
              'لا يمكن اختيار أكثر من مستوى واحد لزيارة تجهيز العريس في نفس الفاتورة',
            code: 'HOME_VISIT_EXCLUSIVE',
          },
          { status: 400 },
        );
      }
    }

    // ──── Session enforcement ────
    const userID = sessionUser?.UserID ?? 0;

    const db = await getPool();

    // DEBUG: confirm DB
    const dbNameResult = await db.request().query("SELECT DB_NAME() AS dbName");
    const dbName = dbNameResult.recordset[0].dbName;
    console.log(
      `[pos-api] ──── SAVE SALE START ──── DB=${dbName}, UserID=${userID}`,
    );

    // ──── Enforce active branch business day + user shift; stamp financial ownership ────
    const gated = await resolveBranchDayAndShiftForWrite(userID);
    if (!gated.ok) return gated.response;
    const owned = finalizeCurrentFinancialWrite("sale.create", gated, body);
    if (!owned.ok) return owned.response;
    if (!gated.shift || owned.ownership.shiftMoveId == null) {
      console.error(
        `[pos-api]   ❌ REJECTED: no active shift for UserID=${userID} branch=${gated.branch.branchCode}`,
      );
      return NextResponse.json(
        { error: "لا يوجد وردية مفتوحة لهذا المستخدم — لا يمكن إنشاء فاتورة" },
        { status: 400 },
      );
    }
    // Server-owned: OPEN ShiftSession → BranchID + BusinessDayID + ShiftMoveID.
    // Never trust browser branchId — ownership comes only from validated session context.
    const branchId = owned.ownership.branchId;
    const businessDayId = owned.ownership.businessDayId!;
    const activeDay = { ID: businessDayId, NewDay: owned.ownership.businessDate! };
    const invDate = owned.ownership.businessDate!;
    const shiftMoveID = owned.ownership.shiftMoveId;
    console.log(
      `[pos-api]   Active Day: ID=${activeDay.ID}, NewDay=${invDate}, Branch=${gated.branch.branchCode}`,
    );
    console.log(
      `[pos-api]   Active Shift: ID=${shiftMoveID}, UserID=${gated.shift.userId} (verified owner)`,
    );

    // Reject EmpIDs not assigned to the active branch
    {
      const { isEmployeeEligibleForBranchBookings } = await import(
        '@/lib/branch/bookingQueueOwnership'
      );
      const uniqueEmpIds = [
        ...new Set(
          body.items
            .map((item) => Number(item.empId))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      ];
      for (const empId of uniqueEmpIds) {
        const ok = await isEmployeeEligibleForBranchBookings({
          empId,
          branchId,
          operationalDate: invDate,
          requireCanReceiveBookings: false,
        });
        if (!ok) {
          return NextResponse.json(
            { error: `الموظف #${empId} غير معيَّن على فرع ${gated.branch.branchCode}` },
            { status: 400 },
          );
        }
      }
    }

    // ──── Server-side totals from line items + optional header discount ────
    const computed = computeInvoiceItemsTotals(
      body.items.map((item) => ({
        sPrice: item.sPrice,
        qty: item.qty,
        discountPercent: item.dis,
        discountValue: item.disVal,
        bonus: item.bonus,
      })),
      {
        discountPercent: body.dis,
        discountValue: body.disVal,
      },
    );
    const subTotal = computed.subTotal;
    const disPercent = computed.headerDiscountPercent;
    const disVal = computed.headerDiscountValue;
    const grandTotal = computed.grandTotal;

    // Soft-check client totals (log only — server values win)
    if (
      body.subTotal != null &&
      Math.abs(roundMoney(Number(body.subTotal)) - subTotal) > 0.01
    ) {
      console.warn(
        `[pos-api]   ⚠️ client subTotal=${body.subTotal} ≠ server ${subTotal}`,
      );
    }
    if (
      body.grandTotal != null &&
      Math.abs(roundMoney(Number(body.grandTotal)) - grandTotal) > 0.01
    ) {
      console.warn(
        `[pos-api]   ⚠️ client grandTotal=${body.grandTotal} ≠ server ${grandTotal}`,
      );
    }

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

    const saleInput = {
      items: body.items.map((item) => ({
        proId: item.proId,
        empId: item.empId,
        sPrice: item.sPrice,
        bonus: item.bonus,
        qty: item.qty,
        dis: item.dis,
        disVal: item.disVal,
        notes: item.notes,
      })),
      clientId: body.clientId,
      notes: body.notes,
      notes2: body.notes2,
      payCash,
      payVisa,
      paymentAllocations: body.paymentAllocations,
      computed,
      branchId,
      businessDayId,
      shiftMoveID,
      invDate,
      userID,
      splitCfg,
      activeAllocations,
      isSplitPayment,
      headerPaymentMethodId,
      branchName: gated.branch.branchName,
    };

    const result = isPosPortEnabled()
      ? await createSale(saleInput)
      : await createSaleLegacyFromRoute(saleInput);

    return NextResponse.json({ invID: result.invID, invType: result.invType }, { status: 201 });
  } catch (err: unknown) {
    const { InventoryDomainError } = await import(
      '@/lib/inventory/inventoryMutation.service'
    );
    if (err instanceof InventoryDomainError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      );
    }
    const { branchErrorResponse } = await import('@/lib/branch/operationalGates');
    const mapped = branchErrorResponse(err);
    if (mapped) return mapped;
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : "";
    console.error(`[pos-api] ❌ POST /api/sales FAILED: ${message}`);
    if (stack) console.error(`[pos-api]   Stack: ${stack}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
