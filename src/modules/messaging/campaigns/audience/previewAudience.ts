import type { AudienceCriteria, AudienceMember } from '../domain/types';
import { executeAudienceQuery } from './buildAudienceQuery';
import { isValidCampaignPhone, normalizePhoneDisplay } from './normalizePhone';
import {
  previewNovPro600Audience,
  queryNovPro600Audience,
  type NovPro600AudiencePreview,
} from './novPro600Audience';

export type AudiencePreviewResult = {
  count: number;
  sample: AudienceMember[];
  novPro600?: NovPro600AudiencePreview;
};

export async function previewAudience(
  criteria: AudienceCriteria,
): Promise<AudiencePreviewResult> {
  if (criteria.mode === 'nov_pro600') {
    const nov = await previewNovPro600Audience({
      segments: criteria.novPro600Segments,
      asOfDate: criteria.asOfDate,
    });
    return {
      count: nov.sendEligibleCount,
      sample: nov.sample.map((row) => ({
        clientId: row.clientId,
        phone: row.phoneMasked,
        name: row.name,
        firstName: row.name.split(/\s+/)[0] || row.name,
        branchName: row.branchName,
        visitCount: 0,
        totalSpend: 0,
        lastVisitDate: null,
        segment: row.segment,
        sendEligible: row.sendEligible,
        exclusionReason: row.exclusionReason,
      })),
      novPro600: nov,
    };
  }

  const rows = await executeAudienceQuery(criteria);
  const valid = rows.filter((row) => isValidCampaignPhone(row.phone));
  return {
    count: valid.length,
    sample: valid.slice(0, 20).map((row) => ({
      ...row,
      phone: normalizePhoneDisplay(row.phone),
    })),
  };
}

/**
 * Build recipients for campaign start.
 * NOV-PRO600 returns only send-eligible contacts (verified marketing permission).
 */
export async function buildCampaignAudience(
  criteria: AudienceCriteria,
): Promise<AudienceMember[]> {
  if (criteria.mode === 'nov_pro600') {
    const rows = await queryNovPro600Audience({
      segments: criteria.novPro600Segments,
      asOfDate: criteria.asOfDate,
      sendEligibleOnly: true,
    });
    return rows.map((row) => ({
      clientId: row.clientId,
      phone: row.phone,
      name: row.name,
      firstName: row.firstName,
      branchName: row.branchName,
      visitCount: row.visitCount,
      totalSpend: row.totalSpend,
      lastVisitDate: row.lastVisitDate,
      segment: row.segment,
      sendEligible: true,
      consentEvidence: row.consentEvidence,
    }));
  }

  const rows = await executeAudienceQuery(criteria);
  return rows
    .filter((row) => isValidCampaignPhone(row.phone))
    .map((row) => ({
      ...row,
      phone: normalizePhoneDisplay(row.phone),
    }));
}
