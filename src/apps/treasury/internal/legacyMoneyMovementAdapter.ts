import 'server-only';
import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';
import type { MoneyMovementPort, PostCommand, ReverseCommand } from '../public/moneyMovement';

/**
 * DRVO-003 Treasury boundary adapter.
 *
 * POS sale create still posts cash via the InsCashMoveSales trigger inside the
 * sale transaction. Do not call post() for sale/sale_split here — that would
 * double-insert TblCashMove. Non-sale writers will use this port after cutover.
 */
export function createLegacyMoneyMovementAdapter(): MoneyMovementPort {
  return {
    async post(_tx: Transaction, _actor: ActorContext, command: PostCommand) {
      if (command.reason === 'sale' || command.reason === 'sale_split') {
        throw new Error(
          'Sale cash is posted by InsCashMoveSales — Treasury.post must not run for sales while the trigger is live',
        );
      }
      throw new Error(
        'MoneyMovement.post is not the active write path in DRVO-003 (trigger still live for sales)',
      );
    },

    async reverse(_tx: Transaction, _actor: ActorContext, _command: ReverseCommand) {
      throw new Error('MoneyMovement.reverse is not wired in DRVO-003 legacy adapter');
    },
  };
}
