/**
 * Admin mutations: fixture store in tests; SQL in production.
 * Always invalidate cache after writes.
 */
import { invalidateConciergeCache } from './cache';
import { isConciergeTestHub } from './defaults';
import { normalizeConciergeText } from './matching';
import type {
  BrandVoiceProfile,
  CapabilityItem,
  ExternalLinkItem,
  KnowledgeItem,
  KnowledgeSourceRecord,
  OfferItem,
  VoiceExample,
} from './types';

function nextId(nums: number[]): number {
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

async function testStore() {
  const { getConciergeStore } = await import('./knowledgeStore');
  return getConciergeStore();
}

export async function mutateKnowledge(item: Partial<KnowledgeItem> & { key: string; title: string; answerText: string; category: string }): Promise<KnowledgeItem> {
  if (isConciergeTestHub()) {
    const { getConciergeStore } = await import('./knowledgeStore');
    const store = await testStore();
    const existing = store.knowledge.find((k) => k.key === item.key);
    const row: KnowledgeItem = {
      id: existing?.id ?? nextId(store.knowledge.map((k) => k.id)),
      key: item.key,
      category: item.category,
      branchId: item.branchId ?? existing?.branchId ?? null,
      branchCode: item.branchCode ?? existing?.branchCode ?? null,
      employeeId: item.employeeId ?? existing?.employeeId ?? null,
      language: item.language ?? existing?.language ?? 'ar',
      title: item.title,
      subject: item.subject ?? existing?.subject ?? null,
      answerText: item.answerText,
      aliases: item.aliases ?? existing?.aliases ?? [],
      tags: item.tags ?? existing?.tags ?? [],
      source: 'curated',
      status: item.status ?? existing?.status ?? 'active',
      priority: item.priority ?? existing?.priority ?? 100,
      validFrom: item.validFrom ?? existing?.validFrom ?? null,
      validTo: item.validTo ?? existing?.validTo ?? null,
    };
    if (existing) Object.assign(existing, row);
    else store.knowledge.push(row);
    invalidateConciergeCache();
    return row;
  }
  const { sqlUpsertKnowledge } = await import('./sqlWrites');
  await sqlUpsertKnowledge(item);
  return item as KnowledgeItem;
}

export async function patchKnowledgeStatus(key: string, status: KnowledgeItem['status']): Promise<boolean> {
  if (isConciergeTestHub()) {
    const store = await testStore();
    const item = store.knowledge.find((k) => k.key === key);
    if (!item) return false;
    item.status = status;
    invalidateConciergeCache();
    return true;
  }
  const { sqlPatchKnowledgeStatus } = await import('./sqlWrites');
  return sqlPatchKnowledgeStatus(key, status);
}

export async function mutateCapability(item: Partial<CapabilityItem> & { key: string; displayNameAr: string }): Promise<CapabilityItem> {
  if (isConciergeTestHub()) {
    const store = await testStore();
    const existing = store.capabilities.find((c) => c.key === item.key);
    const row: CapabilityItem = {
      id: existing?.id ?? nextId(store.capabilities.map((c) => c.id)),
      key: item.key,
      displayNameAr: item.displayNameAr,
      aliases: item.aliases ?? existing?.aliases ?? [],
      descriptionAr: item.descriptionAr ?? existing?.descriptionAr ?? null,
      serviceIds: item.serviceIds ?? existing?.serviceIds ?? [],
      employeeIds: item.employeeIds ?? existing?.employeeIds ?? [],
      employeeNames: item.employeeNames ?? existing?.employeeNames ?? [],
      branchCodes: item.branchCodes ?? existing?.branchCodes ?? [],
      status: item.status ?? existing?.status ?? 'active',
    };
    if (existing) Object.assign(existing, row);
    else store.capabilities.push(row);
    invalidateConciergeCache();
    return row;
  }
  const { sqlUpsertCapability } = await import('./sqlWrites');
  await sqlUpsertCapability(item);
  return item as CapabilityItem;
}

export async function mutateLink(item: Partial<ExternalLinkItem> & { key: string; linkType: ExternalLinkItem['linkType']; labelAr: string; url: string }): Promise<ExternalLinkItem> {
  if (isConciergeTestHub()) {
    const store = await testStore();
    const existing = store.links.find((l) => l.key === item.key);
    const row: ExternalLinkItem = {
      id: existing?.id ?? nextId(store.links.map((l) => l.id)),
      key: item.key,
      linkType: item.linkType,
      branchCode: item.branchCode ?? existing?.branchCode ?? null,
      labelAr: item.labelAr,
      url: item.url,
      status: item.status ?? existing?.status ?? 'active',
    };
    if (existing) Object.assign(existing, row);
    else store.links.push(row);
    invalidateConciergeCache();
    return row;
  }
  const { sqlUpsertLink } = await import('./sqlWrites');
  await sqlUpsertLink(item);
  return item as ExternalLinkItem;
}

export async function mutateOffer(item: Partial<OfferItem> & { key: string; titleAr: string; descriptionAr: string }): Promise<OfferItem> {
  if (isConciergeTestHub()) {
    const store = await testStore();
    const existing = store.offers.find((o) => o.key === item.key);
    const row: OfferItem = {
      id: existing?.id ?? nextId(store.offers.map((o) => o.id)),
      key: item.key,
      titleAr: item.titleAr,
      descriptionAr: item.descriptionAr,
      branchCodes: item.branchCodes ?? existing?.branchCodes ?? [],
      serviceIds: item.serviceIds ?? existing?.serviceIds ?? [],
      validFrom: item.validFrom ?? existing?.validFrom ?? null,
      validTo: item.validTo ?? existing?.validTo ?? null,
      status: item.status ?? existing?.status ?? 'active',
      priority: item.priority ?? existing?.priority ?? 100,
    };
    if (existing) Object.assign(existing, row);
    else store.offers.push(row);
    invalidateConciergeCache();
    return row;
  }
  const { sqlUpsertOffer } = await import('./sqlWrites');
  await sqlUpsertOffer(item);
  return item as OfferItem;
}

export async function mutateBrandVoice(config: BrandVoiceProfile): Promise<BrandVoiceProfile> {
  if (isConciergeTestHub()) {
    (await testStore()).brandVoice = { ...config };
    invalidateConciergeCache();
    return config;
  }
  const { sqlUpsertBrandVoice } = await import('./sqlWrites');
  await sqlUpsertBrandVoice('default', config);
  return config;
}

export async function mutateVoiceExample(ex: Partial<VoiceExample> & { scenarioKey: string; category: string; customerMessage: string; preferredResponse: string }): Promise<VoiceExample> {
  if (isConciergeTestHub()) {
    const store = await testStore();
    const existing = ex.id ? store.examples.find((e) => e.id === ex.id) : undefined;
    const row: VoiceExample = {
      id: existing?.id ?? nextId(store.examples.map((e) => e.id)),
      scenarioKey: ex.scenarioKey,
      category: ex.category,
      customerMessage: ex.customerMessage,
      preferredResponse: ex.preferredResponse,
      notes: ex.notes ?? existing?.notes ?? null,
      priority: ex.priority ?? existing?.priority ?? 100,
      isActive: ex.isActive ?? existing?.isActive ?? true,
    };
    if (existing) Object.assign(existing, row);
    else store.examples.push(row);
    invalidateConciergeCache();
    return row;
  }
  const { sqlUpsertVoiceExample } = await import('./sqlWrites');
  await sqlUpsertVoiceExample(ex);
  return ex as VoiceExample;
}

export async function mutateSource(src: Partial<KnowledgeSourceRecord> & { name: string; sourceType: string }): Promise<KnowledgeSourceRecord> {
  if (isConciergeTestHub()) {
    const store = await testStore();
    const existing = src.id ? store.sources.find((s) => s.id === src.id) : undefined;
    const row: KnowledgeSourceRecord = {
      id: existing?.id ?? nextId(store.sources.map((s) => s.id)),
      name: src.name,
      sourceType: src.sourceType,
      urlOrRef: src.urlOrRef ?? existing?.urlOrRef ?? null,
      branchCode: src.branchCode ?? existing?.branchCode ?? null,
      active: src.active ?? existing?.active ?? true,
      lastReviewedAt: src.lastReviewedAt ?? existing?.lastReviewedAt ?? null,
      notes: src.notes ?? existing?.notes ?? null,
    };
    if (existing) Object.assign(existing, row);
    else store.sources.push(row);
    invalidateConciergeCache();
    return row;
  }
  const { sqlUpsertSource } = await import('./sqlWrites');
  await sqlUpsertSource(src);
  return src as KnowledgeSourceRecord;
}

export async function mutateGapStatus(normalizedSubject: string, status: 'open' | 'ignored' | 'resolved'): Promise<boolean> {
  const key = normalizeConciergeText(normalizedSubject);
  if (isConciergeTestHub()) {
    const store = await testStore();
    const gap = store.gapsMap.get(key);
    if (!gap) return false;
    gap.status = status;
    store.gaps = [...store.gapsMap.values()];
    invalidateConciergeCache();
    return true;
  }
  const { sqlSetGapStatus } = await import('./sqlWrites');
  await sqlSetGapStatus(key, status);
  return true;
}

export async function convertGapToKnowledge(args: {
  normalizedSubject: string;
  key: string;
  title: string;
  answerText: string;
  category: string;
  aliases?: string[];
}): Promise<KnowledgeItem> {
  const item = await mutateKnowledge({
    key: args.key,
    title: args.title,
    answerText: args.answerText,
    category: args.category,
    subject: args.normalizedSubject,
    aliases: args.aliases ?? [],
    status: 'active',
    source: 'curated',
  });
  await mutateGapStatus(args.normalizedSubject, 'resolved');
  return item;
}

export async function deleteKnowledge(key: string): Promise<boolean> {
  if (isConciergeTestHub()) {
    const store = await testStore();
    const before = store.knowledge.length;
    store.knowledge = store.knowledge.filter((k) => k.key !== key);
    invalidateConciergeCache();
    return store.knowledge.length < before;
  }
  const { sqlDeleteKnowledge } = await import('./sqlWrites');
  return sqlDeleteKnowledge(key);
}
