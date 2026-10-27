#!/usr/bin/env npx tsx
/**
 * CUT Pulse staging-only migration + DB smoke.
 * Run only with isolated staging DB credentials. Never executes outbound WhatsApp.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPool, closePool, sql } from '../../src/lib/db';

async function main() {
 const expected=process.argv.find(x=>x.startsWith('--expected-database='))?.split('=')[1]?.trim();
 if(process.env.CUT_PULSE_STAGING_ONLY!=='1'||!expected||!process.argv.includes('--confirm-staging')) {
  throw new Error('Requires CUT_PULSE_STAGING_ONLY=1, --confirm-staging and --expected-database=<actual-staging-db>');
 }
 const pool=await getPool();
 try {
  const identity=await pool.request().query("SELECT DB_NAME() AS dbName, @@SERVERNAME AS serverName");
  const actual=String(identity.recordset[0].dbName);
  if(actual!==expected)throw new Error('Wrong database: '+actual+' (expected '+expected+')');
  if(/^(last132|HawaiRestaurant)$/i.test(actual))throw new Error('Refusing known production database name');
  console.log('Verified staging DB:',actual,'on',identity.recordset[0].serverName);
  const sqlText=await fs.readFile(path.resolve('db/migrations/create-cut-pulse-automation-drafts.sql'),'utf8');
  const tx=new sql.Transaction(pool);await tx.begin();
  try {
   await new sql.Request(tx).batch(sqlText);
   const test=await new sql.Request(tx).query(`
    SELECT
    IIF(OBJECT_ID('dbo.TblCutPulseAutomationDraft','U') IS NOT NULL,1,0) AS drafts,
    IIF(OBJECT_ID('dbo.TblCutPulseAutomationEvent','U') IS NOT NULL,1,0) AS events,
    IIF(OBJECT_ID('dbo.TblCutPulseAutomationRun','U') IS NOT NULL,1,0) AS runs;`);
   const result=test.recordset[0];
   if(!result?.drafts||!result?.events||!result?.runs)throw new Error('Schema smoke failed');
   await tx.commit();
   console.log('PASS: migration committed and all three CUT Pulse tables verified',result);
  }catch(err){await tx.rollback();throw err;}
 }finally{await closePool();}
}
main().catch(err=>{console.error('CUT Pulse staging failed:',err instanceof Error?err.message:String(err));process.exitCode=1;});
