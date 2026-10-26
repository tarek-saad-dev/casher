/**
 * Staging READ-ONLY verification. Refuses direct production host and missing identity.
 * Run only behind an isolated SSH tunnel at 127.0.0.1:14330.
 */
import sql from 'mssql';
import {
  inspectModularCommercialStaging,validateModularStagingTarget,
  MODULAR_STAGING_DATABASE,MODULAR_STAGING_LOGIN,MODULAR_STAGING_PORT,
} from '../../src/platform/commercial/modularStagingReadiness';

async function main(){
  validateModularStagingTarget({
    confirmed:process.env.DRVO_MODULAR_STAGING_READ_ONLY,
    database:process.env.CLOUD_DB_NAME,
    user:process.env.CLOUD_DB_USER,
    server:process.env.CLOUD_DB_SERVER,
    port:process.env.CLOUD_DB_PORT,
  });
  const password=process.env.DRVO_STAGING_DB_PASSWORD;
  if(!password)throw new Error('STAGING_PASSWORD_MISSING');
  const pool=await new sql.ConnectionPool({
    server:'127.0.0.1',port:MODULAR_STAGING_PORT,
    database:MODULAR_STAGING_DATABASE,user:MODULAR_STAGING_LOGIN,
    password,options:{encrypt:false,trustServerCertificate:true},
    connectionTimeout:15000,requestTimeout:15000,pool:{min:0,max:2},
  }).connect();
  try{
    const report=await inspectModularCommercialStaging(pool);
    // Counts and check states only. No tenant names, monetary amounts or secrets.
    console.log(JSON.stringify(report,null,2));
    if(!report.ok)process.exitCode=1;
  }finally{await pool.close();}
}
main().catch(err=>{
  console.error('DRVO modular staging read-only gate refused:',err instanceof Error?err.message:'unknown error');
  process.exitCode=1;
});
