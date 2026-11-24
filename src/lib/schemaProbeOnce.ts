/**
 * Hot routes probe their schema (IF OBJECT_ID / COL_LENGTH …) before querying.
 * Once a probe has succeeded in this process it never needs to run again, so
 * routes keep a module-level flag and skip it — one remote round trip saved per
 * request. Under tests the probe always runs so query-sequence mocks stay stable.
 */
export function skipSchemaProbe(alreadyEnsured: boolean): boolean {
  if (!alreadyEnsured) return false;
  return process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test';
}
