import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';

export type FinancialWriteScope = 'SHIFT' | 'DAY';

export interface FinancialWriteContext {
  tenantId: string;
  locationId: number;
  businessDayId: number;
  businessDate: string;
  shiftInstanceId: number | null;
  scope: FinancialWriteScope;
}

export interface OperationalCalendarPort {
  resolveFinancialWriteContext(
    tx: Transaction,
    actor: ActorContext,
    input: { locationId: number },
  ): Promise<FinancialWriteContext>;
  getBusinessDate(
    actor: ActorContext,
    input: { locationId: number; instant: Date },
  ): Promise<string>;
  hasOpenDay(
    actor: ActorContext,
    input: { locationId: number; businessDate: string },
  ): Promise<boolean>;
}
