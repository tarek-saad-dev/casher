import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

// Types
interface UnspecifiedTransaction {
  ID: number;
  invID: number;
  invDate: string;
  invTime: string;
  invType: 'ايرادات' | 'مصروفات';
  ExpINID: number | null;
  CategoryName: string | null;
  GrandTolal: number;
  Notes: string | null;
  ShiftMoveID: number | null;
  PaymentMethodID: number | null;
  PaymentMethod: string | null;
  UserID: number | null;
  UserName: string | null;
  ShiftName: string | null;
  // Diagnostic fields
  possibleCause: string;
  causeConfidence: 'high' | 'medium' | 'low';
  suggestedFix: string;
}

interface SummaryStats {
  totalCount: number;
  totalRevenueCount: number;
  totalExpenseCount: number;
  totalRevenueAmount: number;
  totalExpenseAmount: number;
  totalAmount: number;
  percentageOfAllTransactions: number;
  byCategory: { category: string; count: number; amount: number; type: string }[];
  byCreator: { creator: string; count: number; amount: number }[];
  byDateRange: { month: string; count: number; revenueAmount: number; expenseAmount: number }[];
  trend: { date: string; count: number }[];
}

// Detection criteria for unspecified payment methods
function isUnspecifiedPaymentMethod(pmId: number | null, pmName: string | null): boolean {
  if (pmId === null || pmId === undefined) return true;
  if (pmName === null || pmName === undefined) return true;
  const normalized = pmName.toString().trim().toLowerCase();
  if (normalized === '') return true;
  if (normalized === 'غير محدد') return true;
  if (normalized === 'unspecified') return true;
  if (normalized === 'null') return true;
  if (normalized === 'unknown') return true;
  return false;
}

// Intelligent cause detection
function detectPossibleCause(
  tx: UnspecifiedTransaction,
  allUnspecifiedCount: number,
  earliestDate: string | null
): { cause: string; confidence: 'high' | 'medium' | 'low'; suggestedFix: string } {
  const txDate = new Date(tx.invDate);
  const now = new Date();
  const txYear = txDate.getFullYear();
  const txMonth = txDate.getMonth();
  
  // 1. Legacy data (pre-payment method feature)
  if (txYear < 2024 || (txYear === 2024 && txMonth < 3)) {
    return {
      cause: 'بيانات قديمة تم استيرادها قبل إضافة طرق الدفع للنظام',
      confidence: 'high',
      suggestedFix: 'تعيين طريقة الدفع الافتراضية (كاش) أو الاستعلام من المصدر الأصلي'
    };
  }
  
  // 2. Migration script indicator
  if (tx.ShiftMoveID === null && tx.UserID === null) {
    return {
      cause: 'تم الإنشاء عبر سكريبت ترحيل بيانات بدون تحديد طريقة الدفع',
      confidence: 'high',
      suggestedFix: 'تحديث باستخدام طريقة دفع كاش (الافتراضية)'
    };
  }
  
  // 3. Import from external source
  if (tx.Notes && (
    tx.Notes.includes('import') || 
    tx.Notes.includes('استيراد') || 
    tx.Notes.includes('excel') || 
    tx.Notes.includes('csv') ||
    tx.Notes.includes('ترحيل')
  )) {
    return {
      cause: 'تم الاستيراد من ملف Excel/CSV بدون تعيين طريقة الدفع',
      confidence: 'high',
      suggestedFix: 'تعيين طريقة الدفع بناءً على نوع المعاملة والفئة'
    };
  }
  
  // 4. Check for edit indicators in notes
  if (tx.Notes && (
    tx.Notes.includes('تعديل') || 
    tx.Notes.includes('edit') || 
    tx.Notes.includes('updated')
  )) {
    return {
      cause: 'تم التعديل على المعاملة لكن طريقة الدفع لم يتم تعيينها أثناء التعديل',
      confidence: 'low',
      suggestedFix: 'تعيين طريقة الدفع المناسبة للمعاملة المعدلة'
    };
  }
  
  // 5. Batch operations
  if (allUnspecifiedCount > 100 && txDate > new Date('2024-06-01')) {
    return {
      cause: 'ربما تم تعطيل التحقق من طريقة الدفع مؤقتًا أثناء عملية إنشاء مجموعة من المعاملات',
      confidence: 'medium',
      suggestedFix: 'مراجعة إعدادات التحقق والتأكد من تفعيلها'
    };
  }
  
  // 6. UI bug detection (transactions without shift)
  if (tx.ShiftMoveID === null && txDate > new Date('2024-01-01')) {
    return {
      cause: 'ربما تم إنشاء المعاملة بواجهة مستخدم قديمة أو عبر API بدون تحقق كامل',
      confidence: 'medium',
      suggestedFix: 'تحديث النظام ومراجعة نقاط API للتأكد من التحقق من طريقة الدفع'
    };
  }
  
  // 7. Database corruption
  if (tx.PaymentMethodID !== null && tx.PaymentMethod === null) {
    return {
      cause: 'تلف في قاعدة البيانات - PaymentMethodID موجود لكن غير مرتبط بجدول طرق الدفع',
      confidence: 'high',
      suggestedFix: 'إصلاح الروابط في قاعدة البيانات أو إعادة تعيين طريقة الدفع'
    };
  }
  
  // Default
  return {
    cause: 'سبب غير محدد - يتطلب مراجعة يدوية',
    confidence: 'low',
    suggestedFix: 'مراجعة المعاملة يدويًا وتحديد طريقة الدفع المناسبة'
  };
}

// GET /api/audit/unspecified-payment-methods
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const url = new URL(req.url);
    
    // Pagination
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 500);
    const offset = (page - 1) * limit;
    
    // Filters
    const type = url.searchParams.get('type'); // 'revenue', 'expense', or null for both
    const fromDate = url.searchParams.get('fromDate');
    const toDate = url.searchParams.get('toDate');
    const categoryId = url.searchParams.get('categoryId');
    const creatorId = url.searchParams.get('creatorId');
    const minAmount = url.searchParams.get('minAmount');
    const maxAmount = url.searchParams.get('maxAmount');
    const search = url.searchParams.get('search');
    const includeOnly = url.searchParams.get('includeOnly') === 'true'; // true = include only unspecified
    
    const db = await getPool();
    
    // Build base WHERE clause
    const conditions: string[] = [];
    const request = db.request();
    
    // Type filter
    if (type === 'revenue') {
      conditions.push("CM.invType = N'ايرادات'");
    } else if (type === 'expense') {
      conditions.push("CM.invType = N'مصروفات'");
    }
    
    // Date range
    if (fromDate) {
      conditions.push('CM.invDate >= @fromDate');
      request.input('fromDate', sql.Date, fromDate);
    }
    if (toDate) {
      conditions.push('CM.invDate <= @toDate');
      request.input('toDate', sql.Date, toDate);
    }
    
    // Category
    if (categoryId) {
      conditions.push('CM.ExpINID = @categoryId');
      request.input('categoryId', sql.Int, parseInt(categoryId));
    }
    
    // Creator
    if (creatorId) {
      conditions.push('U.UserID = @creatorId');
      request.input('creatorId', sql.Int, parseInt(creatorId));
    }
    
    // Amount range
    if (minAmount) {
      conditions.push('CM.GrandTolal >= @minAmount');
      request.input('minAmount', sql.Decimal(10, 2), parseFloat(minAmount));
    }
    if (maxAmount) {
      conditions.push('CM.GrandTolal <= @maxAmount');
      request.input('maxAmount', sql.Decimal(10, 2), parseFloat(maxAmount));
    }
    
    // Search
    if (search) {
      conditions.push(`(
        CM.Notes LIKE N'%' + @search + N'%' OR
        ISNULL(CAT.CatName, '') LIKE N'%' + @search + N'%' OR
        ISNULL(U.UserName, '') LIKE N'%' + @search + N'%'
      )`);
      request.input('search', sql.NVarChar(200), search);
    }
    
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    
    // Query for data
    const dataQuery = `
      SELECT
        CM.ID,
        CM.invID,
        CM.invDate,
        CM.invTime,
        CM.invType,
        CM.ExpINID,
        ISNULL(CAT.CatName, N'غير مصنف') AS CategoryName,
        CM.GrandTolal,
        CM.Notes,
        CM.ShiftMoveID,
        CM.PaymentMethodID,
        ISNULL(PM.PaymentMethod, N'غير محدد') AS PaymentMethod,
        U.UserID,
        ISNULL(U.UserName, N'غير معروف') AS UserName,
        S.ShiftName
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblExpINCat CAT        ON CM.ExpINID        = CAT.ExpINID
      LEFT JOIN dbo.TblPaymentMethods PM   ON CM.PaymentMethodID = PM.PaymentID
      LEFT JOIN dbo.TblShiftMove SM        ON CM.ShiftMoveID    = SM.ID
      LEFT JOIN dbo.TblUser U              ON SM.UserID         = U.UserID
      LEFT JOIN dbo.TblShift S             ON SM.ShiftID        = S.ShiftID
      ${whereClause}
      ORDER BY CM.invDate DESC, CM.ID DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
    `;
    
    const dataResult = await request.query(dataQuery);
    
    // Count query
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblShiftMove SM ON CM.ShiftMoveID = SM.ID
      LEFT JOIN dbo.TblUser U ON SM.UserID = U.UserID
      LEFT JOIN dbo.TblExpINCat CAT ON CM.ExpINID = CAT.ExpINID
      ${whereClause}
    `;
    const countResult = await request.query(countQuery);
    const totalCount = countResult.recordset[0].total;
    
    // Summary statistics query
    const summaryQuery = `
      SELECT
        SUM(CASE WHEN CM.invType = N'ايرادات' THEN 1 ELSE 0 END) AS revenueCount,
        SUM(CASE WHEN CM.invType = N'مصروفات' THEN 1 ELSE 0 END) AS expenseCount,
        SUM(CASE WHEN CM.invType = N'ايرادات' THEN CM.GrandTolal ELSE 0 END) AS revenueAmount,
        SUM(CASE WHEN CM.invType = N'مصروفات' THEN CM.GrandTolal ELSE 0 END) AS expenseAmount,
        COUNT(*) AS totalAffected,
        SUM(CM.GrandTolal) AS totalAmount
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblShiftMove SM ON CM.ShiftMoveID = SM.ID
      LEFT JOIN dbo.TblUser U ON SM.UserID = U.UserID
      LEFT JOIN dbo.TblExpINCat CAT ON CM.ExpINID = CAT.ExpINID
      ${whereClause}
    `;
    const summaryResult = await request.query(summaryQuery);
    const summary = summaryResult.recordset[0];
    
    // Get total transactions for percentage calculation
    const totalTxQuery = `
      SELECT COUNT(*) AS total FROM dbo.TblCashMove CM
      ${conditions.length > 0 ? 'WHERE ' + conditions.filter(c => !c.includes('PaymentMethod')).join(' AND ') : ''}
    `;
    const totalTxResult = await request.query(totalTxQuery);
    const allTransactionsCount = totalTxResult.recordset[0].total;
    
    // Category breakdown
    const categoryQuery = `
      SELECT
        ISNULL(CAT.CatName, N'غير مصنف') AS category,
        CM.invType AS type,
        COUNT(*) AS count,
        SUM(CM.GrandTolal) AS amount
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblExpINCat CAT ON CM.ExpINID = CAT.ExpINID
      LEFT JOIN dbo.TblShiftMove SM ON CM.ShiftMoveID = SM.ID
      LEFT JOIN dbo.TblUser U ON SM.UserID = U.UserID
      ${whereClause}
      GROUP BY CAT.CatName, CM.invType
      ORDER BY count DESC
    `;
    const categoryResult = await request.query(categoryQuery);
    
    // Creator breakdown
    const creatorQuery = `
      SELECT
        ISNULL(U.UserName, N'غير معروف') AS creator,
        COUNT(*) AS count,
        SUM(CM.GrandTolal) AS amount
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblShiftMove SM ON CM.ShiftMoveID = SM.ID
      LEFT JOIN dbo.TblUser U ON SM.UserID = U.UserID
      ${whereClause}
      GROUP BY U.UserName
      ORDER BY count DESC
    `;
    const creatorResult = await request.query(creatorQuery);
    
    // Monthly trend
    const trendQuery = `
      SELECT
        FORMAT(CM.invDate, 'yyyy-MM') AS month,
        COUNT(*) AS count,
        SUM(CASE WHEN CM.invType = N'ايرادات' THEN CM.GrandTolal ELSE 0 END) AS revenueAmount,
        SUM(CASE WHEN CM.invType = N'مصروفات' THEN CM.GrandTolal ELSE 0 END) AS expenseAmount
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblShiftMove SM ON CM.ShiftMoveID = SM.ID
      LEFT JOIN dbo.TblUser U ON SM.UserID = U.UserID
      ${whereClause}
      GROUP BY FORMAT(CM.invDate, 'yyyy-MM')
      ORDER BY month DESC
    `;
    const trendResult = await request.query(trendQuery);
    
    // Get earliest unspecified transaction date for cause detection context
    const earliestQuery = `
      SELECT MIN(CM.invDate) AS earliest
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblShiftMove SM ON CM.ShiftMoveID = SM.ID
      LEFT JOIN dbo.TblUser U ON SM.UserID = U.UserID
      ${whereClause}
    `;
    const earliestResult = await request.query(earliestQuery);
    const earliestDate = earliestResult.recordset[0]?.earliest;
    
    // Process transactions and detect causes
    const transactions: UnspecifiedTransaction[] = dataResult.recordset.map((tx: any) => {
      const causeInfo = detectPossibleCause(tx, totalCount, earliestDate);
      
      return {
        ...tx,
        possibleCause: causeInfo.cause,
        causeConfidence: causeInfo.confidence,
        suggestedFix: causeInfo.suggestedFix
      };
    });
    
    // Filter to only include actual unspecified payment methods
    const unspecifiedTransactions = includeOnly 
      ? transactions.filter(tx => isUnspecifiedPaymentMethod(tx.PaymentMethodID, tx.PaymentMethod))
      : transactions;
    
    const summaryStats: SummaryStats = {
      totalCount: unspecifiedTransactions.length,
      totalRevenueCount: summary.revenueCount || 0,
      totalExpenseCount: summary.expenseCount || 0,
      totalRevenueAmount: summary.revenueAmount || 0,
      totalExpenseAmount: summary.expenseAmount || 0,
      totalAmount: summary.totalAmount || 0,
      percentageOfAllTransactions: allTransactionsCount > 0 
        ? (summary.totalAffected / allTransactionsCount) * 100 
        : 0,
      byCategory: categoryResult.recordset.map((r: any) => ({
        category: r.category,
        count: r.count,
        amount: r.amount,
        type: r.type
      })),
      byCreator: creatorResult.recordset.map((r: any) => ({
        creator: r.creator,
        count: r.count,
        amount: r.amount
      })),
      byDateRange: trendResult.recordset.map((r: any) => ({
        month: r.month,
        count: r.count,
        revenueAmount: r.revenueAmount,
        expenseAmount: r.expenseAmount
      })),
      trend: trendResult.recordset.map((r: any) => ({
        date: r.month,
        count: r.count
      }))
    };
    
    return NextResponse.json({
      transactions: unspecifiedTransactions,
      summary: summaryStats,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/audit/unspecified-payment-methods] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
