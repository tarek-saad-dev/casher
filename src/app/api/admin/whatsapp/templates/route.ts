import { NextResponse } from 'next/server';
import { getUserFriendlyError } from '@/lib/db';
import { MessageTemplateAdminError } from '@/modules/messaging/domain/templateTypes';
import { listAdminWhatsAppTemplates } from '@/modules/messaging/application/adminWhatsAppTemplates';
import {
  isWhatsAppTemplateAdmin,
  requireWhatsAppTemplateAdmin,
} from './access';

export const runtime = 'nodejs';

/**
 * GET /api/admin/whatsapp/templates
 * Lists known WhatsApp templates with effective resolution for the session branch.
 */
export async function GET() {
  const admin = await requireWhatsAppTemplateAdmin();
  if (!isWhatsAppTemplateAdmin(admin)) return admin;

  try {
    const templates = await listAdminWhatsAppTemplates(admin.branchId);
    return NextResponse.json({ ok: true, templates });
  } catch (err) {
    if (err instanceof MessageTemplateAdminError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[api/admin/whatsapp/templates GET]', err);
    return NextResponse.json({ error: getUserFriendlyError(err) }, { status: 500 });
  }
}
