import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';

/** Sale invoice types handled by InsCashMoveSales and Treasury sale posting. */
export type SaleInvType = 'مبيعات' | 'مبيعات بالكارت' | 'م.مبيعات' | 'م.مبيعات بالكارت';

export interface PostSaleCommand {
  tenantId: string;
  /** Pre-allocated sale invoice id — same value written to TblinvServHead.invID. */
  saleInvId: number;
  invType: SaleInvType;
  invDate: string | Date;
  invTime: string;
  clientId: number | null;
  amount: number;
  inOut: 'in' | 'out';
  notes: string;
  shiftMoveId: number | null;
  paymentMethodId: number;
  branchId: number;
  businessDayId: number | null;
  sourceRef: string;
  idempotencyKey: string;
}

export interface SaleCashMovePort {
  postSale(tx: Transaction, actor: ActorContext, command: PostSaleCommand): Promise<number>;
}
