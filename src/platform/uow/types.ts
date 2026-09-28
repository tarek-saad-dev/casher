import type { Transaction, Request } from 'mssql';

export interface UnitOfWorkContext {
  transaction: Transaction;
  request(): Request;
}

export type UnitOfWorkFn<T> = (ctx: UnitOfWorkContext) => Promise<T>;
