import { NextRequest, NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import { MessageTemplateAdminError } from '@/modules/messaging/domain/templateTypes';
import { previewAdminWhatsAppTemplate } from '@/modules/messaging/application/adminWhatsAppTemplates';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from '../../access';

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

/**
 * POST /api/admin/whatsapp/templates/[templateKey]/preview
 * Renders with sample variables. Does not send WhatsApp.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const { templateKey: raw } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = previewAdminWhatsAppTemplate({
      templateKey: decodeTemplateKey(raw),
      content: body.content,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof MessageTemplateAdminError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[api/admin/whatsapp/templates/[templateKey]/preview POST]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}
