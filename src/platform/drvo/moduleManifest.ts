/**
 * Machine-checkable DRVO module rollout metadata (no DB I/O).
 * Migration keys must match scripts/drvo/migrations/index.ts.
 */
export type DrvoModuleRolloutSpec = {
  module: string;
  requiredMigrationKeys: string[];
  rolloutFlagEnv?: string;
  /** When true, extracted path requires explicit env === 'true'. */
  strictOptIn: boolean;
};

export const DRVO_MODULE_ROLLOUT: DrvoModuleRolloutSpec[] = [
  {
    module: 'booking',
    requiredMigrationKeys: [
      'platform-core',
      'platform-bootstrap',
      'booking-prerequisites',
    ],
    rolloutFlagEnv: 'BOOKING_SCHEDULING_PORT',
    strictOptIn: true,
  },
  {
    module: 'queue',
    requiredMigrationKeys: [
      'platform-core',
      'platform-bootstrap',
      'queue-prerequisites',
    ],
    rolloutFlagEnv: 'QUEUE_SCHEDULING_PORT',
    strictOptIn: true,
  },
  {
    module: 'operational-calendar',
    requiredMigrationKeys: [
      'platform-core',
      'platform-bootstrap',
      'operational-calendar-prerequisites',
    ],
    strictOptIn: false,
  },
  {
    module: 'treasury',
    requiredMigrationKeys: [
      'platform-core',
      'platform-bootstrap',
      'treasury-movement-registry',
    ],
    strictOptIn: false,
  },
];
