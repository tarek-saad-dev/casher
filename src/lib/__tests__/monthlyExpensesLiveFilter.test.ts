import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('monthly expenses live cash filter', () => {
  it('category breakdown excludes reversed cash moves like expense details', () => {
    const svc = read('src/lib/services/monthlyExpensesReportService.ts');
    expect(svc).toContain('liveCashMovePredicate');
    // Total + category + advances all apply the live predicate (not only totals).
    const categoryBlock = svc.slice(
      svc.indexOf('export async function getMonthlyExpensesByCategory'),
      svc.indexOf('export async function getMonthlyEmployeeAdvances'),
    );
    expect(categoryBlock).toContain("liveCashMovePredicate('cm')");

    const advancesBlock = svc.slice(
      svc.indexOf('export async function getMonthlyEmployeeAdvances'),
    );
    expect(advancesBlock).toContain("liveCashMovePredicate('cm')");
  });

  it('partners expense details already filter live moves', () => {
    const details = read('src/lib/services/partnersExpenseCategoryDetailsService.ts');
    expect(details).toContain("liveCashMovePredicate('cm')");
  });
});
