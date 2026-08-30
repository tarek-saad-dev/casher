/**
 * Future import adapters. Imported drafts are never authoritative until reviewed.
 * This phase: registry + interface only — no crawler.
 */
import type { KnowledgeItem, KnowledgeSourceRecord } from './types';

export type ImportedKnowledgeDraft = {
  sourceId: number;
  title: string;
  subject: string;
  answerText: string;
  aliases: string[];
  reviewed: false;
};

export type KnowledgeImportAdapter = {
  sourceType: string;
  fetchDrafts?(source: KnowledgeSourceRecord): Promise<ImportedKnowledgeDraft[]>;
};

const adapters = new Map<string, KnowledgeImportAdapter>();

export function registerKnowledgeImportAdapter(adapter: KnowledgeImportAdapter): void {
  adapters.set(adapter.sourceType, adapter);
}

export function getKnowledgeImportAdapter(sourceType: string): KnowledgeImportAdapter | null {
  return adapters.get(sourceType) ?? null;
}

/** Imported content cannot overwrite curated owner facts. */
export function mergeImportedWithoutOverwrite(args: {
  curated: KnowledgeItem[];
  importedDrafts: ImportedKnowledgeDraft[];
}): KnowledgeItem[] {
  const curatedKeys = new Set(args.curated.map((k) => k.key));
  const curatedSubjects = new Set(
    args.curated.map((k) => (k.subject || k.title).trim().toLowerCase()).filter(Boolean),
  );
  const extras: KnowledgeItem[] = [];
  let id = 10_000;
  for (const d of args.importedDrafts) {
    const key = `imported.${d.sourceId}.${d.title}`.slice(0, 120);
    if (curatedKeys.has(key)) continue;
    if (curatedSubjects.has(d.subject.trim().toLowerCase())) continue;
    extras.push({
      id: id++,
      key,
      category: 'FAQ',
      branchId: null,
      branchCode: null,
      employeeId: null,
      language: 'ar',
      title: d.title,
      subject: d.subject,
      answerText: d.answerText,
      aliases: d.aliases,
      tags: [],
      source: 'imported',
      status: 'draft',
      priority: 500,
      validFrom: null,
      validTo: null,
    });
  }
  return extras;
}

registerKnowledgeImportAdapter({ sourceType: 'WEBSITE' });
registerKnowledgeImportAdapter({ sourceType: 'BOOKING_WEBSITE' });
registerKnowledgeImportAdapter({ sourceType: 'INSTAGRAM' });
registerKnowledgeImportAdapter({ sourceType: 'FACEBOOK' });
registerKnowledgeImportAdapter({ sourceType: 'TIKTOK' });
registerKnowledgeImportAdapter({ sourceType: 'GOOGLE_MAPS' });
registerKnowledgeImportAdapter({ sourceType: 'DOCUMENT' });
registerKnowledgeImportAdapter({ sourceType: 'MANUAL' });
