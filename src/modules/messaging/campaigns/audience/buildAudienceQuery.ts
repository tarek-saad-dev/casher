import { getPool, sql } from '@/lib/db';
import type { AudienceCriteria, AudienceMember } from '../domain/types';

const VALID_INVOICE = `h.invType = N'مبيعات' AND ISNULL(h.isActive, 'no') = 'no'`;

type QueryParts = {
  whereParts: string[];
  havingParts: string[];
  paramNames: string[];
};

function addRuleFilters(criteria: AudienceCriteria, parts: QueryParts): void {
  const rules = criteria.rules ?? [];
  if (rules.length === 0) return;

  const ruleWhereGroups: string[] = [];
  const ruleHavingGroups: string[] = [];

  rules.forEach((rule, index) => {
    const whereConds: string[] = [];
    const havingConds: string[] = [];

    if (rule.city) {
      parts.paramNames.push(`ruleCity${index}`);
      whereConds.push(`c.CameFrom = @ruleCity${index}`);
    }
    if (rule.maritalStatus) {
      parts.paramNames.push(`ruleMarital${index}`);
      whereConds.push(`c.State = @ruleMarital${index}`);
    }
    if (rule.cameFrom) {
      parts.paramNames.push(`ruleCameFrom${index}`);
      whereConds.push(`c.CameFrom = @ruleCameFrom${index}`);
    }
    if (rule.minVisits != null && Number.isFinite(rule.minVisits)) {
      havingConds.push(`COUNT(h.invID) >= ${Number(rule.minVisits)}`);
    }
    if (rule.minSpend != null && Number.isFinite(rule.minSpend)) {
      havingConds.push(`ISNULL(SUM(h.GrandTotal), 0) >= ${Number(rule.minSpend)}`);
    }
    if (rule.lastVisitFrom || rule.lastVisitTo) {
      if (rule.lastVisitFrom && rule.lastVisitTo) {
        parts.paramNames.push(`ruleLastFrom${index}`, `ruleLastTo${index}`);
        havingConds.push(`MAX(h.invDate) BETWEEN @ruleLastFrom${index} AND @ruleLastTo${index}`);
      } else if (rule.lastVisitFrom) {
        parts.paramNames.push(`ruleLastFrom${index}`);
        havingConds.push(`MAX(h.invDate) >= @ruleLastFrom${index}`);
      } else if (rule.lastVisitTo) {
        parts.paramNames.push(`ruleLastTo${index}`);
        havingConds.push(`MAX(h.invDate) <= @ruleLastTo${index}`);
      }
    }

    if (whereConds.length > 0) {
      ruleWhereGroups.push(`(${whereConds.join(' AND ')})`);
    }
    if (havingConds.length > 0) {
      ruleHavingGroups.push(`(${havingConds.join(' AND ')})`);
    }
  });

  if (ruleWhereGroups.length > 0) {
    parts.whereParts.push(`(${ruleWhereGroups.join(' OR ')})`);
  }
  if (ruleHavingGroups.length > 0) {
    parts.havingParts.push(`(${ruleHavingGroups.join(' OR ')})`);
  }
}

function addSegmentFilter(criteria: AudienceCriteria, parts: QueryParts): void {
  if (criteria.mode !== 'segment' || !criteria.segmentType) return;

  switch (criteria.segmentType) {
    case 'today':
      parts.havingParts.push('CAST(MAX(h.invDate) AS DATE) = @todayCairo');
      break;
    case 'this_week':
      parts.havingParts.push('MAX(h.invDate) >= @weekStart AND MAX(h.invDate) < @weekEnd');
      break;
    case 'two_weeks':
      parts.havingParts.push('MAX(h.invDate) >= DATEADD(day, -14, @todayCairo)');
      break;
    case 'one_month':
      parts.havingParts.push('MAX(h.invDate) >= DATEADD(month, -1, @todayCairo)');
      break;
    default:
      break;
  }
}

function addAgeFilter(criteria: AudienceCriteria, parts: QueryParts): void {
  if (criteria.minAge != null && criteria.maxAge != null) {
    parts.havingParts.push(
      `DATEDIFF(year, c.BirthDate, GETDATE()) BETWEEN ${Number(criteria.minAge)} AND ${Number(criteria.maxAge)}`,
    );
  } else if (criteria.minAge != null) {
    parts.havingParts.push(
      `DATEDIFF(year, c.BirthDate, GETDATE()) >= ${Number(criteria.minAge)}`,
    );
  } else if (criteria.maxAge != null) {
    parts.havingParts.push(
      `DATEDIFF(year, c.BirthDate, GETDATE()) <= ${Number(criteria.maxAge)}`,
    );
  }
}

function addNotVisitedFilter(criteria: AudienceCriteria, parts: QueryParts): void {
  if (criteria.notVisitedSinceDays == null || !Number.isFinite(criteria.notVisitedSinceDays)) {
    return;
  }
  parts.havingParts.push(
    `(MAX(h.invDate) IS NULL OR MAX(h.invDate) < DATEADD(day, -${Number(criteria.notVisitedSinceDays)}, @todayCairo))`,
  );
}

function addBranchFilter(criteria: AudienceCriteria, parts: QueryParts): void {
  if (criteria.branchId == null || !Number.isFinite(criteria.branchId)) return;
  parts.havingParts.push('COUNT(h.invID) > 0');
}

export function buildAudienceQuerySql(criteria: AudienceCriteria): string {
  const parts: QueryParts = { whereParts: [], havingParts: [], paramNames: [] };

  if (criteria.mode === 'rules') {
    addRuleFilters(criteria, parts);
  } else if (criteria.mode === 'segment') {
    addSegmentFilter(criteria, parts);
  }

  addAgeFilter(criteria, parts);
  addNotVisitedFilter(criteria, parts);
  addBranchFilter(criteria, parts);

  const whereClause =
    parts.whereParts.length > 0 ? `WHERE ${parts.whereParts.join(' AND ')}` : '';
  const havingClause =
    parts.havingParts.length > 0 ? `HAVING ${parts.havingParts.join(' AND ')}` : '';

  const branchJoin =
    criteria.branchId != null && Number.isFinite(criteria.branchId)
      ? 'AND h.BranchID = @branchId'
      : '';

  return `
    SELECT
      c.ClientID AS clientId,
      COALESCE(NULLIF(LTRIM(RTRIM(c.Mobile)), N''), NULLIF(LTRIM(RTRIM(c.Phone)), N'')) AS phone,
      c.Name AS name,
      COUNT(h.invID) AS visitCount,
      ISNULL(SUM(h.GrandTotal), 0) AS totalSpend,
      MAX(h.invDate) AS lastVisitDate
    FROM dbo.TblClient c
    LEFT JOIN dbo.TblinvServHead h
      ON c.ClientID = h.ClientID
      AND ${VALID_INVOICE}
      ${branchJoin}
    ${whereClause}
    GROUP BY
      c.ClientID,
      c.Mobile,
      c.Phone,
      c.Name,
      c.BirthDate,
      c.State,
      c.CameFrom,
      c.RegisterDate
    ${havingClause}
    ORDER BY c.ClientID
  `.trim();
}

function bindAudienceParams(req: sql.Request, criteria: AudienceCriteria): void {
  req.input('branchId', sql.Int, criteria.branchId ?? null);

  const today = new Date();
  const utcMs = today.getTime() + today.getTimezoneOffset() * 60000;
  const cairoNow = new Date(utcMs + 3 * 60 * 60000);
  const todayCairo = new Date(cairoNow.getFullYear(), cairoNow.getMonth(), cairoNow.getDate());
  const weekStart = new Date(todayCairo);
  const day = weekStart.getDay();
  const diffToSaturday = (day + 1) % 7;
  weekStart.setDate(weekStart.getDate() - diffToSaturday);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  req.input('todayCairo', sql.Date, todayCairo);
  req.input('weekStart', sql.Date, weekStart);
  req.input('weekEnd', sql.Date, weekEnd);

  const rules = criteria.rules ?? [];
  rules.forEach((rule, index) => {
    if (rule.city) {
      req.input(`ruleCity${index}`, sql.NVarChar(200), rule.city);
    }
    if (rule.maritalStatus) {
      req.input(`ruleMarital${index}`, sql.NVarChar(100), rule.maritalStatus);
    }
    if (rule.cameFrom) {
      req.input(`ruleCameFrom${index}`, sql.NVarChar(200), rule.cameFrom);
    }
    if (rule.lastVisitFrom) {
      req.input(`ruleLastFrom${index}`, sql.Date, rule.lastVisitFrom);
    }
    if (rule.lastVisitTo) {
      req.input(`ruleLastTo${index}`, sql.Date, rule.lastVisitTo);
    }
  });
}

export async function executeAudienceQuery(
  criteria: AudienceCriteria,
): Promise<AudienceMember[]> {
  const pool = await getPool();
  const req = pool.request();
  bindAudienceParams(req, criteria);
  const query = buildAudienceQuerySql(criteria);
  const result = await req.query(query);

  return (result.recordset ?? []).map((row: Record<string, unknown>) => ({
    clientId: Number(row.clientId),
    phone: String(row.phone ?? ''),
    name: String(row.name ?? ''),
    visitCount: Number(row.visitCount ?? 0),
    totalSpend: Number(row.totalSpend ?? 0),
    lastVisitDate: row.lastVisitDate
      ? new Date(row.lastVisitDate as string | Date).toISOString()
      : null,
  }));
}
