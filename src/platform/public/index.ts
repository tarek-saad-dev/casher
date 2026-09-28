export { tenantLockResource } from '../tenant/tenantLockResource';
export { tenantCacheKey } from '../tenant/tenantCacheKey';
export {
  BOOTSTRAP_TENANT_CODE,
  type TenantRecord,
  type LocationRecord,
  type LegacyIdMapRecord,
  type TenantMembershipRecord,
} from '../tenant/types';
export { withUnitOfWork, withExistingTransaction } from '../uow/UnitOfWork';
export type { UnitOfWorkContext, UnitOfWorkFn } from '../uow/types';
export {
  publishPlatformOutboxEvent,
  countOutboxRowsForTenant,
} from '../outbox/publisher';
export type {
  PlatformOutboxInsert,
  PlatformOutboxRow,
  OutboxStatus,
} from '../outbox/types';
export {
  APP_REGISTRY_CODES,
  OPERATIONS_SURFACE_CODE,
  ALL_KNOWN_APP_CODES,
  ENTITLEMENT_ENFORCEMENT_ENABLED,
} from '../registry/constants';
export {
  getAppRegistryEntries,
  getOperationsSurfaceEntry,
  isAppEnabledForTenant,
} from '../registry/AppRegistry';
export { resolveStaffTenantContext } from '../session/staffTenantContext';
export type { StaffTenantContext } from '../session/staffTenantContext';
export type { ActorContext, StaffActorContext, ActorType } from '../auth/actorContext';
