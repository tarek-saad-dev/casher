import 'server-only';
import type { MoneyDirection, PostCommand } from '../public/moneyMovement';

export type LegacyInvType = 'ايرادات' | 'مصروفات';

export function resolveLegacyInvType(command: PostCommand): LegacyInvType {
  if (command.invType === 'income') return 'ايرادات';
  if (command.invType === 'expense') return 'مصروفات';
  if (command.reason === 'income' || command.reason === 'transfer_in') return 'ايرادات';
  if (command.reason === 'expense' || command.reason === 'transfer_out') return 'مصروفات';
  if (command.direction === 'in') return 'ايرادات';
  return 'مصروفات';
}

export function resolveLegacyInOut(direction: MoneyDirection): 'in' | 'out' {
  return direction;
}

export function oppositeDirection(direction: MoneyDirection): MoneyDirection {
  return direction === 'in' ? 'out' : 'in';
}

export function isSaleReason(reason: string): boolean {
  return reason === 'sale' || reason === 'sale_split';
}

export function allocateInvTypeSeed(invType: LegacyInvType): string {
  return invType;
}
