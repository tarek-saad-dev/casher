/** In-process concierge metrics for tests and traces. Not a public dashboard. */
export type ConciergeMetrics = {
  KnowledgeAccuracy: number;
  SourceGroundingRate: number;
  UnknownSafetyRate: number;
  BrandVoiceCompliance: number;
  CustomerQuestionAnswered: number;
  SolutionUsefulness: number;
  UnwantedUpsellRate: number;
  BookingPlanPreservation: number;
  StaticFastPathRate: number;
  KnowledgeGapCaptureRate: number;
  UnsupportedBusinessClaims: number;
};

export const CONCIERGE_METRIC_TARGETS: ConciergeMetrics = {
  KnowledgeAccuracy: 1,
  SourceGroundingRate: 1,
  UnknownSafetyRate: 1,
  BrandVoiceCompliance: 0.99,
  CustomerQuestionAnswered: 0.98,
  SolutionUsefulness: 0.95,
  UnwantedUpsellRate: 0.02,
  BookingPlanPreservation: 1,
  StaticFastPathRate: 0.8,
  KnowledgeGapCaptureRate: 1,
  UnsupportedBusinessClaims: 0,
};

export function meetsConciergeMetricTargets(m: ConciergeMetrics): boolean {
  return (
    m.SourceGroundingRate >= CONCIERGE_METRIC_TARGETS.SourceGroundingRate &&
    m.UnknownSafetyRate >= CONCIERGE_METRIC_TARGETS.UnknownSafetyRate &&
    m.BrandVoiceCompliance >= CONCIERGE_METRIC_TARGETS.BrandVoiceCompliance &&
    m.CustomerQuestionAnswered >= CONCIERGE_METRIC_TARGETS.CustomerQuestionAnswered &&
    m.BookingPlanPreservation >= CONCIERGE_METRIC_TARGETS.BookingPlanPreservation &&
    m.UnsupportedBusinessClaims <= CONCIERGE_METRIC_TARGETS.UnsupportedBusinessClaims &&
    m.UnwantedUpsellRate <= CONCIERGE_METRIC_TARGETS.UnwantedUpsellRate
  );
}
