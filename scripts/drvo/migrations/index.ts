import type { DrvoMigrationDefinition } from '../types';
import { platformCoreMigration } from './001-platform-core';
import { platformBootstrapMigration } from './002-platform-bootstrap';
import { bookingPrerequisitesMigration } from './003-booking-prerequisites';
import { queuePrerequisitesMigration } from './004-queue-prerequisites';
import { operationalCalendarPrerequisitesMigration } from './005-operational-calendar-prerequisites';
import { treasuryMovementRegistryMigration } from './006-treasury-movement-registry';

/** Ordered DRVO migration manifest — single source of truth. */
export const DRVO_MIGRATIONS: DrvoMigrationDefinition[] = [
  platformCoreMigration,
  platformBootstrapMigration,
  bookingPrerequisitesMigration,
  queuePrerequisitesMigration,
  operationalCalendarPrerequisitesMigration,
  treasuryMovementRegistryMigration,
];

export function assertDrvoMigrationManifestValid(): void {
  const ids = new Set<number>();
  const keys = new Set<string>();
  for (const m of DRVO_MIGRATIONS) {
    if (ids.has(m.migrationId)) {
      throw new Error(`Duplicate DRVO migration id: ${m.migrationId}`);
    }
    if (keys.has(m.migrationKey)) {
      throw new Error(`Duplicate DRVO migration key: ${m.migrationKey}`);
    }
    ids.add(m.migrationId);
    keys.add(m.migrationKey);
    for (const dep of m.dependencies) {
      const depDef = DRVO_MIGRATIONS.find((x) => x.migrationKey === dep);
      if (!depDef) {
        throw new Error(`Migration ${m.migrationKey} has unknown dependency ${dep}`);
      }
      if (depDef.migrationId >= m.migrationId) {
        throw new Error(
          `Migration ${m.migrationKey} dependency ${dep} must appear earlier in manifest`,
        );
      }
    }
  }
  for (let i = 0; i < DRVO_MIGRATIONS.length; i++) {
    if (DRVO_MIGRATIONS[i]!.migrationId !== i + 1) {
      throw new Error(`DRVO migration ids must be contiguous starting at 1 (gap at index ${i})`);
    }
  }
}

export const DRVO_MODULE_REQUIRED_MIGRATIONS: Record<string, string[]> = {
  'platform-core': ['platform-core', 'platform-bootstrap'],
  booking: ['platform-core', 'platform-bootstrap', 'booking-prerequisites'],
  queue: ['platform-core', 'platform-bootstrap', 'queue-prerequisites'],
  'operational-calendar': [
    'platform-core',
    'platform-bootstrap',
    'operational-calendar-prerequisites',
  ],
  treasury: ['platform-core', 'platform-bootstrap', 'treasury-movement-registry'],
};
