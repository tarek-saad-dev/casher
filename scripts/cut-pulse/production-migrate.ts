#!/usr/bin/env npx tsx
/**
 * Explicit CUT Pulse production migration. Read-only by default.
 * Requires a verified database identity and operator-approved backup.
 * Never sends WhatsApp messages or edits existing business records.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPool, closePool, sql } from '../../src/lib/db';

async function main() {
 const expected=process.argv.find(x=>x.startsWith('--expected-database='))?.slice('--expected-database='.length).trim();
 const apply=process.argv.includes('--apply');
 if(!expected || !/^[A-Za-z0-9_-]{1,128}$/.test(expected))throw new Error('Specify --expected-database=<db-name>');
 if(apply && (process.env.CUT_PULSE_PRODUCTION_MIGRATION!=='YES'||!process.argv.includes('--backup-confirmed')))
  throw new Error('Apply requires CUT_PULSE_PRODUCTION_MIGRATION=YES and --backup-confirmed');
 const pool=await getPool();
 try{
  const r=await pool.request().query('SELECT DB_NAME() AS DatabaseName, @@SERVERNAME AS ServerName');
  const actual=String(r.recordset[0]?.DatabaseName??'');
  if(actual!==expected)throw new Error('Database identity mismatch: connected to '+actual+'; expected '+expected);
  const names=['TblCutPulseAutomationDraft','TblCutPulseAutomationEvent','TblCutPulseAutomationRun'];
  const exists=await pool.request().query(`SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') AND name IN ('TblCutPulseAutomationDraft','TblCutPulseAutomationEvent','TblCutPulseAutomationRun')`);
  console.log(JSON.stringify({server:r.recordset[0].ServerName,database:actual,existingTables:exists.recordset.map(x=>x.name),mode:apply?'apply':'check-only'},null,2));
  if(!apply){console.log('PASS: database identity check; no changes made.');return;}
  const schema=await fs.readFile(path.resolve('db/migrations/create-cut-pulse-automation-drafts.sql'),'utf8');
  const tx=new sql.Transaction(pool);await tx.begin();
  try{
   await new sql.Request(tx).batch(schema);
   const verify=await new sql.Request(tx).query(`SELECT name FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo') AND name IN ('TblCutPulseAutomationDraft','TblCutPulseAutomationEvent','TblCutPulseAutomationRun')`);
   const found=new Set(verify.recordset.map(x=>x.name as string));
   if(names.some(n=>!found.has(n)))throw new Error('One or more tables missing after migration');
   await tx.commit();
   console.log('PASS: CUT Pulse schema committed; three required tables present. Messaging dispatch remains disabled.');
  }catch(e){try{await tx.rollback();}catch{}throw e;}
 }finally{await closePool();}
}
main().catch(e=>{console.error('CUT Pulse migration failed:',e instanceof Error?e.message:String(e));process.exitCode=1;});
