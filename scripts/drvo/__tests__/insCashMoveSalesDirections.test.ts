import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { collectInsCashMoveSalesDirectionFailures } from '../insCashMoveSalesDirections';

const schemaPath = path.join(
  process.cwd(),
  'db/drvo-migrations/008-ins-cash-move-sales-guard/schema.sql',
);
const auditPath = path.join(process.cwd(), 'scripts/audit-branches/_insCashMoveSales.sql');

const swappedReturns = `
IF (@invType = N'مبيعات بالكارت' AND @ReseervTime IS NULL)
BEGIN
  INSERT INTO TblCashMove (inOut) VALUES ('out');
END
ELSE IF (@invType = N'م.مبيعات بالكارت')
BEGIN
  INSERT INTO TblCashMove (inOut) VALUES ('out');
END
ELSE IF (@invType = N'مبيعات' AND @ReseervTime IS NULL)
BEGIN
  INSERT INTO TblCashMove (inOut) VALUES ('in');
END
ELSE IF (@invType = N'م.مبيعات')
BEGIN
  INSERT INTO TblCashMove (inOut) VALUES ('in');
END
`;

describe('InsCashMoveSales audited directions', () => {
  it('matches the audit trigger for sale, card, and both return types', () => {
    expect(collectInsCashMoveSalesDirectionFailures(fs.readFileSync(auditPath, 'utf8'))).toEqual([]);
    expect(collectInsCashMoveSalesDirectionFailures(fs.readFileSync(schemaPath, 'utf8'))).toEqual([]);
  });

  it('rejects swapped return directions', () => {
    const failures = collectInsCashMoveSalesDirectionFailures(swappedReturns);
    expect(failures.some((f) => f.includes("N'م.مبيعات'") && f.includes("inOut='out'"))).toBe(true);
    expect(failures.some((f) => f.includes("N'م.مبيعات بالكارت'") && f.includes("inOut='in'"))).toBe(true);
    expect(failures.some((f) => f.includes("N'مبيعات'") && f.includes('must insert'))).toBe(false);
    expect(failures.some((f) => f.includes("N'مبيعات بالكارت'") && f.includes('must insert'))).toBe(false);
  });

  it('migration body keeps the treasury coexistence guard and branch inheritance', () => {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    expect(sql).toContain('TreasuryMovementRegistry');
    expect(sql).toContain("r.Kind = N'sale'");
    expect(sql).toContain('c.invID = i.invID');
    expect(sql).toContain('c.invType = i.invType');
    expect(sql).toContain('i.BranchID');
    expect(sql).toContain('BranchID IS NOT NULL');
  });
});