import {
  canLearnedAuthorityCompete,
  defaultAuthorityForDomain,
  getAuthorityExplanationAr,
  isLowerAuthorityConflict,
} from '../domain/authorityMatrix';
import { checkHardInvariants } from '../domain/invariants';
import type { ConflictType } from '../domain/enums';
import type { ArtifactConflict, LearningArtifact, ProposedArtifact } from '../domain/types';
import { getBranchOpeningHour } from './entityResolver';
import { normalizeArabicText } from '../domain/normalizedKey';

export type ConflictContext = {
  approvedArtifacts: LearningArtifact[];
  existingBannedPhrases?: string[];
};

function payloadsEquivalent(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const fa = normalizeArabicText(String(a.instruction ?? a.forbiddenBehavior ?? a.value ?? a.correctedClaim ?? ''));
  const fb = normalizeArabicText(String(b.instruction ?? b.forbiddenBehavior ?? b.value ?? b.correctedClaim ?? ''));
  if (fa && fb && fa === fb) return true;
  const aliasA = normalizeArabicText(String(a.alias ?? ''));
  const aliasB = normalizeArabicText(String(b.alias ?? ''));
  if (aliasA && aliasB && aliasA === aliasB) return true;
  return false;
}

function findExistingByKey(
  artifacts: LearningArtifact[],
  normalizedKey: string,
  entityCode: string | null,
): LearningArtifact | undefined {
  return artifacts.find(
    (a) =>
      a.status === 'APPROVED' &&
      a.normalizedKey === normalizedKey &&
      (entityCode == null || a.entityCode === entityCode),
  );
}

export function detectArtifactConflict(
  proposed: ProposedArtifact,
  index: number,
  ctx: ConflictContext,
  rawInput: string,
): ArtifactConflict {
  const inv = checkHardInvariants(
    rawInput,
    String(proposed.structuredPayload.instruction ?? proposed.structuredPayload.forbiddenBehavior ?? ''),
  );
  if (inv.blocked) {
    return {
      artifactIndex: index,
      conflictType: 'BLOCKED_BY_INVARIANT',
      messageAr: inv.messageAr ?? 'يتعارض مع قاعدة أساسية في النظام.',
      blockedInvariantId: inv.invariantId,
      canApprove: false,
    } as ArtifactConflict & { canApprove?: boolean };
  }

  if (proposed.domain === 'PRICES' && proposed.authorityClass !== 'LIVE_ERP') {
    if (!canLearnedAuthorityCompete('PRICES', proposed.authorityClass)) {
      return {
        artifactIndex: index,
        conflictType: 'LOWER_AUTHORITY',
        messageAr: getAuthorityExplanationAr('PRICES'),
      };
    }
  }

  const existing = findExistingByKey(ctx.approvedArtifacts, proposed.normalizedKey, proposed.entityCode);
  if (existing) {
    if (payloadsEquivalent(proposed.structuredPayload, existing.structuredPayload)) {
      return {
        artifactIndex: index,
        conflictType: 'DUPLICATE',
        messageAr: 'المعلومة موجودة بالفعل، ومفيش تغيير مطلوب.',
        existingArtifactId: existing.artifactId,
        existingSummary: existing.summary,
      };
    }
    if (proposed.artifactType === 'CORRECTION' || existing.domain === proposed.domain) {
      return {
        artifactIndex: index,
        conflictType: 'SUPERSEDES',
        messageAr: 'سيستبدل المعلومة الحالية بعد الاعتماد.',
        existingArtifactId: existing.artifactId,
        existingSummary: existing.summary,
      };
    }
    return {
      artifactIndex: index,
      conflictType: 'CONTRADICTS',
      messageAr: 'يتعارض مع معلومة معتمدة حاليًا.',
      existingArtifactId: existing.artifactId,
      existingSummary: existing.summary,
    };
  }

  if (proposed.domain === 'OPENING_HOURS' && proposed.entityCode) {
    const current = getBranchOpeningHour(proposed.entityCode as 'GLEEM' | 'CAMP_CAESAR');
    const newVal = String(proposed.structuredPayload.correctedClaim ?? proposed.structuredPayload.value ?? '');
    if (current && newVal.includes(current.split(':')[0]!)) {
      return {
        artifactIndex: index,
        conflictType: 'DUPLICATE',
        messageAr: 'المعلومة موجودة بالفعل، ومفيش تغيير مطلوب.',
        existingSummary: current,
      };
    }
    if (current && newVal) {
      return {
        artifactIndex: index,
        conflictType: 'SUPERSEDES',
        messageAr: `سيستبدل موعد الفتح الحالي (${current}) بعد الاعتماد.`,
        existingSummary: current,
      };
    }
  }

  const banned = ctx.existingBannedPhrases ?? [];
  const forbidden = String(proposed.structuredPayload.forbiddenBehavior ?? proposed.structuredPayload.instruction ?? '');
  for (const phrase of banned) {
    if (forbidden.includes(phrase) || normalizeArabicText(forbidden).includes(normalizeArabicText(phrase))) {
      return {
        artifactIndex: index,
        conflictType: 'DUPLICATE',
        messageAr: 'القاعدة موجودة بالفعل في أسلوب العلامة.',
        existingSummary: phrase,
      };
    }
  }

  if (existing && isLowerAuthorityConflict(proposed.domain, proposed.authorityClass, existing.authorityClass)) {
    return {
      artifactIndex: index,
      conflictType: 'LOWER_AUTHORITY',
      messageAr: getAuthorityExplanationAr(proposed.domain),
      existingArtifactId: existing.artifactId,
    };
  }

  return {
    artifactIndex: index,
    conflictType: 'NONE',
    messageAr: 'لا يوجد تعارض.',
  };
}

export function canApproveConflict(conflictType: ConflictType): boolean {
  return (
    conflictType === 'NONE' ||
    conflictType === 'SUPERSEDES' ||
    conflictType === 'DUPLICATE'
  );
}
