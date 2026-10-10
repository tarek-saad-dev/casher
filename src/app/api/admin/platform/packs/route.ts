import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { INDUSTRY_PACKS } from '@/packs';
import { validatePackDefinition } from '@/platform/apps/compositionResolver';

export const runtime = 'nodejs';

/** GET /api/admin/platform/packs — source-controlled Industry Pack recipes. */
export async function GET() {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const packs = INDUSTRY_PACKS.map((pack) => ({
    ...pack,
    validation: validatePackDefinition(pack),
  }));
  return NextResponse.json({ packs });
}
