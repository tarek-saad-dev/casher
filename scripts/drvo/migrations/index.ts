import type { DrvoMigrationDefinition } from '../types';
import { platformCoreMigration } from './001-platform-core';
import { platformBootstrapMigration } from './002-platform-bootstrap';
import { bookingPrerequisitesMigration } from './003-booking-prerequisites';
import { queuePrerequisitesMigration } from './004-queue-prerequisites';
import { operationalCalendarPrerequisitesMigration } from './005-operational-calendar-prerequisites';
import { treasuryMovementRegistryMigration } from './006-treasury-movement-registry';
import { bookingHoldKeyMigration } from './007-booking-hold-key';
import { insCashMoveSalesGuardMigration } from './008-ins-cash-move-sales-guard';
import { commercialSubscriptionTenantAppsMigration } from './009-commercial-subscription-tenant-apps';
import { masterDataTenancyMigration } from './010-master-data-tenancy';
import { tenantBrandProfileMigration } from './011-tenant-brand-profile';
import { drvoModuleRequiredMigrationsFromManifest } from '../../../src/platform/drvo/moduleManifest';

/** Ordered DRVO migration manifest — single source of truth for migration order. */
export const DRVO_MIGRATIONS: DrvoMigrationDefinition[] = [
  platformCoreMigration,
  platformBootstrapMigration,
  bookingPrerequisitesMigration,
  queuePrerequisitesMigration,
  operationalCalendarPrerequisitesMigration,
  treasuryMovementRegistryMigration,
  bookingHoldKeyMigration,
  insCashMoveSalesGuardMigration,
  commercialSubscriptionTenantAppsMigration,
  masterDataTenancyMigration,
  tenantBrandProfileMigration,
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
    if (!m.control) {
      throw new Error(`Migration ${m.migrationKey} must declare production control metadata`);
    }
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(m.control.risk)) {
      throw new Error(`Migration ${m.migrationKey} has invalid risk ${m.control.risk}`);
    }
    if (!m.control.rollbackStrategy.trim()) {
      throw new Error(`Migration ${m.migrationKey} must declare a rollback strategy`);
    }
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
  let expected = 1;
  for (let i = 0; i < DRVO_MIGRATIONS.length; i++) {
    if (DRVO_MIGRATIONS[i]!.migrationId !== expected) {
      throw new Error(`DRVO migration ids must be contiguous starting at 1 (gap at index ${i})`);
    }
    expected++;
  }
}

/**
 * Module → required migration keys.
 * Derived from source-controlled moduleManifest (not a second hand-maintained map).
 */
export function getDrvoModuleRequiredMigrations(): Record<string, string[]> {
  return drvoModuleRequiredMigrationsFromManifest();
}
