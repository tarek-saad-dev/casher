/**
 * DRVO-015 test double: an in-memory SQL Server stand-in for the legacy master-data tables.
 * It evaluates the narrow statement shapes the master-data repositories emit
 * (INSERT … [OUTPUT] VALUES, SELECT … FROM … WHERE, UPDATE … SET … WHERE, DELETE, IF NOT EXISTS)
 * and honours every `col = @param`, `col IN (…)` and `col LIKE @param` predicate in the
 * statement's WHERE clause. A missing tenant predicate therefore leaks rows here exactly as it
 * would against a real database. Unknown statement shapes throw so a test never passes by accident.
 */
type Row = Record<string, unknown>;

const IDENTITY: Record<string, string> = {
  TblClient: 'ClientID',
  TblPro: 'ProID',
  TblCat: 'CatID',
  TblServicePackage: 'PackageID',
  TblServicePackageItem: 'PackageItemID',
  TblPaymentMethods: 'PaymentID',
  TblExpINCat: 'ExpINID',
  TblEmp: 'EmpID',
};

export type FakeMasterDataDb = {
  tables: Record<string, Row[]>;
  statements: string[];
  reset(): void;
  rows(table: string): Row[];
};

export function createFakeMasterDataDb(): FakeMasterDataDb {
  const state: FakeMasterDataDb = {
    tables: {},
    statements: [],
    reset() {
      state.tables = {};
      state.statements = [];
      for (const t of Object.keys(IDENTITY)) state.tables[t] = [];
    },
    rows(table: string) {
      return state.tables[table] ?? [];
    },
  };
  state.reset();
  return state;
}

const same = (a: unknown, b: unknown) =>
  a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();

function normalize(text: string): string {
  return text
    .replace(/\[dbo\]\./gi, '')
    .replace(/\bdbo\./gi, '')
    .replace(/\[(\w+)\]/g, '$1')
    .replace(/WITH \((?:NOLOCK|UPDLOCK, HOLDLOCK|UPDLOCK|HOLDLOCK)\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Paren depth at each character, ignoring parens inside '…' literals. */
function depthMap(text: string): number[] {
  const depths: number[] = [];
  let depth = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && ch === '(') depth++;
    if (!quoted && ch === ')') depth--;
    depths.push(quoted ? -1 : depth);
  }
  return depths;
}

function splitStatements(text: string): string[] {
  const out: string[] = [];
  const depths = depthMap(text);
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ';' && depths[i] === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Text of the outermost WHERE clause (after the last top-level WHERE, before ORDER/GROUP BY). */
function outerWhere(stmt: string): string {
  const depths = depthMap(stmt);
  let idx = -1;
  for (let i = 0; i < stmt.length; i++) {
    if (depths[i] === 0 && /^WHERE\b/i.test(stmt.slice(i, i + 6)) && /\s/.test(stmt[i - 1] ?? ' ')) idx = i + 5;
  }
  if (idx < 0) return '';
  return stmt.slice(idx).replace(/\bORDER BY\b.*$/i, '').replace(/\bGROUP BY\b.*$/i, '');
}

function value(token: string, p: Row, ctx: { scopeIdentity: number | null }): unknown {
  const t = token.trim();
  if (t.startsWith('@')) return p[t.slice(1)];
  if (/^SCOPE_IDENTITY\(\)$/i.test(t)) return ctx.scopeIdentity;
  if (/^(GETDATE|SYSDATETIME|SYSUTCDATETIME)\(\)$/i.test(t)) return new Date();
  if (/^NULL$/i.test(t)) return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const s = /^N?'(.*)'$/.exec(t);
  if (s) return s[1];
  throw new Error(`fakeMasterDataSql: unsupported value token "${t}"`);
}

function matcher(where: string, p: Row, ctx: { scopeIdentity: number | null }): (r: Row) => boolean {
  if (!where.trim()) return () => true;
  const eqs: Array<[string, unknown]> = [];
  for (const m of where.matchAll(/(?:\b\w+\.)?(\w+)\s*=\s*(@\w+|SCOPE_IDENTITY\(\)|-?\d+|N?'[^']*')/gi)) {
    eqs.push([m[1], value(m[2], p, ctx)]);
  }
  const ins: Array<[string, number[]]> = [];
  for (const m of where.matchAll(/(?:\b\w+\.)?(\w+)\s+IN\s*\(([\d,\s]+)\)/gi)) {
    ins.push([m[1], m[2].split(',').map((x) => Number(x.trim()))]);
  }
  const likes: Array<[string, string]> = [];
  for (const m of where.matchAll(/(?:\b\w+\.)?(\w+)\s+LIKE\s+(@\w+)/gi)) {
    likes.push([m[1], String(p[m[2].slice(1)] ?? '')]);
  }
  const suffix = /=\s*@suffix\b/i.test(where) ? String(p.suffix ?? '') : null;
  const isNull = [...where.matchAll(/(?:\b\w+\.)?(\w+)\s+IS NULL/gi)].map((m) => m[1]);

  return (r: Row) => {
    for (const [col, v] of eqs) {
      if (col === 'suffix') continue;
      const rv = r[col];
      if (typeof v === 'number') {
        if (Number(rv ?? 0) !== v) return false;
      } else if (!same(rv, v)) return false;
    }
    for (const [col, list] of ins) if (!list.includes(Number(r[col]))) return false;
    if (likes.length) {
      const hit = likes.some(([col, pat]) => {
        const needle = pat.replace(/^%|%$/g, '').toLowerCase();
        return String(r[col] ?? '').toLowerCase().includes(needle);
      });
      if (!hit) return false;
    }
    if (suffix !== null && !String(r.Mobile ?? '').replace(/\D/g, '').endsWith(suffix)) return false;
    for (const col of isNull) if (r[col] != null) return false;
    return true;
  };
}

function project(stmt: string, rows: Row[]): Row[] {
  const out: Row[] = rows.map((r) => ({ ...r }));
  const aliasRe = /(?:\b\w+\.)?(\w+)\s+AS\s+(\w+)/gi;
  for (const m of stmt.matchAll(aliasRe)) {
    if (/^(INT|NVARCHAR|BIGINT)$/i.test(m[1])) continue;
    for (const r of out) if (m[1] in r) r[m[2]] = r[m[1]];
  }
  return out;
}

export function runFakeMasterDataSql(
  db: FakeMasterDataDb,
  text: string,
  params: Row,
): { recordset: Row[]; recordsets: Row[][]; rowsAffected: number[] } {
  const ctx = { scopeIdentity: null as number | null };
  let recordset: Row[] = [];
  const recordsets: Row[][] = [];
  const rowsAffected: number[] = [];
  let lastCount = 0;
  db.statements.push(normalize(text));

  const exec = (stmt: string): void => {
    if (/^COL_LENGTH|SELECT COL_LENGTH|SELECT CASE WHEN COL_LENGTH/i.test(stmt)) {
      recordset = [{ Len: null, ok: 1 }];
      recordsets.push(recordset);
      return;
    }

    const ifNotExists = /^IF NOT EXISTS \(\s*(SELECT .*?)\s*\)\s*(INSERT INTO .*)$/i.exec(stmt);
    if (ifNotExists) {
      const before = rowsAffected.length;
      exec(ifNotExists[1]);
      const found = recordset.length > 0;
      rowsAffected.length = before;
      recordsets.pop();
      recordset = [];
      if (!found) exec(ifNotExists[2]);
      return;
    }

    const ins = /^INSERT INTO (\w+) \(([^)]*)\)(?: OUTPUT (.*?))? VALUES \((.*)\)$/i.exec(stmt);
    if (ins) {
      const [, table, colText, outText, valText] = ins;
      const rows = (db.tables[table] ??= []);
      const cols = colText.split(',').map((c) => c.trim());
      const vals = valText.split(',').map((v) => value(v, params, ctx));
      const row: Row = {};
      cols.forEach((c, i) => (row[c] = vals[i]));
      if (row.TenantId == null && table in IDENTITY) {
        throw new Error(`Cannot insert the value NULL into column 'TenantId', table 'dbo.${table}'`);
      }
      const idCol = IDENTITY[table];
      if (idCol) {
        row[idCol] = rows.reduce((mx, r) => Math.max(mx, Number(r[idCol])), 0) + 1;
        ctx.scopeIdentity = Number(row[idCol]);
      }
      rows.push(row);
      lastCount = 1;
      rowsAffected.push(1);
      if (outText) {
        const outRow: Row = {};
        for (const m of outText.matchAll(/INSERTED\.(\w+)/gi)) outRow[m[1]] = row[m[1]];
        recordset = [outRow];
        recordsets.push(recordset);
      }
      return;
    }

    const upd = /^UPDATE (\w+) SET (.*?) WHERE (.*)$/i.exec(stmt);
    if (upd) {
      const [, table, setText] = upd;
      const outIdx = setText.search(/\bOUTPUT\b/i);
      const sets = (outIdx >= 0 ? setText.slice(0, outIdx) : setText).split(',').map((s) => s.trim());
      const hit = (db.tables[table] ?? []).filter(matcher(outerWhere(stmt), params, ctx));
      for (const r of hit) {
        for (const s of sets) {
          const m = /^(?:\w+\.)?(\w+)\s*=\s*(.+)$/.exec(s);
          if (!m) throw new Error(`fakeMasterDataSql: unsupported SET "${s}"`);
          r[m[1]] = value(m[2], params, ctx);
        }
      }
      lastCount = hit.length;
      rowsAffected.push(hit.length);
      if (outIdx >= 0) {
        recordset = hit.map((r) => ({ ...r }));
        recordsets.push(recordset);
      }
      return;
    }

    const del = /^DELETE FROM (\w+) WHERE (.*)$/i.exec(stmt);
    if (del) {
      const table = del[1];
      const keep = matcher(outerWhere(stmt), params, ctx);
      const rows = db.tables[table] ?? [];
      const remaining = rows.filter((r) => !keep(r));
      lastCount = rows.length - remaining.length;
      db.tables[table] = remaining;
      rowsAffected.push(lastCount);
      return;
    }

    if (/^SELECT @@ROWCOUNT AS (\w+)$/i.test(stmt)) {
      const alias = /AS (\w+)$/i.exec(stmt)![1];
      recordset = [{ [alias]: lastCount }];
      recordsets.push(recordset);
      return;
    }
    const scope = /^SELECT CAST\(SCOPE_IDENTITY\(\) AS INT\) AS (\w+)$/i.exec(stmt);
    if (scope) {
      recordset = [{ [scope[1]]: ctx.scopeIdentity }];
      recordsets.push(recordset);
      return;
    }

    const sel = /^SELECT\b(.*?)\bFROM (\w+)(?: (?!WHERE|LEFT|INNER|JOIN|ORDER)(\w+))?\b/i.exec(stmt);
    if (sel) {
      const table = sel[2];
      if (!(table in db.tables)) throw new Error(`fakeMasterDataSql: unknown table ${table}`);
      let rows = db.tables[table].filter(matcher(outerWhere(stmt), params, ctx));
      const top = /^SELECT (?:DISTINCT )?TOP \(?(\d+)\)?/i.exec(stmt);
      if (top) rows = rows.slice(0, Number(top[1]));
      recordset = project(stmt, rows);
      recordsets.push(recordset);
      rowsAffected.push(recordset.length);
      return;
    }

    throw new Error(`fakeMasterDataSql: unsupported statement: ${stmt.slice(0, 160)}`);
  };

  for (const stmt of splitStatements(normalize(text))) exec(stmt);
  return { recordset, recordsets, rowsAffected };
}

/** Drop-in `@/lib/db` module backed by the fake engine. */
export function fakeDbModule(db: FakeMasterDataDb) {
  const typeFn = (..._args: unknown[]) => ({});
  class Request {
    private params: Row = {};
    constructor(_executor?: unknown) {}
    input(name: string, ...rest: unknown[]) {
      this.params[name] = rest.length > 1 ? rest[1] : rest[0];
      return this;
    }
    async query(text: string) {
      return runFakeMasterDataSql(db, text, this.params);
    }
  }
  class Transaction {
    constructor(_pool?: unknown) {}
    async begin() {}
    async commit() {}
    async rollback() {}
    request() {
      return new Request(this);
    }
  }
  const pool = { request: () => new Request(pool) };
  const sql = {
    Int: typeFn,
    BigInt: typeFn,
    Bit: typeFn,
    Date: typeFn,
    DateTime: typeFn,
    DateTime2: typeFn,
    Decimal: typeFn,
    NVarChar: typeFn,
    VarChar: typeFn,
    UniqueIdentifier: typeFn,
    MAX: -1,
    Request,
    Transaction,
    ISOLATION_LEVEL: { READ_COMMITTED: 0, SERIALIZABLE: 1 },
  };
  return {
    sql,
    getPool: async () => pool,
    getUserFriendlyError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
    pool,
  };
}
