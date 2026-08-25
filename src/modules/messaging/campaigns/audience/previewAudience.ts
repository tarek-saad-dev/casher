import type { AudienceCriteria, AudienceMember } from '../domain/types';
import { executeAudienceQuery } from './buildAudienceQuery';
import { isValidCampaignPhone, normalizePhoneDisplay } from './normalizePhone';

export type AudiencePreviewResult = {
  count: number;
  sample: AudienceMember[];
};

export async function previewAudience(
  criteria: AudienceCriteria,
): Promise<AudiencePreviewResult> {
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

export async function buildCampaignAudience(
  criteria: AudienceCriteria,
): Promise<AudienceMember[]> {
  const rows = await executeAudienceQuery(criteria);
  return rows
    .filter((row) => isValidCampaignPhone(row.phone))
    .map((row) => ({
      ...row,
      phone: normalizePhoneDisplay(row.phone),
    }));
}
