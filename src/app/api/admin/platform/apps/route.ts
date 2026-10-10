import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { getInstallableAppCatalog } from '@/platform/apps/appCatalog';
import { getAppRegistryEntries } from '@/platform/registry/AppRegistry';

export const runtime = 'nodejs';

/** GET /api/admin/platform/apps — installable app catalog with install-time dependencies. */
export async function GET() {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const names = new Map(getAppRegistryEntries().map((e) => [e.appCode, e.displayName]));
  const apps = getInstallableAppCatalog().map((app) => ({
    ...app,
    displayName: names.get(app.appCode) ?? app.appCode,
  }));
  return NextResponse.json({ apps });
}
