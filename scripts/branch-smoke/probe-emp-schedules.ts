import Module from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envPath of ['.env.local', '.env']) {
  try {
    const text = readFileSync(resolve(process.cwd(), envPath), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* missing env file */
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = Module as any;
const orig = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../../src/lib/db');
  const db = await getPool();

  for (const t of ['TblEmpWorkSchedule', 'TblEmpBranchWorkSchedule']) {
    const c = await db
      .request()
      .input('t', sql.NVarChar(128), t)
      .query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME=@t ORDER BY ORDINAL_POSITION`,
      );
    console.log(
      t,
      c.recordset.map((x: { COLUMN_NAME: string }) => x.COLUMN_NAME).join(', '),
    );
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (const empId of [5, 7, 12, 18, 25]) {
    const cols = await db.request().query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME='TblEmpWorkSchedule'
    `);
    const names = new Set(
      cols.recordset.map((x: { COLUMN_NAME: string }) => x.COLUMN_NAME),
    );
    const workCol = names.has('IsWorkingDay')
      ? 'IsWorkingDay'
      : names.has('IsWorking')
        ? 'IsWorking'
        : names.has('Working')
          ? 'Working'
          : null;
    if (!workCol) {
      console.log('no work col', [...names]);
      break;
    }
    const ws = await db.request().input('e', sql.Int, empId).query(`
      SELECT DayOfWeek, ${workCol} AS IsWorking,
             CONVERT(varchar(5), StartTime, 108) AS StartTime,
             CONVERT(varchar(5), EndTime, 108) AS EndTime
      FROM dbo.TblEmpWorkSchedule WHERE EmpID=@e ORDER BY DayOfWeek
    `);
    const name = (
      await db
        .request()
        .input('e', sql.Int, empId)
        .query(`SELECT EmpName FROM dbo.TblEmp WHERE EmpID=@e`)
    ).recordset[0]?.EmpName;
    const bs = await db.request().input('e', sql.Int, empId).query(`
      SELECT BranchID, DayOfWeek, IsWorking, CONVERT(varchar(5), StartTime, 108) AS S,
             CONVERT(varchar(5), EndTime, 108) AS E
      FROM dbo.TblEmpBranchWorkSchedule
      WHERE EmpID=@e AND IsActive=1
      ORDER BY BranchID, DayOfWeek
    `);
    console.log(`\n#${empId} ${name}`);
    console.log(
      '  legacy:',
      ws.recordset
        .map(
          (r: {
            DayOfWeek: number;
            IsWorking: boolean | number;
            StartTime: string;
            EndTime: string;
          }) =>
            `${days[r.DayOfWeek]}=${r.IsWorking ? `${r.StartTime}-${r.EndTime}` : 'OFF'}`,
        )
        .join(' '),
    );
    console.log(
      '  branch:',
      bs.recordset
        .map(
          (r: {
            BranchID: number;
            DayOfWeek: number;
            IsWorking: boolean | number;
            S: string;
            E: string;
          }) =>
            `b${r.BranchID}:${days[r.DayOfWeek]}=${r.IsWorking ? `${r.S}-${r.E}` : 'OFF'}`,
        )
        .join(' ') || '(none)',
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
