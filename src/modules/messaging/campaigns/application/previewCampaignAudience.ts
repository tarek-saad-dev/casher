import type { AudienceCriteria } from '../domain/types';
import { previewAudience } from '../audience/previewAudience';

export async function previewCampaignAudience(criteria: AudienceCriteria) {
  return previewAudience(criteria);
}
