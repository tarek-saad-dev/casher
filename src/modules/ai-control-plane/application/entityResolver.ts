import { CONCIERGE_FIXED_BRANCH_HOURS } from '@/modules/messaging/ai/salonConcierge/branchBusinessHours';
import type { BranchCode } from '../domain/enums';
import type { EntityResolution, EntityType } from '../domain/types';
import { normalizeArabicText } from '../domain/normalizedKey';

type BranchEntry = {
  code: BranchCode;
  entityId: number | null;
  labels: string[];
};

const BRANCH_REGISTRY: BranchEntry[] = [
  {
    code: 'GLEEM',
    entityId: null,
    labels: ['gleem', 'جليم', 'جليم سابا باشا', 'سابا باشا'],
  },
  {
    code: 'CAMP_CAESAR',
    entityId: null,
    labels: ['camp', 'camp caesar', 'كامب', 'كامب شيزار', 'كامب سيزر', 'كامب شيزر', 'كامب سيزار'],
  },
];

const SERVICE_ALIASES: Record<string, { code: string; entityId: number | null; label: string }> = {
  شعر: { code: 'HAIR', entityId: null, label: 'قص شعر' },
  حلاقه: { code: 'BARBER', entityId: null, label: 'حلاقة' },
  حلاقة: { code: 'BARBER', entityId: null, label: 'حلاقة' },
};

function matchBranch(text: string): EntityResolution | null {
  const norm = normalizeArabicText(text);
  const hits: Array<{ code: BranchCode; label: string }> = [];
  for (const branch of BRANCH_REGISTRY) {
    for (const label of branch.labels) {
      const labelNorm = normalizeArabicText(label);
      if (norm.includes(labelNorm)) {
        hits.push({ code: branch.code, label });
      }
    }
  }
  const unique = [...new Map(hits.map((h) => [h.code, h])).values()];
  if (unique.length === 1) {
    const code = unique[0]!.code;
    const entry = BRANCH_REGISTRY.find((b) => b.code === code)!;
    return {
      entityType: 'BRANCH',
      entityCode: code,
      entityId: entry.entityId,
      label: unique[0]!.label,
      status: 'RESOLVED',
      candidates: [],
    };
  }
  if (unique.length > 1) {
    return {
      entityType: 'BRANCH',
      entityCode: '',
      entityId: null,
      label: '',
      status: 'AMBIGUOUS',
      candidates: unique.map((u) => ({
        entityCode: u.code,
        label: u.label,
        entityId: null,
      })),
    };
  }
  return null;
}

function matchService(text: string): EntityResolution | null {
  const norm = normalizeArabicText(text);
  for (const [key, svc] of Object.entries(SERVICE_ALIASES)) {
    if (norm.includes(normalizeArabicText(key))) {
      return {
        entityType: 'SERVICE',
        entityCode: svc.code,
        entityId: svc.entityId,
        label: svc.label,
        status: 'RESOLVED',
        candidates: [],
      };
    }
  }
  return null;
}

/** Reject model-invented numeric IDs — only system resolver may set entityId. */
export function sanitizeModelEntityId(
  entityType: EntityType | null,
  entityCode: string | null,
  modelEntityId: unknown,
): number | null {
  if (modelEntityId == null) return null;
  if (!entityType || !entityCode) return null;
  const resolved = resolveEntity(entityType, entityCode);
  if (!resolved || resolved.status !== 'RESOLVED') return null;
  if (resolved.entityId != null && resolved.entityId === Number(modelEntityId)) {
    return resolved.entityId;
  }
  return resolved.entityId;
}

export function resolveEntity(entityType: EntityType, hint: string): EntityResolution | null {
  switch (entityType) {
    case 'BRANCH':
      return matchBranch(hint);
    case 'SERVICE':
      return matchService(hint);
    case 'EMPLOYEE':
      return null;
    default:
      return null;
  }
}

export function resolveEntityFromText(text: string): EntityResolution | null {
  return matchBranch(text) ?? matchService(text);
}

export function resolveEntityByCode(entityType: EntityType, code: string): EntityResolution | null {
  const normalized = code.trim().toUpperCase();
  if (entityType === 'BRANCH') {
    const branch = BRANCH_REGISTRY.find((b) => b.code === normalized);
    if (!branch) return null;
    return {
      entityType: 'BRANCH',
      entityCode: branch.code,
      entityId: branch.entityId,
      label: branch.labels[0] ?? branch.code,
      status: 'RESOLVED',
      candidates: [],
    };
  }
  if (entityType === 'SERVICE') {
    const svc = Object.values(SERVICE_ALIASES).find((s) => s.code === normalized);
    if (!svc) return null;
    return {
      entityType: 'SERVICE',
      entityCode: svc.code,
      entityId: svc.entityId,
      label: svc.label,
      status: 'RESOLVED',
      candidates: [],
    };
  }
  return null;
}

export function listEntityCandidatesForPrompt(): Array<{
  entityType: EntityType;
  code: string;
  labels: string[];
}> {
  return [
    ...BRANCH_REGISTRY.map((b) => ({
      entityType: 'BRANCH' as const,
      code: b.code,
      labels: b.labels,
    })),
    ...Object.values(SERVICE_ALIASES).map((s) => ({
      entityType: 'SERVICE' as const,
      code: s.code,
      labels: [s.label],
    })),
  ];
}

export function getBranchOpeningHour(branchCode: BranchCode): string | null {
  const hours = CONCIERGE_FIXED_BRANCH_HOURS[branchCode];
  if (!hours) return null;
  const h = Math.floor(hours.openMinutes / 60);
  return `${String(h).padStart(2, '0')}:00`;
}

export function listKnownBranchCodes(): BranchCode[] {
  return BRANCH_REGISTRY.map((b) => b.code);
}
