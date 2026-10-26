import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import {
  calculateSalonResearchScenario,
  ResearchScenarioError,
} from '@/platform/commercial/modularPricingScenario';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Operator-only, read-only scenario; NEVER a payment/activation/tenant mutation route. */
export async function POST(req: Request) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  let input: { industry: string; apps: string[]; branches: number; cycle: 'monthly' | 'annual' };
  try {
    const data: unknown = await req.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('body');
    const body = data as Record<string, unknown>;
    if (Object.keys(body).some((key) => !['industry', 'apps', 'branches', 'cycle'].includes(key)) ||
        body.industry !== 'salon' || !Array.isArray(body.apps) ||
        body.apps.length > 12 || body.apps.some((x) => typeof x !== 'string') ||
        !Number.isSafeInteger(body.branches) ||
        (body.cycle !== 'monthly' && body.cycle !== 'annual')) throw Error('invalid');
    input = { industry: body.industry, apps: body.apps as string[], branches: Number(body.branches), cycle: body.cycle };
  } catch {
    return NextResponse.json({ error: 'بيانات المقارنة غير صحيحة', code: 'INVALID_REQUEST' }, { status: 400, headers: NO_STORE });
  }

  try {
    return NextResponse.json(calculateSalonResearchScenario(input), { headers: NO_STORE });
  } catch (err) {
    if (err instanceof ResearchScenarioError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422, headers: NO_STORE });
    }
    console.error('[modular-research-scenario] failed', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'تعذر إعداد المقارنة' }, { status: 500, headers: NO_STORE });
  }
}
