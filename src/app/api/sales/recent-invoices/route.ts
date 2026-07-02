import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { RecentInvoiceItem, RecentInvoicesResponse } from '@/lib/recentInvoices.types';
import { parseRecentInvoicesSearchParams, buildRecentInvoicesWhereClause } from '@/lib/recentInvoicesQuery';
import { computeInvoiceSearchRankScore } from '@/lib/invoiceSearch';

const INV_TYPE = 'مبيعات';

function bindCommonFilters(
  request: sql.Request,
  parsed: ReturnType<typeof parseRecentInvoicesSearchParams>,
) {
  if (parsed.dateFrom) request.input('dateFrom', sql.Date, parsed.dateFrom);
  if (parsed.dateTo) request.input('dateTo', sql.Date, parsed.dateTo);
  if (parsed.minAmount !== undefined) request.input('minAmount', sql.Decimal(18, 2), parsed.minAmount);
  if (parsed.maxAmount !== undefined) request.input('maxAmount', sql.Decimal(18, 2), parsed.maxAmount);
  if (parsed.cursor) request.input('cursor', sql.Int, parsed.cursor);

  parsed.searchLikePatterns.forEach((pattern, index) => {
    request.input(`searchPattern${index}`, sql.NVarChar(120), pattern);
  });

  if (parsed.phonePattern) {
    request.input('phonePattern', sql.NVarChar(40), parsed.phonePattern);
  }

  if (parsed.q) {
    request.input('qExact', sql.NVarChar(40), parsed.q);
    request.input('qPrefix', sql.NVarChar(40), `${parsed.q}%`);
  }
}

function buildOrderClause(parsed: ReturnType<typeof parseRecentInvoicesSearchParams>): string {
  if (!parsed.q) {
    return 'h.invDate DESC, h.invID DESC';
  }

  return `
    CASE
      WHEN CAST(h.invID AS NVARCHAR(20)) = @qExact THEN 0
      WHEN CAST(h.invID AS NVARCHAR(20)) LIKE @qPrefix THEN 1
      WHEN REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(c.Mobile, N''), N' ', N''), N'-', N''), N'(', N''), N')', N'') = @qExact THEN 2
      WHEN REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(c.Mobile, N''), N' ', N''), N'-', N''), N'(', N''), N')', N'') LIKE @qPrefix THEN 3
      ELSE 4
    END ASC,
    h.invDate DESC,
    h.invID DESC
  `;
}

const LIST_SELECT = `
  SELECT
    h.invID AS InvID,
    h.invID AS InvNo,
    h.invDate AS InvDate,
    ISNULL(h.GrandTotal, 0) AS TotalPrice,
    ISNULL(h.PayCash, 0) + ISNULL(h.PayVisa, 0) AS PaidAmount,
    CASE
      WHEN ISNULL(h.GrandTotal, 0) > (ISNULL(h.PayCash, 0) + ISNULL(h.PayVisa, 0))
      THEN ISNULL(h.GrandTotal, 0) - (ISNULL(h.PayCash, 0) + ISNULL(h.PayVisa, 0))
      ELSE 0
    END AS RemainingAmount,
    ISNULL(h.DisVal, 0) AS Discount,
    h.PaymentMethodID,
    h.ClientID,
    ISNULL(c.[Name], N'عميل نقدي') AS ClientName,
    c.Mobile AS Phone,
    (
      SELECT COUNT(*)
      FROM [dbo].[TblinvServDetail] dCount
      WHERE dCount.invID = h.invID AND dCount.invType = h.invType
    ) AS ServiceCount,
    (
      SELECT STRING_AGG(CONCAT(ISNULL(pAgg.ProName, N'خدمة'), N' (', ISNULL(eAgg.EmpName, N'موظف'), N')'), N', ')
      FROM [dbo].[TblinvServDetail] dAgg
      LEFT JOIN [dbo].[TblPro] pAgg ON dAgg.ProID = pAgg.ProID
      LEFT JOIN [dbo].[TblEmp] eAgg ON dAgg.EmpID = eAgg.EmpID
      WHERE dAgg.invID = h.invID AND dAgg.invType = h.invType
    ) AS ServicesSummary,
    (
      SELECT STRING_AGG(eNames.EmpName, N', ')
      FROM (
        SELECT DISTINCT eDistinct.EmpName
        FROM [dbo].[TblinvServDetail] dDistinct
        INNER JOIN [dbo].[TblEmp] eDistinct ON dDistinct.EmpID = eDistinct.EmpID
        WHERE dDistinct.invID = h.invID AND dDistinct.invType = h.invType
      ) eNames
    ) AS EmployeeNames,
    (
      SELECT TOP 1 dTop.EmpID
      FROM [dbo].[TblinvServDetail] dTop
      WHERE dTop.invID = h.invID AND dTop.invType = h.invType
      ORDER BY dTop.ID
    ) AS EmpID,
    (
      SELECT TOP 1 eTop.EmpName
      FROM [dbo].[TblinvServDetail] dTop
      INNER JOIN [dbo].[TblEmp] eTop ON dTop.EmpID = eTop.EmpID
      WHERE dTop.invID = h.invID AND dTop.invType = h.invType
      ORDER BY dTop.ID
    ) AS EmpName,
    CASE
      WHEN (
        SELECT COUNT(DISTINCT pSplit.PaymentMethodID)
        FROM [dbo].[TblinvServPayment] pSplit
        WHERE pSplit.invID = h.invID
          AND pSplit.invType = h.invType
          AND ISNULL(pSplit.PayValue, 0) > 0
      ) > 1 THEN CAST(1 AS BIT)
      ELSE CAST(0 AS BIT)
    END AS IsSplitPayment,
    COALESCE(
      (
        SELECT STRING_AGG(pmSplit.PaymentMethod, N' + ')
        FROM (
          SELECT DISTINCT pLabel.PaymentMethodID
          FROM [dbo].[TblinvServPayment] pLabel
          WHERE pLabel.invID = h.invID
            AND pLabel.invType = h.invType
            AND ISNULL(pLabel.PayValue, 0) > 0
        ) splitIds
        INNER JOIN [dbo].[TblPaymentMethods] pmSplit ON splitIds.PaymentMethodID = pmSplit.PaymentID
      ),
      ISNULL(pmHead.PaymentMethod, N'نقدي')
    ) AS PaymentMethodName
  FROM [dbo].[TblinvServHead] h
  LEFT JOIN [dbo].[TblPaymentMethods] pmHead ON h.PaymentMethodID = pmHead.PaymentID
  LEFT JOIN [dbo].[TblClient] c ON h.ClientID = c.ClientID
`;

export async function GET(request: NextRequest) {
  try {
    const parsed = parseRecentInvoicesSearchParams(request.nextUrl.searchParams);
    const whereClause = buildRecentInvoicesWhereClause(parsed);
    const orderClause = buildOrderClause(parsed);
    const limit = parsed.limit ?? 20;

    const db = await getPool();

    const countRequest = db.request();
    bindCommonFilters(countRequest, parsed);
    const countResult = await countRequest.query(`
      SELECT COUNT(*) AS total
      FROM [dbo].[TblinvServHead] h
      LEFT JOIN [dbo].[TblClient] c ON h.ClientID = c.ClientID
      WHERE ${whereClause}
    `);
    const total = countResult.recordset[0]?.total ?? 0;

    const listRequest = db.request();
    bindCommonFilters(listRequest, parsed);
    listRequest.input('fetchLimit', sql.Int, limit + 1);

    const listResult = await listRequest.query(`
      ${LIST_SELECT}
      WHERE ${whereClause}
      ORDER BY ${orderClause}
      OFFSET 0 ROWS FETCH NEXT @fetchLimit ROWS ONLY
    `);

    const rows = listResult.recordset as RecentInvoiceItem[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    if (parsed.q && items.length > 1) {
      items.sort((a, b) => {
        const rankA = computeInvoiceSearchRankScore(parsed.searchRankInputs, {
          invId: a.InvID,
          phone: a.Phone,
          clientName: a.ClientName,
        });
        const rankB = computeInvoiceSearchRankScore(parsed.searchRankInputs, {
          invId: b.InvID,
          phone: b.Phone,
          clientName: b.ClientName,
        });
        if (rankA !== rankB) return rankA - rankB;
        return b.InvID - a.InvID;
      });
    }

    const response: RecentInvoicesResponse = {
      items,
      nextCursor: hasMore ? items[items.length - 1]?.InvID ?? null : null,
      hasMore,
      total,
    };

    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/sales/recent-invoices] GET error:', message);
    return NextResponse.json({ error: 'تعذر تحميل الفواتير' }, { status: 500 });
  }
}
