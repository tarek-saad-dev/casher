import {
  CONFIDENCE_LEVELS,
  FLOW_GROUPS,
  FLOW_KINDS,
  PARTY_TYPES,
  PNL_IMPACTS,
  isAllowedEnum,
  type KeywordMatchMode,
  type KeywordMatchTarget,
} from './accountingSettingsTypes';

export function validateClassificationOutputs(body: {
  flowGroup?: string;
  flowKind?: string;
  pnlImpact?: string;
  partyType?: string;
  confidence?: string;
  matchTarget?: string;
  matchMode?: string;
}) {
  const errors: string[] = [];
  if (body.flowGroup && !isAllowedEnum(body.flowGroup, FLOW_GROUPS)) errors.push('FlowGroup غير صالح');
  if (body.flowKind && !isAllowedEnum(body.flowKind, FLOW_KINDS)) errors.push('FlowKind غير صالح');
  if (body.pnlImpact && !PNL_IMPACTS.includes(body.pnlImpact as typeof PNL_IMPACTS[number])) {
    errors.push('PnlImpact غير صالح');
  }
  if (body.partyType && !PARTY_TYPES.includes(body.partyType as typeof PARTY_TYPES[number])) {
    errors.push('PartyType غير صالح');
  }
  if (body.confidence && !CONFIDENCE_LEVELS.includes(body.confidence as typeof CONFIDENCE_LEVELS[number])) {
    errors.push('Confidence غير صالح');
  }
  if (body.matchTarget && !['category', 'notes', 'both'].includes(body.matchTarget)) {
    errors.push('MatchTarget غير صالح');
  }
  if (body.matchMode && !['contains', 'exact'].includes(body.matchMode)) {
    errors.push('MatchMode غير صالح');
  }
  return errors;
}

export type { KeywordMatchMode, KeywordMatchTarget };
