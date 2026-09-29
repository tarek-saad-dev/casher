/**
 * Pure LegacyIdMap repair decisions (no DB I/O).
 * Authoritative entity IDs are never replaced to satisfy verification.
 */

export type LegacyIdMapDecision =
  | { action: 'ok' }
  | { action: 'insert'; drvoId: string }
  | { action: 'abort'; reason: string };

/**
 * Decide whether a LegacyIdMap row may be inserted, is already correct, or must abort.
 */
export function decideLegacyIdMapAction(args: {
  entityName: string;
  legacyKey: string;
  authoritativeDrvoId: string;
  /** Existing map DrvoId for this (tenant, entity, legacyKey), if any. */
  existingMapDrvoId: string | null;
}): LegacyIdMapDecision {
  const auth = String(args.authoritativeDrvoId).toLowerCase();
  if (args.existingMapDrvoId == null) {
    return { action: 'insert', drvoId: args.authoritativeDrvoId };
  }
  const existing = String(args.existingMapDrvoId).toLowerCase();
  if (existing === auth) {
    return { action: 'ok' };
  }
  return {
    action: 'abort',
    reason:
      `Conflicting LegacyIdMap for ${args.entityName}/${args.legacyKey}: ` +
      `map=${args.existingMapDrvoId} authoritative=${args.authoritativeDrvoId}`,
  };
}
