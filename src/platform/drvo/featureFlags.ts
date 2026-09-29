/**
 * DRVO rollout resolution — source-controlled manifest + break-glass env overrides.
 *
 * Precedence (highest → lowest):
 * 1. DRVO_FORCE_<MODULE>_PATH = "legacy" | "extracted"  (emergency break-glass)
 * 2. Compat env (BOOKING_SCHEDULING_PORT / QUEUE_SCHEDULING_PORT) === "true"
 *    → force extracted (emergency / staging test override only)
 * 3. Compat env === "false" / unset / malformed → IGNORED
 *    (production currently pins BOOKING_SCHEDULING_PORT=false from the incident;
 *     ignoring false lets a later source-controlled legacy→extracted PR activate
 *     without SSH / .env edits)
 * 4. moduleManifest.rollout
 *
 * Normal lifecycle never requires env edits. Unset env → use Git-controlled rollout.
 */

import {
  type DrvoBusinessRollout,
  type DrvoModuleRolloutSpec,
  getDrvoModuleRolloutSpec,
} from './moduleManifest';

export type DrvoRolloutDecisionSource =
  | 'force-env'
  | 'compat-env-true'
  | 'manifest';

export type DrvoRolloutDecision = {
  effective: DrvoBusinessRollout;
  source: DrvoRolloutDecisionSource;
  module: string;
};

/** @deprecated Prefer resolveDrvoModuleRollout — kept for narrow literal checks in tests. */
export function isStrictOptInEnvFlag(value: string | undefined): boolean {
  return value === 'true';
}

export function resolveDrvoModuleRollout(
  spec: DrvoModuleRolloutSpec,
  env: NodeJS.ProcessEnv = process.env,
): DrvoRolloutDecision {
  const forceRaw = spec.forcePathEnv ? env[spec.forcePathEnv] : undefined;
  if (forceRaw === 'legacy' || forceRaw === 'extracted') {
    return { effective: forceRaw, source: 'force-env', module: spec.module };
  }

  if (spec.compatEnvFlag && env[spec.compatEnvFlag] === 'true') {
    return { effective: 'extracted', source: 'compat-env-true', module: spec.module };
  }

  // compatEnvFlag === 'false' intentionally ignored (transition from incident pin).
  return { effective: spec.rollout, source: 'manifest', module: spec.module };
}

export function isDrvoModuleExtractedPathEnabled(
  module: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const decision = resolveDrvoModuleRollout(getDrvoModuleRolloutSpec(module), env);
  return decision.effective === 'extracted';
}
