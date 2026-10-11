import 'server-only';
import { getPool, sql } from '@/lib/db';
import { listPlans } from '@/platform/commercial/planRepository';
import type { IndustryPackDefinition } from '@/platform/packs/types';
import { normalizeTenantCode } from '../validation';
import { resolveWizardApps, validateOnboardingRequest } from './plan';
import type { OnboardingIssue, OnboardingRequest } from './types';

export type OnboardingPreflightResult = {
  ok: boolean;
  issues: OnboardingIssue[];
  apps: string[] | null;
};

/** Validation that needs the database: identities that must be globally free. */
async function availabilityIssues(req: OnboardingRequest): Promise<OnboardingIssue[]> {
  const issues: OnboardingIssue[] = [];
  const pool = await getPool();

  const tenantCode = normalizeTenantCode(req.business.tenantCode ?? '');
  if (tenantCode) {
    const t = await pool
      .request()
      .input('code', sql.NVarChar(64), tenantCode)
      .query(`SELECT TenantId FROM dbo.Tenant WHERE Code = @code;`);
    if (t.recordset.length) {
      issues.push({ step: 'business', severity: 'error', field: 'tenantCode', message: 'كود المنشأة مستخدم بالفعل' });
    }
  }

  const logins = [req.owner.loginName, ...req.users.map((u) => u.loginName)]
    .map((l) => String(l ?? '').trim())
    .filter(Boolean);
  for (const [i, login] of logins.entries()) {
    const u = await pool
      .request()
      .input('loginName', sql.NVarChar(50), login)
      .query(`SELECT UserID FROM dbo.TblUser WHERE loginName = @loginName AND ISNULL(isDeleted, 0) = 0;`);
    if (u.recordset.length) {
      issues.push({
        step: 'users',
        severity: 'error',
        field: i === 0 ? 'owner.loginName' : `users.${i - 1}.loginName`,
        message: `اسم الدخول ${login} مستخدم بالفعل`,
      });
    }
  }

  for (const [i, br] of req.branches.entries()) {
    const code = String(br.branchCode ?? '').trim().toUpperCase();
    const name = String(br.branchName ?? '').trim();
    const shortName = br.shortName?.trim() || null;
    if (!code && !name) continue;
    const dup = await pool
      .request()
      .input('code', sql.NVarChar(30), code)
      .input('name', sql.NVarChar(100), name)
      .input('shortName', sql.NVarChar(50), shortName)
      .query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.TblBranch WHERE BranchCode = @code) AS CodeDup,
          (SELECT COUNT(*) FROM dbo.TblBranch WHERE BranchName = @name) AS NameDup,
          (SELECT COUNT(*) FROM dbo.TblBranch WHERE @shortName IS NOT NULL AND ShortName = @shortName) AS ShortDup;
      `);
    const row = dup.recordset[0] as { CodeDup: number; NameDup: number; ShortDup: number };
    const label = `الفرع ${i + 1}`;
    if (Number(row.CodeDup) > 0) {
      issues.push({ step: 'branches', severity: 'error', field: `branches.${i}.branchCode`, message: `${label}: كود الفرع مستخدم` });
    }
    if (Number(row.NameDup) > 0) {
      issues.push({ step: 'branches', severity: 'error', field: `branches.${i}.branchName`, message: `${label}: اسم الفرع مستخدم في منشأة أخرى` });
    }
    if (Number(row.ShortDup) > 0) {
      issues.push({ step: 'branches', severity: 'error', field: `branches.${i}.shortName`, message: `${label}: الاسم المختصر مستخدم` });
    }
  }
  return issues;
}

export async function preflightOnboarding(
  req: OnboardingRequest,
  findPack: (packCode: string) => IndustryPackDefinition | null,
): Promise<OnboardingPreflightResult> {
  const pack = findPack(req.business.industryPackCode ?? '');
  const planCode = String(req.subscription.planCode ?? '').trim().toLowerCase();
  const plan = (await listPlans(await getPool())).find((p) => p.isActive && p.planCode === planCode) ?? null;
  const issues = [...validateOnboardingRequest(req, { pack, plan }), ...(await availabilityIssues(req))];
  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    apps: resolveWizardApps(pack, req.apps),
  };
}
