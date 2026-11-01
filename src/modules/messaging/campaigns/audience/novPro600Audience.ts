import 'server-only';

import { getPool, sql } from '@/lib/db';
import { bindMessagingTenant } from '@/modules/messaging/tenancy/tenantSql';
import type { AudienceMember } from '../domain/types';
import {
  NOV_PRO600_SEGMENTS,
  type NovPro600Segment,
} from '../domain/types';
import { normalizePhoneDigits } from './normalizePhone';

export const NOV_PRO600_CAMPAIGN_CODE = 'NOV-PRO600' as const;
export const NOV_PRO600_PACKAGE_ID = 8 as const;

export type NovPro600AudienceRow = AudienceMember & {
  segment: NovPro600Segment;
  firstName: string;
  branchName: string | null;
  sendEligible: boolean;
  consentEvidence: string | null;
  exclusionReason: string | null;
  optedOut: boolean;
};

export type NovPro600AudiencePreview = {
  campaignCode: typeof NOV_PRO600_CAMPAIGN_CODE;
  packageId: typeof NOV_PRO600_PACKAGE_ID;
  asOfDate: string;
  matchingCount: number;
  sendEligibleCount: number;
  optedOutCount: number;
  suppressedCount: number;
  /** Alias used by existing UI — send-eligible only */
  count: number;
  bySegment: Record<
    NovPro600Segment,
    { matching: number; sendEligible: number; optedOut: number; suppressed: number }
  >;
  sample: Array<{
    clientId: number;
    name: string;
    phoneMasked: string;
    segment: NovPro600Segment;
    branchName: string | null;
    sendEligible: boolean;
    exclusionReason: string | null;
  }>;
  consentBlocker: string | null;
};

function maskPhone(phone: string): string {
  const d = normalizePhoneDigits(phone);
  if (d.length < 6) return '****';
  return `${d.slice(0, 4)}****${d.slice(-2)}`;
}

function firstNameFromDisplay(name: string): string {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'عميلنا';
  return trimmed.split(/\s+/)[0] || 'عميلنا';
}

function normalizeSegments(input?: NovPro600Segment[] | null): NovPro600Segment[] {
  const set = new Set<NovPro600Segment>();
  for (const s of input ?? NOV_PRO600_SEGMENTS) {
    if ((NOV_PRO600_SEGMENTS as readonly string[]).includes(s)) {
      set.add(s as NovPro600Segment);
    }
  }
  return set.size > 0 ? [...set] : [...NOV_PRO600_SEGMENTS];
}

/**
 * Live NOV-PRO600 behavioral audience with mutual exclusivity + phone dedupe.
 * Consent: granted evidence required for sendEligible; revoked = opted out;
 * missing evidence = not send-eligible (not opted-out).
 */
export async function queryNovPro600Audience(input?: {
  segments?: NovPro600Segment[] | null;
  asOfDate?: string | null;
  sendEligibleOnly?: boolean;
}): Promise<NovPro600AudienceRow[]> {
  const segments = normalizeSegments(input?.segments);
  const asOf = String(input?.asOfDate ?? '2026-11-01').slice(0, 10);
  const pool = await getPool();

  const consentTableExists = await bindMessagingTenant(
    pool.request(),
    'campaigns.novPro600.consentTableCheck',
  ).query(`
    SELECT CASE WHEN OBJECT_ID(N'dbo.TblMarketingConsentEvidence', N'U') IS NULL THEN 0 ELSE 1 END AS ok
  `);
  const hasConsentTable = Number(consentTableExists.recordset?.[0]?.ok ?? 0) === 1;

  const req = bindMessagingTenant(pool.request(), 'campaigns.novPro600.query')
    .input('asOfDate', sql.Date, asOf)
    .input('wantVip', sql.Bit, segments.includes('VIP') ? 1 : 0)
    .input('wantHairCare', sql.Bit, segments.includes('HAIR_CARE') ? 1 : 0)
    .input('wantHaircut', sql.Bit, segments.includes('HAIRCUT_REGULAR') ? 1 : 0);

  const consentCte = hasConsentTable
    ? `
ConsentLatest AS (
  SELECT *
  FROM (
    SELECT
      e.ClientID,
      e.PhoneE164,
      e.Status,
      e.EvidenceSource,
      e.EvidenceRef,
      e.GrantedAt,
      e.RevokedAt,
      ROW_NUMBER() OVER (
        PARTITION BY e.PhoneE164
        ORDER BY
          CASE WHEN e.Status = N'revoked' THEN 0 ELSE 1 END,
          COALESCE(e.RevokedAt, e.GrantedAt) DESC,
          e.ID DESC
      ) AS rn
    FROM dbo.TblMarketingConsentEvidence e
    WHERE e.TenantId = @tenantId
  ) x
  WHERE rn = 1
),`
    : `
ConsentLatest AS (
  SELECT
    CAST(NULL AS int) AS ClientID,
    CAST(NULL AS nvarchar(20)) AS PhoneE164,
    CAST(NULL AS nvarchar(20)) AS Status,
    CAST(NULL AS nvarchar(80)) AS EvidenceSource,
    CAST(NULL AS nvarchar(200)) AS EvidenceRef,
    CAST(NULL AS datetime2) AS GrantedAt,
    CAST(NULL AS datetime2) AS RevokedAt
  WHERE 1 = 0
),`;

  const result = await req.query(`
    ;WITH
    PaidInv AS (
      SELECT h.invID, h.ClientID, CAST(h.invDate AS date) AS InvDate, h.GrandTotal, h.BranchID
      FROM dbo.TblinvServHead h
      INNER JOIN dbo.TblClient c ON c.ClientID = h.ClientID AND c.TenantId = @tenantId
      WHERE h.invType = N'مبيعات'
        AND ISNULL(h.isActive, N'no') = N'no'
        AND h.ClientID IS NOT NULL
        AND CAST(h.invDate AS date) <= @asOfDate
    ),
    PaidInvSvc AS (
      SELECT p.invID, p.ClientID, p.InvDate, p.GrandTotal, p.BranchID, d.ProID
      FROM PaidInv p
      INNER JOIN dbo.TblinvServDetail d ON d.invID = p.invID AND d.invType = N'مبيعات'
    ),
    PhoneE164 AS (
      SELECT
        x.ClientID,
        x.Name,
        CASE
          WHEN x.d LIKE N'01%' AND LEN(x.d) = 11 THEN N'20' + SUBSTRING(x.d, 2, 10)
          WHEN x.d LIKE N'201%' AND LEN(x.d) = 12 THEN x.d
          WHEN x.d LIKE N'20%' AND LEN(x.d) = 12 AND SUBSTRING(x.d, 3, 1) = N'1' THEN x.d
          ELSE NULL
        END AS PhoneE164
      FROM (
        SELECT
          ClientID,
          Name,
          REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
            ISNULL(COALESCE(NULLIF(LTRIM(RTRIM(Mobile)), N''), NULLIF(LTRIM(RTRIM(Phone)), N'')), N''),
            N'+', N''), N' ', N''), N'-', N''), N'(', N''), N')', N''), N'.', N'') AS d
        FROM dbo.TblClient
        WHERE TenantId = @tenantId
      ) x
    ),
    Canonical AS (
      SELECT ClientID, Name, PhoneE164
      FROM (
        SELECT
          e.ClientID,
          e.Name,
          e.PhoneE164,
          ROW_NUMBER() OVER (
            PARTITION BY e.PhoneE164
            ORDER BY MAX(p.InvDate) DESC, e.ClientID DESC
          ) AS rn
        FROM PhoneE164 e
        LEFT JOIN PaidInv p ON p.ClientID = e.ClientID
        WHERE e.PhoneE164 IS NOT NULL
        GROUP BY e.ClientID, e.Name, e.PhoneE164
      ) r
      WHERE rn = 1
    ),
    VisitAgg AS (
      SELECT
        ClientID,
        MAX(InvDate) AS LastPaidVisit,
        COUNT(DISTINCT invID) AS TotalPaidVisits,
        COUNT(DISTINCT CASE WHEN InvDate >= DATEADD(day, -365, @asOfDate) THEN invID END) AS Visits365,
        SUM(GrandTotal) AS TotalSpend,
        AVG(1.0 * GrandTotal) AS AvgInvoiceValue,
        (
          SELECT TOP 1 p2.BranchID
          FROM PaidInv p2
          WHERE p2.ClientID = p.ClientID
          ORDER BY p2.InvDate DESC, p2.invID DESC
        ) AS PreferredBranchID
      FROM PaidInv p
      GROUP BY ClientID
    ),
    HaircutAgg AS (
      SELECT ClientID, COUNT(DISTINCT invID) AS Haircuts180
      FROM PaidInvSvc
      WHERE ProID = 9 AND InvDate >= DATEADD(day, -180, @asOfDate)
      GROUP BY ClientID
    ),
    ProteinAgg AS (
      SELECT ClientID, MAX(InvDate) AS LastProteinDate
      FROM PaidInvSvc
      WHERE ProID IN (15, 16, 1077, 1113)
      GROUP BY ClientID
    ),
    FutureActive AS (
      SELECT DISTINCT b.ClientID
      FROM dbo.Bookings b
      INNER JOIN dbo.TblClient c ON c.ClientID = b.ClientID AND c.TenantId = @tenantId
      WHERE b.ClientID IS NOT NULL
        AND b.BookingDate >= @asOfDate
        AND LOWER(b.Status) IN (N'confirmed', N'pending', N'arrived', N'queued')
    ),
    NovBooked AS (
      SELECT DISTINCT b.ClientID
      FROM dbo.Bookings b
      INNER JOIN dbo.TblClient c ON c.ClientID = b.ClientID AND c.TenantId = @tenantId
      WHERE b.ClientID IS NOT NULL
        AND LOWER(b.Status) NOT IN (N'cancelled', N'canceled', N'no-show', N'noshow', N'no_show')
        AND (b.Notes LIKE N'%NOV-PRO600%' OR b.Notes LIKE N'%packageId=8;%')
    ),
    ${consentCte}
    Base AS (
      SELECT
        cc.ClientID,
        cc.Name,
        cc.PhoneE164,
        va.LastPaidVisit,
        ISNULL(va.TotalPaidVisits, 0) AS TotalPaidVisits,
        ISNULL(va.Visits365, 0) AS Visits365,
        ISNULL(va.TotalSpend, 0) AS TotalSpend,
        ha.Haircuts180,
        pr.LastProteinDate,
        br.BranchName AS BranchName,
        br.BranchCode AS BranchCode,
        DATEDIFF(day, va.LastPaidVisit, @asOfDate) AS DaysSinceLastVisit,
        CASE WHEN fa.ClientID IS NOT NULL THEN 1 ELSE 0 END AS HasFutureActiveBooking,
        CASE WHEN nb.ClientID IS NOT NULL THEN 1 ELSE 0 END AS HasNovBooking,
        cl.Status AS ConsentStatus,
        cl.EvidenceSource,
        cl.EvidenceRef
      FROM Canonical cc
      INNER JOIN VisitAgg va ON va.ClientID = cc.ClientID
      LEFT JOIN HaircutAgg ha ON ha.ClientID = cc.ClientID
      LEFT JOIN ProteinAgg pr ON pr.ClientID = cc.ClientID
      LEFT JOIN dbo.TblBranch br ON br.BranchID = va.PreferredBranchID
      LEFT JOIN FutureActive fa ON fa.ClientID = cc.ClientID
      LEFT JOIN NovBooked nb ON nb.ClientID = cc.ClientID
      LEFT JOIN ConsentLatest cl ON cl.PhoneE164 = cc.PhoneE164
      WHERE va.TotalPaidVisits > 0
    ),
    Assigned AS (
      SELECT
        *,
        CASE
          WHEN Visits365 >= 5 AND DaysSinceLastVisit BETWEEN 30 AND 150 THEN N'VIP'
          WHEN LastProteinDate IS NOT NULL
            AND DATEDIFF(day, LastProteinDate, @asOfDate) BETWEEN 120 AND 365 THEN N'HAIR_CARE'
          WHEN ISNULL(Haircuts180, 0) >= 2 AND DaysSinceLastVisit BETWEEN 30 AND 90 THEN N'HAIRCUT_REGULAR'
          ELSE NULL
        END AS Segment
      FROM Base
    )
    SELECT
      ClientID,
      Name,
      PhoneE164,
      Segment,
      BranchName,
      BranchCode,
      TotalPaidVisits,
      TotalSpend,
      LastPaidVisit,
      ConsentStatus,
      EvidenceSource,
      EvidenceRef,
      HasFutureActiveBooking,
      HasNovBooking
    FROM Assigned
    WHERE Segment IS NOT NULL
      AND (
        (Segment = N'VIP' AND @wantVip = 1)
        OR (Segment = N'HAIR_CARE' AND @wantHairCare = 1)
        OR (Segment = N'HAIRCUT_REGULAR' AND @wantHaircut = 1)
      )
    ORDER BY Segment, ClientID
  `);

  const rows: NovPro600AudienceRow[] = (result.recordset ?? []).map((row: Record<string, unknown>) => {
    const name = String(row.Name ?? '');
    const phone = String(row.PhoneE164 ?? '');
    const consentStatus = row.ConsentStatus != null ? String(row.ConsentStatus) : null;
    const evidenceSource = row.EvidenceSource != null ? String(row.EvidenceSource) : null;
    const evidenceRef = row.EvidenceRef != null ? String(row.EvidenceRef) : null;
    const hasFuture = Number(row.HasFutureActiveBooking ?? 0) === 1;
    const hasNov = Number(row.HasNovBooking ?? 0) === 1;
    const optedOut = consentStatus === 'revoked';
    const hasGranted = consentStatus === 'granted';

    let exclusionReason: string | null = null;
    if (!phone) exclusionReason = 'invalid_phone';
    else if (hasFuture) exclusionReason = 'future_booking';
    else if (hasNov) exclusionReason = 'nov_pro600_booked';
    else if (optedOut) exclusionReason = 'marketing_opt_out';
    else if (!hasGranted) exclusionReason = 'missing_marketing_consent';

    const sendEligible = exclusionReason == null;

    const consentEvidence =
      hasGranted && evidenceSource
        ? `${evidenceSource}${evidenceRef ? `:${evidenceRef}` : ''}`
        : null;

    return {
      clientId: Number(row.ClientID),
      phone,
      name,
      firstName: firstNameFromDisplay(name),
      branchName: row.BranchName != null ? String(row.BranchName) : row.BranchCode != null ? String(row.BranchCode) : null,
      visitCount: Number(row.TotalPaidVisits ?? 0),
      totalSpend: Number(row.TotalSpend ?? 0),
      lastVisitDate: row.LastPaidVisit
        ? new Date(row.LastPaidVisit as string | Date).toISOString()
        : null,
      segment: String(row.Segment) as NovPro600Segment,
      sendEligible,
      consentEvidence,
      exclusionReason,
      optedOut,
    };
  });

  if (input?.sendEligibleOnly) {
    return rows.filter((r) => r.sendEligible);
  }
  return rows;
}

export async function previewNovPro600Audience(input?: {
  segments?: NovPro600Segment[] | null;
  asOfDate?: string | null;
}): Promise<NovPro600AudiencePreview> {
  const rows = await queryNovPro600Audience({
    segments: input?.segments,
    asOfDate: input?.asOfDate,
    sendEligibleOnly: false,
  });

  const bySegment: NovPro600AudiencePreview['bySegment'] = {
    VIP: { matching: 0, sendEligible: 0, optedOut: 0, suppressed: 0 },
    HAIR_CARE: { matching: 0, sendEligible: 0, optedOut: 0, suppressed: 0 },
    HAIRCUT_REGULAR: { matching: 0, sendEligible: 0, optedOut: 0, suppressed: 0 },
  };

  for (const row of rows) {
    const bucket = bySegment[row.segment];
    bucket.matching += 1;
    if (row.sendEligible) bucket.sendEligible += 1;
    if (row.optedOut) bucket.optedOut += 1;
    if (!row.sendEligible) bucket.suppressed += 1;
  }

  const matchingCount = rows.length;
  const sendEligibleCount = rows.filter((r) => r.sendEligible).length;
  const optedOutCount = rows.filter((r) => r.optedOut).length;
  const suppressedCount = rows.filter((r) => !r.sendEligible).length;

  return {
    campaignCode: NOV_PRO600_CAMPAIGN_CODE,
    packageId: NOV_PRO600_PACKAGE_ID,
    asOfDate: String(input?.asOfDate ?? '2026-11-01').slice(0, 10),
    matchingCount,
    sendEligibleCount,
    optedOutCount,
    suppressedCount,
    count: sendEligibleCount,
    bySegment,
    sample: rows.slice(0, 25).map((r) => ({
      clientId: r.clientId,
      name: r.name,
      phoneMasked: maskPhone(r.phone),
      segment: r.segment,
      branchName: r.branchName,
      sendEligible: r.sendEligible,
      exclusionReason: r.exclusionReason,
    })),
    consentBlocker:
      sendEligibleCount === 0 && matchingCount > 0
        ? 'لا توجد أدلة موافقة تسويقية قابلة للتحقق — المستلمون غير مؤهلين للإرسال.'
        : matchingCount === 0
          ? null
          : sendEligibleCount === 0
            ? 'لا يوجد مستلمون مؤهلون بعد الاستثناءات والموافقة.'
            : null,
  };
}
