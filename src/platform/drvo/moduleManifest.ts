/**
 * Source-controlled DRVO module rollout (no DB I/O).
 *
 * Schema readiness ≠ business-path readiness.
 * Migration keys must match scripts/drvo/migrations/index.ts.
 *
 * Normal activation / rollback = Git PR changing `rollout` only.
 * Env flags are break-glass / compatibility overrides — not the normal lifecycle.
 */

/** Business path served after deploy + restart. */
export type DrvoBusinessRollout = 'legacy' | 'extracted';

/**
 * Audit classification of current production behavior.
 * Does not by itself enable a path — see `rollout`.
 */
export type DrvoModuleClassification =
  | 'legacy'
  | 'extracted'
  | 'always_on_infrastructure'
  | 'mixed';

export type DrvoModuleRolloutSpec = {
  /** Stable module key (readiness + resolver). */
  module: string;
  /** DRVO ticket id, e.g. DRVO-004. */
  drvoId: string;
  /**
   * Source-controlled business path.
   * Changing this in Git is the normal activate / rollback mechanism.
   */
  rollout: DrvoBusinessRollout;
  /** How production currently behaves (audit). */
  classification: DrvoModuleClassification;
  /** Why classification was chosen — do not change behavior just to normalize labels. */
  classificationRationale: string;
  requiredMigrationKeys: string[];
  /** Other module keys that must be ready before extracted activation. */
  dependencies: string[];
  /** Readiness check ids expected from scripts/drvo/readiness.ts. */
  readinessCheckIds: string[];
  /** Source-controlled rollback target (set `rollout` back to this via PR). */
  rollbackRollout: DrvoBusinessRollout;
  /**
   * Deprecated compat env (BOOKING_SCHEDULING_PORT / QUEUE_SCHEDULING_PORT).
   * Precedence documented in resolveDrvoModuleRollout().
   */
  compatEnvFlag?: string;
  /**
   * Emergency break-glass: exact `legacy` | `extracted`.
   * Example: DRVO_FORCE_BOOKING_PATH=legacy
   */
  forcePathEnv?: string;
};

/**
 * Extracted-module contract completeness (CI).
 * DRVO-008+ modules with rollout === 'extracted' must pass this.
 */
export function assertExtractedRolloutContract(spec: DrvoModuleRolloutSpec): void {
  if (spec.rollout !== 'extracted') return;
  const gaps: string[] = [];
  if (!spec.requiredMigrationKeys.length) {
    gaps.push('requiredMigrationKeys');
  }
  if (!Array.isArray(spec.dependencies)) {
    gaps.push('dependencies');
  }
  if (!spec.readinessCheckIds.length) {
    gaps.push('readinessCheckIds');
  }
  if (spec.rollbackRollout !== 'legacy' && spec.rollbackRollout !== 'extracted') {
    gaps.push('rollbackRollout');
  }
  if (!spec.drvoId.trim()) {
    gaps.push('drvoId');
  }
  if (gaps.length) {
    throw new Error(
      `DRVO module "${spec.module}" has rollout=extracted but incomplete contract: ${gaps.join(', ')}`,
    );
  }
}

export function assertAllDrvoRolloutContracts(
  specs: DrvoModuleRolloutSpec[] = DRVO_MODULE_ROLLOUT,
): void {
  for (const spec of specs) {
    assertExtractedRolloutContract(spec);
  }
}

export const DRVO_MODULE_ROLLOUT: DrvoModuleRolloutSpec[] = [
  {
    module: 'booking',
    drvoId: 'DRVO-004',
    rollout: 'legacy',
    classification: 'legacy',
    classificationRationale:
      'Strangler port exists behind isBookingSchedulingPortEnabled(); production incident forced legacy. First merge of this branch keeps source-controlled rollout=legacy. Extracted path is staging-proven but not yet production-activated.',
    requiredMigrationKeys: [
      'platform-core',
      'platform-bootstrap',
      'booking-prerequisites',
    ],
    dependencies: ['platform-core'],
    readinessCheckIds: [
      'migration.platform-core',
      'migration.platform-bootstrap',
      'migration.booking-prerequisites',
      'platform.bootstrap',
    ],
    rollbackRollout: 'legacy',
    compatEnvFlag: 'BOOKING_SCHEDULING_PORT',
    forcePathEnv: 'DRVO_FORCE_BOOKING_PATH',
  },
  {
    module: 'queue',
    drvoId: 'DRVO-005',
    rollout: 'legacy',
    classification: 'legacy',
    classificationRationale:
      'Extracted queue path is still strict opt-in / not independently proven production-safe on the live strangler. Keep source-controlled rollout=legacy alongside booking until a dedicated activation PR.',
    requiredMigrationKeys: [
      'platform-core',
      'platform-bootstrap',
      'queue-prerequisites',
    ],
    dependencies: ['platform-core'],
    readinessCheckIds: [
      'migration.platform-core',
      'migration.platform-bootstrap',
      'migration.queue-prerequisites',
      'platform.bootstrap',
    ],
    rollbackRollout: 'legacy',
    compatEnvFlag: 'QUEUE_SCHEDULING_PORT',
    forcePathEnv: 'DRVO_FORCE_QUEUE_PATH',
  },
  {
    module: 'operational-calendar',
    drvoId: 'DRVO-006',
    rollout: 'extracted',
    classification: 'always_on_infrastructure',
    classificationRationale:
      'No strangler flag. Composition always builds createLegacyOperationalCalendarAdapter (extracted port + legacy SQL). Already merged and serving production; do not gate or disable.',
    requiredMigrationKeys: [
      'platform-core',
      'platform-bootstrap',
      'operational-calendar-prerequisites',
    ],
    dependencies: ['platform-core'],
    readinessCheckIds: [
      'migration.platform-core',
      'migration.platform-bootstrap',
      'migration.operational-calendar-prerequisites',
      'platform.bootstrap',
    ],
    rollbackRollout: 'extracted',
  },
  {
    module: 'treasury',
    drvoId: 'DRVO-007',
    rollout: 'extracted',
    classification: 'always_on_infrastructure',
    classificationRationale:
      'No strangler flag. Non-sale money movement routes use createLegacyMoneyMovementAdapter via treasury composition. Already production-active; sales InsCashMoveSales trigger remains outside this port. Do not gate or disable.',
    requiredMigrationKeys: [
      'platform-core',
      'platform-bootstrap',
      'treasury-movement-registry',
    ],
    dependencies: ['platform-core', 'operational-calendar'],
    readinessCheckIds: [
      'migration.platform-core',
      'migration.platform-bootstrap',
      'migration.treasury-movement-registry',
      'treasury.schema',
      'platform.bootstrap',
    ],
    rollbackRollout: 'extracted',
  },
];

export function getDrvoModuleRolloutSpec(module: string): DrvoModuleRolloutSpec {
  const spec = DRVO_MODULE_ROLLOUT.find((m) => m.module === module);
  if (!spec) {
    throw new Error(`Unknown DRVO module rollout spec: ${module}`);
  }
  return spec;
}

/** Map used by scripts/drvo readiness — keep keys aligned with DRVO_MODULE_REQUIRED_MIGRATIONS. */
export function drvoModuleRequiredMigrationsFromManifest(): Record<string, string[]> {
  const out: Record<string, string[]> = {
    'platform-core': ['platform-core', 'platform-bootstrap'],
  };
  for (const spec of DRVO_MODULE_ROLLOUT) {
    out[spec.module] = [...spec.requiredMigrationKeys];
  }
  return out;
}
