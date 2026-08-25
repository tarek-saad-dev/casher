import { NextRequest, NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import { MessageTemplateAdminError } from '@/modules/messaging/domain/templateTypes';
import {
  deactivateAdminWhatsAppBranchOverride,
  getAdminWhatsAppTemplate,
  upsertAdminWhatsAppBranchOverride,
} from '@/modules/messaging/application/adminWhatsAppTemplates';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '../access';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ templateKey: string }> };

function decodeTemplateKey(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

function jsonError(err: unknown): NextResponse {
  if (err instanceof MessageTemplateAdminError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error('[api/admin/whatsapp/templates/[templateKey]]', err);
  return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
}

/**
 * GET /api/admin/whatsapp/templates/[templateKey]
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const { templateKey: raw } = await params;
    const template = await getAdminWhatsAppTemplate(admin.branchId, decodeTemplateKey(raw));
    return NextResponse.json({ ok: true, template });
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * PUT /api/admin/whatsapp/templates/[templateKey]
 * Create or update the current branch override. Global rows stay read-only.
 */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const { templateKey: raw } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const template = await upsertAdminWhatsAppBranchOverride({
      branchId: admin.branchId,
      userId: admin.userId,
      templateKey: decodeTemplateKey(raw),
      language: typeof body.language === 'string' ? body.language : undefined,
      content: body.content,
    });
    return NextResponse.json({ ok: true, template });
  } catch (err) {
    return jsonError(err);
  }
}

/**
 * DELETE /api/admin/whatsapp/templates/[templateKey]
 * Deactivates the current branch override (no physical delete).
 */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const { templateKey: raw } = await params;
    const template = await deactivateAdminWhatsAppBranchOverride({
      branchId: admin.branchId,
      userId: admin.userId,
      templateKey: decodeTemplateKey(raw),
    });
    return NextResponse.json({ ok: true, template });
  } catch (err) {
    return jsonError(err);
  }
}
