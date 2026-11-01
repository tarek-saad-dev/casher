import 'server-only';

export {
  CAMPAIGN_STATUSES,
  CAMPAIGN_MESSAGE_MODES,
  CAMPAIGN_RECIPIENT_STATUSES,
  NOV_PRO600_SEGMENTS,
  CampaignError,
  WHATSAPP_CAMPAIGN_TEMPLATE_KEY,
  buildRecipientIdempotencyKey,
  serializeAudienceCriteria,
  parseAudienceCriteria,
  isNovPro600Segment,
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
  NovPro600Segment,
} from './domain/types';

export { createCampaign } from './application/createCampaign';
export { listCampaigns } from './application/listCampaigns';
export { getCampaign } from './application/getCampaign';
export { previewCampaignAudience } from './application/previewCampaignAudience';
export { previewCampaignMessage } from './application/previewCampaignMessage';
export { startCampaign } from './application/startCampaign';
export { cancelCampaign } from './application/cancelCampaign';
export { pauseCampaign } from './application/pauseCampaign';
export { testSendCampaignMessage } from './application/testSendCampaignMessage';
export { syncCampaignProgress } from './application/syncCampaignProgress';
export { renderCustomCampaignMessage } from './application/renderCampaignMessage';
export { previewAudience, buildCampaignAudience } from './audience/previewAudience';
export {
  previewNovPro600Audience,
  queryNovPro600Audience,
  NOV_PRO600_CAMPAIGN_CODE,
  NOV_PRO600_PACKAGE_ID,
} from './audience/novPro600Audience';
export { normalizePhoneDigits, isValidCampaignPhone } from './audience/normalizePhone';
export { buildAudienceQuerySql } from './audience/buildAudienceQuery';
