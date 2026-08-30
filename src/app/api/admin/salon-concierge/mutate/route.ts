import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import {
  convertGapToKnowledge,
  mutateBrandVoice,
  mutateCapability,
  mutateGapStatus,
  mutateKnowledge,
  mutateLink,
  mutateOffer,
  mutateSource,
  mutateVoiceExample,
  patchKnowledgeStatus,
  deleteKnowledge,
} from '@/modules/messaging/ai/salonConcierge/adminMutations';
import type { BrandVoiceProfile, ExternalLinkItem } from '@/modules/messaging/ai/salonConcierge/types';
import { DEFAULT_BRAND_VOICE } from '@/modules/messaging/ai/salonConcierge/defaults';

export const runtime = 'nodejs';

type MutateBody = {
  entity?: string;
  action?: string;
  payload?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  const body = (await req.json().catch(() => ({}))) as MutateBody;
  const entity = String(body.entity || '');
  const action = String(body.action || 'upsert');
  const p = body.payload ?? {};

  try {
    if (entity === 'knowledge') {
      if (action === 'status') {
        const ok = await patchKnowledgeStatus(String(p.key), p.status as 'active' | 'inactive' | 'draft');
        if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
        return NextResponse.json({ ok: true });
      }
      if (action === 'delete') {
        const ok = await deleteKnowledge(String(p.key));
        if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
        return NextResponse.json({ ok: true, deleted: true });
      }
      const item = await mutateKnowledge({
        key: String(p.key),
        title: String(p.title),
        answerText: String(p.answerText),
        category: String(p.category),
        subject: p.subject != null ? String(p.subject) : null,
        aliases: Array.isArray(p.aliases) ? p.aliases.map(String) : String(p.aliases || '').split(',').map((s) => s.trim()).filter(Boolean),
        tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
        branchCode: p.branchCode ? String(p.branchCode) : null,
        employeeId: p.employeeId != null ? Number(p.employeeId) : null,
        status: (p.status as 'active' | 'draft' | 'inactive') ?? 'active',
        priority: p.priority != null ? Number(p.priority) : 100,
        validFrom: p.validFrom ? String(p.validFrom) : null,
        validTo: p.validTo ? String(p.validTo) : null,
      });
      return NextResponse.json({ ok: true, item });
    }

    if (entity === 'capability') {
      const item = await mutateCapability({
        key: String(p.key),
        displayNameAr: String(p.displayNameAr),
        aliases: Array.isArray(p.aliases) ? p.aliases.map(String) : String(p.aliases || '').split(',').map((s) => s.trim()).filter(Boolean),
        descriptionAr: p.descriptionAr != null ? String(p.descriptionAr) : null,
        employeeNames: Array.isArray(p.employeeNames) ? p.employeeNames.map(String) : String(p.employeeNames || '').split(',').map((s) => s.trim()).filter(Boolean),
        branchCodes: Array.isArray(p.branchCodes) ? p.branchCodes.map(String) : String(p.branchCodes || '').split(',').map((s) => s.trim()).filter(Boolean),
        status: (p.status as 'active' | 'draft' | 'inactive') ?? 'active',
      });
      return NextResponse.json({ ok: true, item });
    }

    if (entity === 'link') {
      const item = await mutateLink({
        key: String(p.key),
        linkType: String(p.linkType) as ExternalLinkItem['linkType'],
        labelAr: String(p.labelAr),
        url: String(p.url),
        branchCode: p.branchCode ? String(p.branchCode) : null,
        status: (p.status as 'active' | 'inactive') ?? 'active',
      });
      return NextResponse.json({ ok: true, item });
    }

    if (entity === 'offer') {
      const item = await mutateOffer({
        key: String(p.key),
        titleAr: String(p.titleAr),
        descriptionAr: String(p.descriptionAr),
        branchCodes: Array.isArray(p.branchCodes) ? p.branchCodes.map(String) : String(p.branchCodes || '').split(',').map((s) => s.trim()).filter(Boolean),
        validFrom: p.validFrom ? String(p.validFrom) : null,
        validTo: p.validTo ? String(p.validTo) : null,
        status: (p.status as 'active' | 'inactive' | 'draft') ?? 'active',
        priority: p.priority != null ? Number(p.priority) : 100,
      });
      return NextResponse.json({ ok: true, item });
    }

    if (entity === 'voice') {
      const item = await mutateBrandVoice({ ...DEFAULT_BRAND_VOICE, ...(p as Partial<BrandVoiceProfile>) });
      return NextResponse.json({ ok: true, item });
    }

    if (entity === 'example') {
      const item = await mutateVoiceExample({
        id: p.id != null ? Number(p.id) : undefined,
        scenarioKey: String(p.scenarioKey),
        category: String(p.category),
        customerMessage: String(p.customerMessage),
        preferredResponse: String(p.preferredResponse),
        notes: p.notes != null ? String(p.notes) : null,
        priority: p.priority != null ? Number(p.priority) : 100,
        isActive: p.isActive !== false,
      });
      return NextResponse.json({ ok: true, item });
    }

    if (entity === 'source') {
      const item = await mutateSource({
        id: p.id != null ? Number(p.id) : undefined,
        name: String(p.name),
        sourceType: String(p.sourceType),
        urlOrRef: p.urlOrRef != null ? String(p.urlOrRef) : null,
        branchCode: p.branchCode ? String(p.branchCode) : null,
        active: p.active !== false,
        notes: p.notes != null ? String(p.notes) : null,
      });
      return NextResponse.json({ ok: true, item });
    }

    if (entity === 'gap') {
      if (action === 'convert') {
        const item = await convertGapToKnowledge({
          normalizedSubject: String(p.normalizedSubject),
          key: String(p.key),
          title: String(p.title),
          answerText: String(p.answerText),
          category: String(p.category || 'FAQ'),
          aliases: Array.isArray(p.aliases) ? p.aliases.map(String) : [],
        });
        return NextResponse.json({ ok: true, item });
      }
      await mutateGapStatus(String(p.normalizedSubject), (p.status as 'open' | 'ignored' | 'resolved') ?? 'ignored');
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'unknown entity' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), code: 'MUTATE_FAILED' },
      { status: 500 },
    );
  }
}
