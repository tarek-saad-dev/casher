import { NextResponse } from 'next/server';
import { authenticate, isAuthResult } from '@/lib/api-auth';
import { assetUrisForTemplate, resolvePublishedStudio } from '@/lib/receipt-studio/storage';

export const runtime = 'nodejs';

/** Scope is always the signed-in user's active tenant and active cashier branch. */
export async function GET() {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth;
  try {
    const published = await resolvePublishedStudio(auth.tenantId, auth.activeBranchId);
    if (!published) return NextResponse.json({ ok: true, published: null }, { headers: { 'Cache-Control': 'no-store' } });
    const assets = await assetUrisForTemplate(auth.tenantId, published.template);
    return NextResponse.json(
      { ok: true, published: published.template, version: published.version, scope: published.branchScope, assets },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    // Missing optional schema or a failed lookup must not interrupt cashier operations.
    console.warn('[receipt-studio active] Legacy invoice fallback:', error instanceof Error ? error.message : 'unexpected');
    return NextResponse.json({ ok: true, published: null, legacyFallback: true }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
