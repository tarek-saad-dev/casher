import { roundMoney } from '@/lib/reportMonthUtils';
import type { PartnersExpenseCategoryTransaction } from '@/lib/types/partners-report';

export function sumPartnersExpenseCategoryTransactions(
  transactions: PartnersExpenseCategoryTransaction[]
): number {
  return roundMoney(transactions.reduce((sum, row) => sum + row.amount, 0));
}
