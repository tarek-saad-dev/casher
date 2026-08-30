import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import { mutateKnowledge, patchKnowledgeStatus } from '@/modules/messaging/ai/salonConcierge/adminMutations';
import type { KnowledgeItem } from '@/modules/messaging/ai/salonConcierge/types';

export const runtime = 'nodejs';

/** POST create/update knowledge item. Admin only. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  const body = (await req.json()) as Partial<KnowledgeItem>;
  if (!body.key || !body.title || !body.answerText || !body.category) {
    return NextResponse.json(
      { error: 'key, title, category, answerText required', code: 'VALIDATION' },
      { status: 400 },
    );
  }

  const item = await mutateKnowledge({
    key: body.key,
    title: body.title,
    answerText: body.answerText,
    category: body.category,
    branchId: body.branchId ?? null,
    branchCode: body.branchCode ?? null,
    employeeId: body.employeeId ?? null,
    language: body.language ?? 'ar',
    subject: body.subject ?? null,
    aliases: body.aliases ?? [],
    tags: body.tags ?? [],
    source: 'curated',
    status: body.status === 'draft' ? 'draft' : 'active',
    priority: body.priority ?? 100,
    validFrom: body.validFrom ?? null,
    validTo: body.validTo ?? null,
  });
  return NextResponse.json({ ok: true, item });
}

/** PATCH activate/deactivate by key */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  const body = (await req.json()) as { key?: string; status?: 'active' | 'inactive' | 'draft' };
  if (!body.key || !body.status) {
    return NextResponse.json({ error: 'key and status required' }, { status: 400 });
  }
  const ok = await patchKnowledgeStatus(body.key, body.status);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
