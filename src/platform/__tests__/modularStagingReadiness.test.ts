import fs from 'node:fs';
import path from 'node:path';
import type {ConnectionPool} from 'mssql';
import {describe,expect,it} from 'vitest';
import {
  validateModularStagingTarget,inspectModularCommercialStaging,
  MODULAR_STAGING_DATABASE,MODULAR_STAGING_LOGIN,MODULAR_STAGING_PORT,
} from '@/platform/commercial/modularStagingReadiness';
import {DRVO_MIGRATIONS} from '../../../scripts/drvo/migrations/index';

const read=(p:string)=>fs.readFileSync(path.join(process.cwd(),p),'utf8');
const valid={
  confirmed:'1',database:'last132_agent',user:'drvo_agent',
  server:'127.0.0.1',port:'14330',
};
describe('modular pricing staging preflight is isolated and read-only',()=>{
  it('permits exactly one explicitly confirmed database/login/tunnel',()=>{
    expect(()=>validateModularStagingTarget(valid)).not.toThrow();
    expect(MODULAR_STAGING_DATABASE).toBe('last132_agent');
    expect(MODULAR_STAGING_LOGIN).toBe('drvo_agent');
    expect(MODULAR_STAGING_PORT).toBe(14330);
    for(const changed of [
      {confirmed:'0'},{confirmed:undefined},{database:'last132'},
      {database:'CASHER_BOOT'},{user:'sa'},{server:'localhost'},
      {server:'192.168.1.10'},{port:'1433'},
    ])expect(()=>validateModularStagingTarget({...valid,...changed}))
      .toThrow('STAGING_TARGET_REFUSED');
  });
  it('refuses incorrect actual SQL identity before reading any stage tables',async()=>{
    let calls=0;
    const pool={request:()=>({query:async()=>{
      calls++;
      return {recordset:[{db:'real_production',originalLogin:'sa',effectiveLogin:'sa'}]};
    }})} as unknown as ConnectionPool;
    await expect(inspectModularCommercialStaging(pool))
      .rejects.toThrow('STAGING_DB_IDENTITY_MISMATCH');
    expect(calls).toBe(1);
  });
  it('checks all migration keys 15–22 and tracks journal and trusted schema constraints',()=>{
    const verify=read('src/platform/commercial/modularStagingReadiness.ts');
    const defs=DRVO_MIGRATIONS.filter(m=>m.migrationId>=15&&m.migrationId<=22);
    expect(defs.map(m=>m.migrationId)).toEqual([15,16,17,18,19,20,21,22]);
    for(const key of ['verifyTariffResearchSchema','verifyCommercialReleaseCandidates',
      'verifyCommercialPolicyEvidence','verifyInternalQuoteSnapshotSchema',
      'prepareCatalogReleaseCandidate','verifyInternalQuoteSnapshot',
      'isAcceptedChecksum','ORIGINAL_LOGIN()','SUSER_SNAME()'])
      expect(verify).toContain(key);
    expect(verify).toContain('mutationsPerformed:false');
    expect(verify).toContain('customerCheckoutTested:false');
    expect(verify).not.toMatch(/\bINSERT INTO\b|\bUPDATE dbo\.|\bDELETE FROM\b|\bDROP TABLE\b/i);
  });
  it('CI staging workflow refuses broad secrets and does not execute migrations',()=>{
    const w=read('.github/workflows/drvo-modular-staging-readonly.yml');
    expect(w).toContain("head.ref == 'agent/modular-commercial-release-gates-v1'");
    expect(w).toContain('DRVO_STAGING_SSH_KNOWN_HOSTS');
    expect(w).toContain('StrictHostKeyChecking=yes');
    expect(w).toContain('persist-credentials: false');
    expect(w).toContain('scripts/drvo/check-modular-commercial-staging.ts');
    expect(w).toContain('last132_agent');
    expect(w).not.toContain('secrets.VPS_HOST');
    expect(w).not.toContain('drvo:migrate');
    expect(w).not.toContain('drvo-012:reconcile');
    expect(w).not.toContain('ssh-keyscan');
    expect(w).not.toContain('npm run build');
  });
  it('standalone SQL script has explicit config and does not write to customer data',()=>{
    const script=read('scripts/drvo/check-modular-commercial-staging.ts');
    expect(script).toContain('DRVO_STAGING_DB_PASSWORD');
    expect(script).toContain('DRVO_MODULAR_STAGING_READ_ONLY');
    expect(script).toContain('inspectModularCommercialStaging(pool)');
    expect(script).toContain('pool.close()');
    expect(script).not.toContain('DATABASE=production');
    expect(script).not.toContain('run-migrations');
    expect(script).not.toContain('TenantSubscription');
  });
});
