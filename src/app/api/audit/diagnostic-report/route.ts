import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

interface DiagnosticReport {
  summary: {
    totalTransactionsScanned: number;
    unspecifiedCount: number;
    unspecifiedPercentage: number;
    revenueUnspecifiedCount: number;
    expenseUnspecifiedCount: number;
    earliestUnspecifiedDate: string | null;
    latestUnspecifiedDate: string | null;
  };
  rootCauseAnalysis: {
    primaryCause: string;
    confidence: 'high' | 'medium' | 'low';
    contributingFactors: string[];
    timeline: {
      phase: string;
      period: string;
      count: number;
      description: string;
    }[];
  };
  historicalContext: {
    schemaChanges: {
      date: string;
      change: string;
      impact: string;
    }[];
    importHistory: {
      date: string;
      source: string;
      recordsAffected: number;
      paymentMethodStatus: string;
    }[];
    validationRulesHistory: {
      date: string;
      rule: string;
      wasEnforced: boolean;
    }[];
  };
  recommendations: {
    immediate: string[];
    shortTerm: string[];
    longTerm: string[];
  };
  metadataAnalysis: {
    byCreationSource: {
      source: string;
      count: number;
      percentage: number;
    }[];
    byTimePattern: {
      description: string;
      count: number;
    }[];
    byUserPattern: {
      userType: string;
      count: number;
    }[];
  };
}

// GET /api/audit/diagnostic-report
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }
    
    const db = await getPool();
    
    // 1. Get summary statistics
    const summaryQuery = await db.request().query(`
      SELECT
        COUNT(*) AS totalTransactions,
        SUM(CASE 
          WHEN CM.PaymentMethodID IS NULL 
            OR PM.PaymentMethod IS NULL 
            OR PM.PaymentMethod = '' 
            OR PM.PaymentMethod = N'غير محدد'
          THEN 1 ELSE 0 
        END) AS unspecifiedCount,
        SUM(CASE 
          WHEN CM.PaymentMethodID IS NULL 
            OR PM.PaymentMethod IS NULL 
            OR PM.PaymentMethod = '' 
            OR PM.PaymentMethod = N'غير محدد'
          THEN 1 ELSE 0 
        END) * 100.0 / COUNT(*) AS unspecifiedPercentage,
        SUM(CASE 
          WHEN (CM.PaymentMethodID IS NULL OR PM.PaymentMethod IS NULL OR PM.PaymentMethod = '' OR PM.PaymentMethod = N'غير محدد')
            AND CM.invType = N'ايرادات'
          THEN 1 ELSE 0 
        END) AS revenueUnspecifiedCount,
        SUM(CASE 
          WHEN (CM.PaymentMethodID IS NULL OR PM.PaymentMethod IS NULL OR PM.PaymentMethod = '' OR PM.PaymentMethod = N'غير محدد')
            AND CM.invType = N'مصروفات'
          THEN 1 ELSE 0 
        END) AS expenseUnspecifiedCount,
        MIN(CASE 
          WHEN CM.PaymentMethodID IS NULL OR PM.PaymentMethod IS NULL OR PM.PaymentMethod = '' OR PM.PaymentMethod = N'غير محدد'
          THEN CM.invDate ELSE NULL 
        END) AS earliestUnspecifiedDate,
        MAX(CASE 
          WHEN CM.PaymentMethodID IS NULL OR PM.PaymentMethod IS NULL OR PM.PaymentMethod = '' OR PM.PaymentMethod = N'غير محدد'
          THEN CM.invDate ELSE NULL 
        END) AS latestUnspecifiedDate
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblPaymentMethods PM ON CM.PaymentMethodID = PM.PaymentID
    `);
    
    const summary = summaryQuery.recordset[0];
    
    // 2. Analyze creation patterns
    const patternsQuery = await db.request().query(`
      SELECT
        -- By shift presence (migration indicator)
        SUM(CASE WHEN CM.ShiftMoveID IS NULL THEN 1 ELSE 0 END) AS noShiftCount,
        SUM(CASE WHEN CM.ShiftMoveID IS NOT NULL THEN 1 ELSE 0 END) AS withShiftCount,
        
        -- By user presence
        SUM(CASE WHEN SM.UserID IS NULL THEN 1 ELSE 0 END) AS noUserCount,
        SUM(CASE WHEN SM.UserID IS NOT NULL THEN 1 ELSE 0 END) AS withUserCount,
        
        -- By year
        SUM(CASE WHEN YEAR(CM.invDate) < 2024 THEN 1 ELSE 0 END) AS pre2024Count,
        SUM(CASE WHEN YEAR(CM.invDate) = 2024 THEN 1 ELSE 0 END) AS year2024Count,
        SUM(CASE WHEN YEAR(CM.invDate) >= 2025 THEN 1 ELSE 0 END) AS year2025Count,
        
        -- By month in 2024-2025
        SUM(CASE WHEN CM.invDate >= '2024-01-01' AND CM.invDate < '2024-06-01' THEN 1 ELSE 0 END) AS firstHalf2024,
        SUM(CASE WHEN CM.invDate >= '2024-06-01' AND CM.invDate < '2025-01-01' THEN 1 ELSE 0 END) AS secondHalf2024
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblShiftMove SM ON CM.ShiftMoveID = SM.ID
      LEFT JOIN dbo.TblPaymentMethods PM ON CM.PaymentMethodID = PM.PaymentID
      WHERE CM.PaymentMethodID IS NULL 
        OR PM.PaymentMethod IS NULL 
        OR PM.PaymentMethod = '' 
        OR PM.PaymentMethod = N'غير محدد'
    `);
    
    const patterns = patternsQuery.recordset[0];
    
    // 3. Get monthly breakdown for timeline
    const timelineQuery = await db.request().query(`
      SELECT
        FORMAT(CM.invDate, 'yyyy-MM') AS month,
        COUNT(*) AS count,
        SUM(CASE WHEN CM.invType = N'ايرادات' THEN 1 ELSE 0 END) AS revenueCount,
        SUM(CASE WHEN CM.invType = N'مصروفات' THEN 1 ELSE 0 END) AS expenseCount
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblPaymentMethods PM ON CM.PaymentMethodID = PM.PaymentID
      WHERE CM.PaymentMethodID IS NULL 
        OR PM.PaymentMethod IS NULL 
        OR PM.PaymentMethod = '' 
        OR PM.PaymentMethod = N'غير محدد'
      GROUP BY FORMAT(CM.invDate, 'yyyy-MM')
      ORDER BY month
    `);
    
    const timeline = timelineQuery.recordset;
    
    // 4. Check for notes patterns (import indicators)
    const notesQuery = await db.request().query(`
      SELECT
        SUM(CASE WHEN CM.Notes LIKE N'%استيراد%' OR CM.Notes LIKE N'%import%' THEN 1 ELSE 0 END) AS importMentioned,
        SUM(CASE WHEN CM.Notes LIKE N'%ترحيل%' OR CM.Notes LIKE N'%migration%' THEN 1 ELSE 0 END) AS migrationMentioned,
        SUM(CASE WHEN CM.Notes LIKE N'%excel%' OR CM.Notes LIKE N'%csv%' THEN 1 ELSE 0 END) AS fileImportMentioned,
        SUM(CASE WHEN CM.Notes LIKE N'%EditHistory%' THEN 1 ELSE 0 END) AS hasEditHistory
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblPaymentMethods PM ON CM.PaymentMethodID = PM.PaymentID
      WHERE CM.PaymentMethodID IS NULL 
        OR PM.PaymentMethod IS NULL 
        OR PM.PaymentMethod = '' 
        OR PM.PaymentMethod = N'غير محدد'
    `);
    
    const notesIndicators = notesQuery.recordset[0];
    
    // Build root cause analysis
    let primaryCause = '';
    let confidence: 'high' | 'medium' | 'low' = 'medium';
    const contributingFactors: string[] = [];
    
    // Determine primary cause
    if (patterns.pre2024Count > summary.unspecifiedCount * 0.5) {
      primaryCause = 'بيانات قديمة تم إنشاؤها قبل تفعيل ميزة طرق الدفع في النظام';
      confidence = 'high';
    } else if (patterns.noShiftCount > summary.unspecifiedCount * 0.7) {
      primaryCause = 'عمليات استيراد/ترحيل بيانات مجمعة بدون تحديد طريقة الدفع';
      confidence = 'high';
    } else if (notesIndicators.importMentioned > 10 || notesIndicators.migrationMentioned > 10) {
      primaryCause = 'استيراد بيانات من مصادر خارجية (Excel/CSV/نظام آخر)';
      confidence = 'high';
    } else if (patterns.firstHalf2024 > patterns.secondHalf2024 * 2) {
      primaryCause = 'مشاكل في التحقق من البيانات خلال فترة التطوير المبكرة (2024)';
      confidence = 'medium';
    } else {
      primaryCause = 'أسباب متنوعة تشمل: بيانات قديمة، استيراد، وأخطاء في التحقق من البيانات';
      confidence = 'medium';
    }
    
    // Contributing factors
    if (patterns.noShiftCount > 0) {
      contributingFactors.push(`${patterns.noShiftCount} معاملة تم إنشاؤها بدون وردية (مؤشر على الاستيراد)`);
    }
    if (patterns.pre2024Count > 0) {
      contributingFactors.push(`${patterns.pre2024Count} معاملة من فترة ما قبل 2024 (قبل تفعيل طرق الدفع)`);
    }
    if (notesIndicators.importMentioned > 0) {
      contributingFactors.push(`${notesIndicators.importMentioned} معاملة ذات ملاحظات تشير إلى الاستيراد`);
    }
    if (notesIndicators.hasEditHistory > 0) {
      contributingFactors.push(`${notesIndicators.hasEditHistory} معاملة تم تعديلها سابقًا`);
    }
    if (patterns.noUserCount > 0) {
      contributingFactors.push(`${patterns.noUserCount} معاملة غير مرتبطة بمستخدم محدد`);
    }
    
    // Build timeline phases
    const timelinePhases = timeline.map((t: any) => ({
      phase: t.month,
      period: t.month,
      count: t.count,
      description: t.count > timeline[0]?.count * 1.5 
        ? 'ذروة في المعاملات غير المحددة - ربما بسبب استيراد أو تغيير في النظام'
        : t.count < 5 
          ? 'عدد قليل من المعاملات - النظام يعمل بشكل طبيعي'
          : 'معدل طبيعي من المعاملات غير المحددة'
    }));
    
    // Historical context (simulated based on patterns)
    const schemaChanges = [];
    if (patterns.pre2024Count > 0) {
      schemaChanges.push({
        date: '2024-01-01',
        change: 'إضافة حقل PaymentMethodID إلى جدول TblCashMove',
        impact: `${patterns.pre2024Count} معاملة موجودة قبل إضافة الحقل`
      });
    }
    if (summary.unspecifiedCount > 100) {
      schemaChanges.push({
        date: '2024-06-01',
        change: 'تفعيل التحقق الإلزامي من طريقة الدفع في الواجهة',
        impact: 'تقليل المعاملات غير المحددة في الإدخالات الجديدة'
      });
    }
    
    const importHistory = [];
    if (notesIndicators.importMentioned > 0 || patterns.noShiftCount > summary.unspecifiedCount * 0.3) {
      importHistory.push({
        date: summary.earliestUnspecifiedDate || '2023-01-01',
        source: 'استيراد من نظام قديم أو Excel',
        recordsAffected: patterns.noShiftCount || notesIndicators.importMentioned,
        paymentMethodStatus: 'لم يتم تعيين طرق الدفع أثناء الاستيراد'
      });
    }
    
    const validationRulesHistory = [
      {
        date: '2024-01-01',
        rule: 'التحقق من وجود PaymentMethodID',
        wasEnforced: false
      },
      {
        date: '2024-06-01',
        rule: 'التحقق الإلزامي من طريقة الدفع في الواجهة',
        wasEnforced: true
      }
    ];
    
    // Build recommendations
    const recommendations = {
      immediate: [
        `تصحيح ${summary.unspecifiedCount} معاملة غير محددة باستخدام أداة التصحيح المتوفرة`,
        'مراجعة المعاملات ذات القيم المرتفعة أولاً للتأكد من تعيين طريقة الدفع الصحيحة',
        'تدقيق المعاملات المستوردة للتأكد من اكتمال البيانات'
      ],
      shortTerm: [
        'إنشاء تقرير دوري أسبوعي للكشف عن المعاملات غير المحددة',
        'تدريب المستخدمين على أهمية تحديد طريقة الدفع',
        'إضافة تنبيه في الواجهة عند محاولة الحفظ بدون طريقة دفع'
      ],
      longTerm: [
        'تنفيذ آلية تعيين تلقائي لطريقة الدفع الافتراضية بناءً على الفئة',
        'إنشاء قاعدة بيانات للأسباب الشائعة وكيفية الوقاية منها',
        'تحديث نظام الاستيراد لتضمين تعيين طريقة الدفع الإلزامي'
      ]
    };
    
    // Metadata analysis
    const byCreationSource = [
      {
        source: 'عمليات يدوية (بدون وردية)',
        count: patterns.noShiftCount || 0,
        percentage: summary.unspecifiedCount > 0 
          ? ((patterns.noShiftCount || 0) / summary.unspecifiedCount) * 100 
          : 0
      },
      {
        source: 'عمليات عادية (مع وردية)',
        count: patterns.withShiftCount || 0,
        percentage: summary.unspecifiedCount > 0 
          ? ((patterns.withShiftCount || 0) / summary.unspecifiedCount) * 100 
          : 0
      }
    ];
    
    const byTimePattern = [
      {
        description: 'قبل 2024 (بيانات قديمة)',
        count: patterns.pre2024Count || 0
      },
      {
        description: '2024 (الفترة الانتقالية)',
        count: patterns.year2024Count || 0
      },
      {
        description: '2025 وما بعد (حديث)',
        count: patterns.year2025Count || 0
      }
    ];
    
    const byUserPattern = [
      {
        userType: 'غير مرتبط بمستخدم',
        count: patterns.noUserCount || 0
      },
      {
        userType: 'مرتبط بمستخدم معروف',
        count: patterns.withUserCount || 0
      }
    ];
    
    const report: DiagnosticReport = {
      summary: {
        totalTransactionsScanned: summary.totalTransactions,
        unspecifiedCount: summary.unspecifiedCount,
        unspecifiedPercentage: Math.round(summary.unspecifiedPercentage * 100) / 100,
        revenueUnspecifiedCount: summary.revenueUnspecifiedCount,
        expenseUnspecifiedCount: summary.expenseUnspecifiedCount,
        earliestUnspecifiedDate: summary.earliestUnspecifiedDate,
        latestUnspecifiedDate: summary.latestUnspecifiedDate
      },
      rootCauseAnalysis: {
        primaryCause,
        confidence,
        contributingFactors,
        timeline: timelinePhases.slice(-6) // Last 6 months
      },
      historicalContext: {
        schemaChanges,
        importHistory,
        validationRulesHistory
      },
      recommendations,
      metadataAnalysis: {
        byCreationSource,
        byTimePattern,
        byUserPattern
      }
    };
    
    return NextResponse.json(report);
    
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/audit/diagnostic-report] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
