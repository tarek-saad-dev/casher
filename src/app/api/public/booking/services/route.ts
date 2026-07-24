import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  PUBLIC_CORS_HEADERS,
} from "@/lib/publicBookingHelpers";
import {
  extractPublicBranchCode,
  resolvePublicBranchCode,
  publicBranchRequiredResponse,
  publicInvalidBranchResponse,
} from "@/lib/branch/bookingQueueOwnership";
import { BranchDomainError } from "@/lib/branch/types";

export const runtime = "nodejs";

// Categories to exclude by name fragment (Arabic + English)
const EXCLUDED_CATEGORY_PATTERNS = [
  "إداريات",
  "اداريات",
  "عائد",
  "الخزنه",
  "الخزنة",
  "منتجات",
  "برفانات",
  "مساعدين",
];

// Services to exclude by name fragment
const EXCLUDED_SERVICE_PATTERNS = [
  "عائد للخزنه",
  "عائد للخزنة",
  "كاش",
  "خزنة",
  "خزنه",
];

// Desired category display order (by name, lowercase)
const CATEGORY_ORDER: Record<string, number> = {
  حلاقة: 1,
  skincare: 2,
  "خدمات اضافيه للشعر": 3,
  "معالجات شعر": 4,
  "كريم شعر": 5,
};

// Important services shown first (by lowercase name)
const SERVICE_PRIORITY: Record<string, number> = {
  "basic cut": 1,
  "advanced cut": 2,
  "haircut & beard": 3,
  "beard styling & fade": 4,
  "basic skin care": 5,
  "medical skin care": 6,
  "deep skincare": 7,
};

function isCategoryExcluded(catName: string | null): boolean {
  if (!catName) return false;
  const lower = catName.toLowerCase();
  return EXCLUDED_CATEGORY_PATTERNS.some((p) =>
    lower.includes(p.toLowerCase()),
  );
}

function isServiceExcluded(svcName: string | null): boolean {
  if (!svcName) return false;
  const lower = svcName.toLowerCase();
  return EXCLUDED_SERVICE_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

function categoryRank(catName: string | null): number {
  if (!catName) return 999;
  const lower = catName.toLowerCase();
  return CATEGORY_ORDER[lower] ?? 100;
}

function serviceRank(svcName: string | null): number {
  if (!svcName) return 999;
  const lower = svcName.toLowerCase();
  return SERVICE_PRIORITY[lower] ?? 500;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/services
 * Returns only real customer-facing booking services.
 * Excludes products, internal categories, zero-price items.
 *
 * Query params:
 *   limit=30       (default 30, max 100)
 *   categoryId=N   (filter to one category)
 *   search=text    (filter by service name)
 */
export async function GET(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "طلبات كثيرة" },
      { status: 429, headers: PUBLIC_CORS_HEADERS },
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const limitParam = Math.min(
      Math.max(parseInt(searchParams.get("limit") ?? "30"), 1),
      100,
    );
    const filterCatId = searchParams.get("categoryId")
      ? parseInt(searchParams.get("categoryId")!)
      : null;
    const search = searchParams.get("search")?.trim().toLowerCase() ?? null;

    // Branch required — the service catalog stays global, but settings
    // (fallback duration, etc.) are resolved per branch.
    const branchCode = extractPublicBranchCode(searchParams);
    let branch;
    try {
      branch = await resolvePublicBranchCode(branchCode, {
        route: '/api/public/booking/services',
      });
    } catch (err) {
      if (err instanceof BranchDomainError) {
        return err.code === 'BRANCH_REQUIRED'
          ? publicBranchRequiredResponse()
          : publicInvalidBranchResponse();
      }
      throw err;
    }

    const settings = await getPublicSettings(branch.branchId);
    const fallbackDur = settings.defaultServiceDurationMinutes;

    const db = await getPool();

    // Single query: join TblPro + TblCat, include CatType and ProType for filtering
    const res = await db
      .request()
      .query(
        `
      SELECT
        p.ProID      AS id,
        p.ProName    AS name,
        p.SPrice1    AS price,
        ISNULL(p.DurationMinutes, ${fallbackDur}) AS durationMinutes,
        p.CatID      AS categoryId,
        c.CatName    AS categoryName,
        c.CatType    AS catType,
        ISNULL(p.ProType, '') AS proType,
        ISNULL(p.QuickSales, 0) AS quickSales
      FROM [dbo].[TblPro] p
      LEFT JOIN [dbo].[TblCat] c ON c.CatID = p.CatID
      WHERE ISNULL(p.isDeleted, 0) = 0
        AND ISNULL(p.SPrice1, 0) > 0
      ORDER BY c.CatName, p.ProName
    `,
      )
      .catch(() =>
        // Fallback without ProType/QuickSales if columns missing
        db.request().query(`
        SELECT
          p.ProID   AS id,
          p.ProName AS name,
          p.SPrice1 AS price,
          ${fallbackDur} AS durationMinutes,
          p.CatID   AS categoryId,
          c.CatName AS categoryName,
          c.CatType AS catType,
          '' AS proType,
          0  AS quickSales
        FROM [dbo].[TblPro] p
        LEFT JOIN [dbo].[TblCat] c ON c.CatID = p.CatID
        WHERE ISNULL(p.isDeleted, 0) = 0
          AND ISNULL(p.SPrice1, 0) > 0
        ORDER BY c.CatName, p.ProName
      `),
      );

    // Filter in memory
    let rows = res.recordset.filter((r: any) => {
      // Exclude product-type categories (CatType = 'pro')
      if (r.catType === "pro") return false;
      // Exclude by category name patterns
      if (isCategoryExcluded(r.categoryName)) return false;
      // Exclude by service name patterns
      if (isServiceExcluded(r.name)) return false;
      // Exclude non-service ProTypes if any (extend as needed)
      if (r.proType && r.proType.toLowerCase() === "pro") return false;
      return true;
    });

    // Optional: filter by categoryId
    if (filterCatId !== null) {
      rows = rows.filter((r: any) => r.categoryId === filterCatId);
    }

    // Optional: search by name
    if (search) {
      rows = rows.filter((r: any) => r.name?.toLowerCase().includes(search));
    }

    // Sort: category rank → service rank → price desc → name asc
    rows.sort((a: any, b: any) => {
      const catDiff =
        categoryRank(a.categoryName) - categoryRank(b.categoryName);
      if (catDiff !== 0) return catDiff;
      const svcDiff = serviceRank(a.name) - serviceRank(b.name);
      if (svcDiff !== 0) return svcDiff;
      const priceDiff = Number(b.price) - Number(a.price);
      if (priceDiff !== 0) return priceDiff;
      return (a.name ?? "").localeCompare(b.name ?? "", "ar");
    });

    // Apply limit
    rows = rows.slice(0, limitParam);

    // Build flat services list
    const services = rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      price: Number(r.price) || 0,
      durationMinutes: Number(r.durationMinutes) || fallbackDur,
      categoryId: r.categoryId,
      categoryName: r.categoryName ?? null,
    }));

    // Build grouped list
    const groupMap = new Map<
      number,
      { categoryId: number; categoryName: string; services: typeof services }
    >();
    for (const svc of services) {
      const catId = svc.categoryId ?? 0;
      if (!groupMap.has(catId)) {
        groupMap.set(catId, {
          categoryId: catId,
          categoryName: svc.categoryName ?? "أخرى",
          services: [],
        });
      }
      groupMap.get(catId)!.services.push({
        id: svc.id,
        name: svc.name,
        price: svc.price,
        durationMinutes: svc.durationMinutes,
        categoryId: svc.categoryId,
        categoryName: svc.categoryName,
      });
    }

    const groups = Array.from(groupMap.values());

    return NextResponse.json(
      { ok: true, services, groups },
      { headers: PUBLIC_CORS_HEADERS },
    );
  } catch (err) {
    console.error("[public/booking/services]", err);
    return NextResponse.json(
      { error: "فشل تحميل الخدمات" },
      { status: 500, headers: PUBLIC_CORS_HEADERS },
    );
  }
}
