/**
 * Phase 1O — opening inventory decision options (A/B/C). No stock invented.
 */
import 'server-only';
import { BranchDomainError } from './types';
import {
  getBranchSetupPolicy,
  upsertBranchSetupPolicy,
  type OpeningInventoryOption,
} from './branchSetupPolicy';

export type OpeningInventoryDecisionPreview = {
  option: OpeningInventoryOption;
  label: string;
  description: string;
  createsMovements: boolean;
  requiresApproval: boolean;
  readinessEffect: string;
};

export const OPENING_INVENTORY_OPTIONS: OpeningInventoryDecisionPreview[] = [
  {
    option: 'ZERO_STOCK',
    label: 'A. Start with zero stock',
    description: 'Explicit admin approval; create no inventory movements.',
    createsMovements: false,
    requiresApproval: true,
    readinessEffect: 'Records zero opening stock approved; clears biz.opening_inventory only after approval.',
  },
  {
    option: 'NEW_PURCHASE',
    label: 'B. Enter newly purchased opening stock',
    description: 'Import grid: product, qty, unit cost, supplier, opening date, reason via movement APIs.',
    createsMovements: true,
    requiresApproval: true,
    readinessEffect: 'Branch-owned opening movements required before INTERNAL_LIVE.',
  },
  {
    option: 'TRANSFER_FROM_GLEEM',
    label: 'C. Transfer opening stock from GLEEM',
    description: 'Phase 1J controlled transfer — GLEEM out + Camp Caesar in, same reference.',
    createsMovements: true,
    requiresApproval: true,
    readinessEffect: 'Never copy quantities without transfer history.',
  },
];

/**
 * Record explicit option selection. ZERO_STOCK can mark approval without movements.
 * NEW_PURCHASE / TRANSFER only record the choice — stock still required separately.
 */
export async function selectOpeningInventoryOption(args: {
  branchId: number;
  option: Exclude<OpeningInventoryOption, null>;
  actorUserId: number;
  approveZeroStock?: boolean;
}): Promise<{ policy: Awaited<ReturnType<typeof getBranchSetupPolicy>>; blockerCleared: boolean }> {
  if (!OPENING_INVENTORY_OPTIONS.some((o) => o.option === args.option)) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'Invalid opening inventory option', 400);
  }

  if (args.option === 'ZERO_STOCK') {
    if (!args.approveZeroStock) {
      throw new BranchDomainError(
        'OPERATION_NOT_ALLOWED',
        'Zero-stock option requires explicit approveZeroStock=true',
        400,
      );
    }
    const policy = await upsertBranchSetupPolicy(args.branchId, {
      openingInventoryOption: 'ZERO_STOCK',
      openingInventoryApprovedByUserId: args.actorUserId,
      markOpeningInventoryApprovedNow: true,
      notes: 'ZERO_STOCK approved — no inventory movements created',
    });
    return { policy, blockerCleared: true };
  }

  const policy = await upsertBranchSetupPolicy(args.branchId, {
    openingInventoryOption: args.option,
    notes: `Opening inventory option selected: ${args.option} — awaiting movements`,
  });
  return { policy, blockerCleared: false };
}

export async function isOpeningInventoryResolved(branchId: number): Promise<boolean> {
  const policy = await getBranchSetupPolicy(branchId);
  if (!policy) return false;
  if (policy.openingInventoryOption === 'ZERO_STOCK' && policy.openingInventoryApprovedAt) {
    return true;
  }
  // B/C require movements — caller must verify qty/history separately; not auto-cleared here
  return false;
}
