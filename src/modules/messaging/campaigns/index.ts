import 'server-only';

export {
  CAMPAIGN_STATUSES,
  CAMPAIGN_MESSAGE_MODES,
  CAMPAIGN_RECIPIENT_STATUSES,
  CampaignError,
  WHATSAPP_CAMPAIGN_TEMPLATE_KEY,
  buildRecipientIdempotencyKey,
  serializeAudienceCriteria,
  parseAudienceCriteria,
} from './domain/types';

export type {
  AudienceCriteria,
  AudienceRule,
  AudienceMember,
  CampaignStatus,
  CampaignMessageMode,
  CampaignRecipientStatus,
  CampaignRow,
  CampaignDetail,
  CampaignProgress,
} from './domain/types';

export { createCampaign } from './application/createCampaign';
export { listCampaigns } from './application/listCampaigns';
export { getCampaign } from './application/getCampaign';
export { previewCampaignAudience } from './application/previewCampaignAudience';
export { previewCampaignMessage } from './application/previewCampaignMessage';
export { startCampaign } from './application/startCampaign';
export { cancelCampaign } from './application/cancelCampaign';
export { syncCampaignProgress } from './application/syncCampaignProgress';
export { renderCustomCampaignMessage } from './application/renderCampaignMessage';
export { previewAudience, buildCampaignAudience } from './audience/previewAudience';
export { normalizePhoneDigits, isValidCampaignPhone } from './audience/normalizePhone';
export { buildAudienceQuerySql } from './audience/buildAudienceQuery';
