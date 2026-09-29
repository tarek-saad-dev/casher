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

export interface OpenDayResult {
  businessDayId: number;
  locationId: number;
  businessDate: string;
}

export interface CloseDayResult {
  businessDayId: number;
  locationId: number;
  businessDate: string;
  closedShifts: number;
}

export interface OpenShiftResult {
  shiftInstanceId: number;
  locationId: number;
  businessDayId: number;
  businessDate: string;
  shiftDefinitionId: number;
}

export interface CloseShiftResult {
  shiftInstanceId: number;
  locationId: number;
  businessDayId: number;
  businessDate: string;
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
  openDay(
    tx: Transaction,
    actor: ActorContext,
    input: { locationId: number; businessDate?: string },
  ): Promise<OpenDayResult>;
  closeDay(
    tx: Transaction,
    actor: ActorContext,
    input: { locationId: number; forceCloseShifts?: boolean },
  ): Promise<CloseDayResult>;
  openShift(
    tx: Transaction,
    actor: ActorContext,
    input: { locationId: number; shiftDefinitionId: number },
  ): Promise<OpenShiftResult>;
  closeShift(
    tx: Transaction,
    actor: ActorContext,
    input: { shiftInstanceId: number; locationId: number },
  ): Promise<CloseShiftResult>;
}
