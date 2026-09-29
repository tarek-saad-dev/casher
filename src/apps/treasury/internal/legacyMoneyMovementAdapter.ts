import 'server-only';
import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';
import type { MoneyMovementPort, PostCommand, ReverseCommand } from '../public/moneyMovement';
import { postMoneyMovement } from './postMovement';
import { reverseMoneyMovement } from './reverseMovement';

/**
 * DRVO-007 Treasury boundary adapter — active for non-sale money movements.
 *
 * POS sale create still posts cash via InsCashMoveSales. Do not call post() for
 * sale/sale_split while that trigger is live.
 */
export function createLegacyMoneyMovementAdapter(): MoneyMovementPort {
  return {
    post(tx: Transaction, actor: ActorContext, command: PostCommand) {
      return postMoneyMovement(tx, actor, command);
    },

    reverse(tx: Transaction, actor: ActorContext, command: ReverseCommand) {
      return reverseMoneyMovement(tx, actor, command);
    },
  };
}
