/**
 * PATCH /api/client/update
 * Public client website profile update — no staff session required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateClientWebsiteProfile } from '@/lib/client/publicClientWebsite.service';
import { resolvePublicCatalogTenantId } from '@/lib/catalog/publicCatalogTenant';
import {
  pickEditableClientUpdateFields,
  validateClientWebsiteEmail,
} from '@/lib/client/publicClientWebsite.helpers';
import { isPublicClientWebsiteUpdateRateLimited } from '@/lib/client/publicClientWebsiteRateLimit';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest) {
  if (isPublicClientWebsiteUpdateRateLimited(req)) {
    return NextResponse.json(
      { ok: false, message: 'Too many requests' },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const rawClientId = body.clientId;
  if (rawClientId === undefined || rawClientId === null || rawClientId === '') {
    return NextResponse.json(
      { ok: false, message: 'clientId is required' },
      { status: 400 },
    );
  }

  const clientId = Number(rawClientId);
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return NextResponse.json(
      { ok: false, message: 'clientId is required' },
      { status: 400 },
    );
  }

  const { fields, hasEditableField } = pickEditableClientUpdateFields(body);
  if (!hasEditableField) {
    return NextResponse.json(
      { ok: false, message: 'No fields to update' },
      { status: 400 },
    );
  }

  if (fields.name !== undefined && fields.name.length === 0) {
    return NextResponse.json(
      { ok: false, message: 'name cannot be empty' },
      { status: 400 },
    );
  }

  const emailError = validateClientWebsiteEmail(fields.email);
  if (emailError) {
    return NextResponse.json({ ok: false, message: emailError }, { status: 400 });
  }

  try {
    const tenantParams = new URLSearchParams(req.nextUrl.searchParams);
    if (typeof body.branchCode === 'string' && !tenantParams.has('branchCode')) {
      tenantParams.set('branchCode', body.branchCode);
    }
    const tenantId = await resolvePublicCatalogTenantId(tenantParams, 'PATCH /api/client/update');
    if (!tenantId) {
      return NextResponse.json({ ok: false, message: 'Client not found' }, { status: 404 });
    }

    const result = await updateClientWebsiteProfile(tenantId, {
      clientId,
      ...fields,
    });

    if (!result.ok) {
      const status =
        result.message === 'No fields to update' ||
        result.message === 'name cannot be empty' ||
        result.message === 'Invalid email' ||
        result.message === 'email is not supported'
          ? 400
          : 500;
      const message =
        result.message === 'Client not found' ? 'Database error' : result.message;
      return NextResponse.json({ ok: false, message }, { status });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error('[api/client/update] PATCH error:', err);
    return NextResponse.json(
      { ok: false, message: 'Database error' },
      { status: 500 },
    );
  }
}
