import 'server-only';

import {
  createSale,
  type CreateSaleInput,
  type CreateSaleResult,
} from '../application/createSale';

/** Legacy route path — delegates to POS createSale until full port extraction. */
export async function createSaleLegacyFromRoute(
  input: CreateSaleInput,
): Promise<CreateSaleResult> {
  return createSale(input);
}
