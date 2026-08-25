import { listCampaigns as listCampaignRows } from '../infra/campaignRepository';

export async function listCampaigns(limit?: number) {
  return listCampaignRows(limit);
}
