#!/usr/bin/env npx tsx
import path from 'path';
import dotenv from 'dotenv';
import Module from 'module';
import sql from 'mssql';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const m = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
const orig = m._load;
m._load = function patched(request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  return orig.call(m, request, parent, isMain);
};

const APPROVAL='ROTATE_DRVO_DEMO_PASSWORD_V1';
const TENANT_CODE='DRVO_DEMO';
const LOGIN='demo.owner';

function check(v:unknown,msg:string): asserts v {
  if(!v) throw new Error(msg);
  console.log('PASS:',msg);
}

async function main(){
  check(process.env.DRVO_DEMO_PRODUCTION_APPROVAL===APPROVAL,'explicit demo credential rotation approval present');
  const password=String(process.env.DRVO_DEMO_OWNER_PASSWORD||'');
  check(password.length>=14,'new demo password supplied out-of-band');

  const {getPool,closePool}=await import('../../src/lib/db');
  const {hashPassword,verifyPassword}=await import('../../src/lib/auth/passwordHash');
  const pool=await getPool();
  try{
    const identity=(await pool.request().query("SELECT DB_NAME() db")).recordset[0];
    check(String(identity.db)==='last132','database identity = last132 production');

    const target=await pool.request()
      .input('tenantCode',sql.NVarChar(64),TENANT_CODE)
      .input('login',sql.NVarChar(50),LOGIN)
      .query(`
        SELECT u.UserID
        FROM dbo.Tenant t
        JOIN dbo.TenantMembership m ON m.TenantId=t.TenantId
        JOIN dbo.TblUser u ON u.UserID=m.LegacyUserId
        WHERE t.Code=@tenantCode AND u.loginName=@login AND ISNULL(u.isDeleted,0)=0;
      `);
    check(target.recordset.length===1,'demo owner resolved inside DRVO_DEMO only');
    const userId=Number(target.recordset[0].UserID);
    const hashed=await hashPassword(password);
    await pool.request()
      .input('userId',sql.Int,userId)
      .input('hashed',sql.NVarChar(50),hashed)
      .query('UPDATE dbo.TblUser SET Password=@hashed WHERE UserID=@userId;');

    const stored=(await pool.request().input('userId',sql.Int,userId)
      .query('SELECT Password FROM dbo.TblUser WHERE UserID=@userId;')).recordset[0]?.Password;
    check((await verifyPassword(password,String(stored||''))).ok,'rotated credential verifies');
    console.log('DRVO_DEMO_PASSWORD_ROTATION=PASS');
  } finally {
    await closePool().catch(()=>undefined);
  }
}
main().catch((err)=>{console.error('DRVO demo credential rotation fatal:',err instanceof Error?err.message:String(err));process.exit(1);});
