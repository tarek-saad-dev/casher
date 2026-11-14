import { NextResponse } from 'next/server';
import { authenticate, isAuthResult } from '@/lib/api-auth';
import { getPool, sql } from '@/lib/db';

export const runtime = 'nodejs';

// Suggestions are sourced from saved customers, never from a hard-coded enum.
// Query is tenant-bound so separate businesses cannot see each other's names.
export async function GET() {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth;
  try {
    const db = await getPool();
    const [institutions, occupations] = await Promise.all([
      db.request().input('tenantId', sql.UniqueIdentifier, auth.tenantId).query(`
        SELECT TOP (500) EducationLevel, InstitutionName
        FROM dbo.TblClient
        WHERE TenantId = @tenantId AND CustomerCategory = N'student'
          AND EducationLevel IN (N'school', N'college')
          AND InstitutionName IS NOT NULL AND LTRIM(RTRIM(InstitutionName)) <> N''
        GROUP BY EducationLevel, InstitutionName
        ORDER BY COUNT(*) DESC, InstitutionName ASC
      `),
      db.request().input('tenantId', sql.UniqueIdentifier, auth.tenantId).query(`
        SELECT TOP (500) Occupation
        FROM dbo.TblClient
        WHERE TenantId = @tenantId AND CustomerCategory = N'adult'
          AND Occupation IS NOT NULL AND LTRIM(RTRIM(Occupation)) <> N''
        GROUP BY Occupation
        ORDER BY COUNT(*) DESC, Occupation ASC
      `),
    ]);
    const rows = institutions.recordset as { EducationLevel: string; InstitutionName: string }[];
    return NextResponse.json({
      schools: rows.filter((row) => row.EducationLevel === 'school').map((row) => row.InstitutionName),
      colleges: rows.filter((row) => row.EducationLevel === 'college').map((row) => row.InstitutionName),
      occupations: (occupations.recordset as { Occupation: string }[]).map((row) => row.Occupation),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: unknown) {
    console.error('[customers/profile-options] GET', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'تعذر تحميل الاقتراحات' }, { status: 500 });
  }
}
