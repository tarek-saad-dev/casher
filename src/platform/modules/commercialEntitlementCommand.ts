import { isDrvoModuleKey, type DrvoModuleStatus } from './registry';

/** Pure validation for platform-only commercial entitlement commands.
 * No request payload can assert its own platform authority.
 */
export type CommercialEntitlementCommand = {
  tenantId: string;
  moduleKey: string;
  action: 'provision' | 'suspend' | 'renew' | 'cancel';
  validUntilUtc?: string | null;
  requestId: string;
};

export type ValidatedCommercialCommand = CommercialEntitlementCommand & {
  moduleKey: string;
  validUntilUtc: string | null;
  targetStatus: DrvoModuleStatus;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateCommercialEntitlementCommand(
  input: CommercialEntitlementCommand,
  now: Date = new Date(),
): ValidatedCommercialCommand {
  if (!UUID.test(input.tenantId) || !UUID.test(input.requestId)) {
    throw new Error('INVALID_COMMERCIAL_COMMAND_ID');
  }
  if (!isDrvoModuleKey(input.moduleKey)) throw new Error('INVALID_MODULE');
  if (!['provision', 'suspend', 'renew', 'cancel'].includes(input.action)) {
    throw new Error('INVALID_COMMERCIAL_ACTION');
  }
  const requiresExpiry = input.action === 'provision' || input.action === 'renew';
  let validUntilUtc: string | null = null;
  if (requiresExpiry) {
    if (!input.validUntilUtc || !/Z$/.test(input.validUntilUtc)) {
      throw new Error('EXPIRY_REQUIRED');
    }
    const expiry = Date.parse(input.validUntilUtc);
    if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
      throw new Error('EXPIRY_MUST_BE_FUTURE');
    }
    validUntilUtc = new Date(expiry).toISOString();
  } else if (input.validUntilUtc !== undefined) {
    throw new Error('EXPIRY_NOT_ALLOWED_FOR_ACTION');
  }
  return {
    ...input,
    validUntilUtc,
    targetStatus: input.action === 'suspend' ? 'suspended'
      : input.action === 'cancel' ? 'disabled' : 'enabled',
  };
}
