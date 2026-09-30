/**
 * Audited InsCashMoveSales cash directions from scripts/audit-branches/_insCashMoveSales.sql.
 * Return branches are not interchangeable with sale branches.
 */
export const AUDITED_SALE_CASH_DIRECTIONS = [
  { invType: 'مبيعات بالكارت', inOut: 'out', reservTimeNull: true },
  { invType: 'م.مبيعات بالكارت', inOut: 'in', reservTimeNull: false },
  { invType: 'مبيعات', inOut: 'in', reservTimeNull: true },
  { invType: 'م.مبيعات', inOut: 'out', reservTimeNull: false },
] as const;

const INV_TYPE = 'م\\.مبيعات بالكارت|مبيعات بالكارت|م\\.مبيعات|مبيعات';

type ParsedBranch = { inOut: string; reservTimeNull: boolean };

function parseSaleTriggerBranches(definition: string): {
  branches: Map<string, ParsedBranch>;
  duplicates: string[];
} {
  const branches = new Map<string, ParsedBranch>();
  const duplicates: string[] = [];

  const remember = (invType: string, branch: ParsedBranch) => {
    if (branches.has(invType)) {
      duplicates.push(invType);
      return;
    }
    branches.set(invType, branch);
  };

  const scalarRe = new RegExp(`@invType\\s*=\\s*N'(${INV_TYPE})'`, 'g');
  const scalarMatches = [...definition.matchAll(scalarRe)];
  for (let i = 0; i < scalarMatches.length; i++) {
    const invType = scalarMatches[i][1];
    const start = scalarMatches[i].index ?? 0;
    const end = i + 1 < scalarMatches.length ? (scalarMatches[i + 1].index ?? definition.length) : definition.length;
    const slice = definition.slice(start, end);
    const inOut = slice.match(/'((?:in|out))'/i)?.[1]?.toLowerCase();
    if (!inOut) continue;
    remember(invType, {
      inOut,
      reservTimeNull: /@ReseervTime\s+is\s+null/i.test(slice),
    });
  }

  const setRe = new RegExp(`i\\.invType\\s*=\\s*N'(${INV_TYPE})'`, 'g');
  for (const match of definition.matchAll(setRe)) {
    const invType = match[1];
    const at = match.index ?? 0;
    const backward = definition.slice(Math.max(0, at - 800), at);
    const insertAt = backward.toUpperCase().lastIndexOf('INSERT INTO');
    const sameInsert = insertAt >= 0 ? backward.slice(insertAt) : '';
    const inOut = sameInsert.match(/N'((?:in|out))'/i)?.[1]?.toLowerCase();
    if (!inOut) continue;
    const after = definition.slice(at);
    const nextInsert = after.search(/INSERT\s+INTO/i);
    const forward = nextInsert === -1 ? after.slice(0, 500) : after.slice(0, nextInsert);
    remember(invType, {
      inOut,
      reservTimeNull: /i\.ReservTime\s+is\s+null/i.test(forward),
    });
  }

  return { branches, duplicates };
}

export function collectInsCashMoveSalesDirectionFailures(definition: string): string[] {
  const failures: string[] = [];
  const { branches, duplicates } = parseSaleTriggerBranches(definition);
  for (const invType of duplicates) {
    failures.push(`InsCashMoveSales duplicate branch for N'${invType}'`);
  }

  for (const expected of AUDITED_SALE_CASH_DIRECTIONS) {
    const actual = branches.get(expected.invType);
    if (!actual) {
      failures.push(`InsCashMoveSales missing branch for N'${expected.invType}'`);
      continue;
    }
    if (actual.inOut !== expected.inOut) {
      failures.push(
        `InsCashMoveSales N'${expected.invType}' must insert inOut='${expected.inOut}' (found '${actual.inOut}')`,
      );
    }
    if (expected.reservTimeNull && !actual.reservTimeNull) {
      failures.push(`InsCashMoveSales N'${expected.invType}' must keep ReservTime IS NULL`);
    }
    if (!expected.reservTimeNull && actual.reservTimeNull) {
      failures.push(`InsCashMoveSales N'${expected.invType}' must not require ReservTime IS NULL`);
    }
  }

  return failures;
}
