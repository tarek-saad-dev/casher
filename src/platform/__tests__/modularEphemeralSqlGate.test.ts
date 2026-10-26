import fs from 'node:fs';
import path from 'node:path';
import {describe,expect,it} from 'vitest';

const read=(p:string)=>fs.readFileSync(path.join(process.cwd(),p),'utf8');
describe('isolated CI SQL Server gate is never a staging or prod migration action',()=>{
 it('executes against fixed temporary local port and database with explicit CI-only guard',()=>{
  const src=read('scripts/drvo/integration/modular-sql-fixture.ts');
  expect(src).toContain("HOST='127.0.0.1',PORT=14331,DB='drvo_modular_ci_fixture'");
  expect(src).toContain("process.env.DRVO_MODULAR_SQL_FIXTURE!=='1'");
  expect(src).toContain("process.env.GITHUB_ACTIONS!=='true'");
  expect(src).toContain("process.env.CI!=='true'");
  expect(src).toContain("process.env.CLOUD_DB_SERVER");
  expect(src).toContain("process.env.DB_SERVER");
  expect(src).toContain("DATABASE");
  expect(src).not.toContain('run-migrations.ts');
  expect(src).not.toContain('getPool()');
  expect(src).not.toContain('CASHER_BOOT');
 });
 it('covers real SQL DDL and composite tenant isolation, version uniqueness, manual review',()=>{
  const src=read('scripts/drvo/integration/modular-sql-fixture.ts');
  for(const name of ['019-tariff-research-review','020-commercial-release-candidates',
    '021-commercial-policy-evidence','022-internal-quote-snapshots',
    'verifyTariffResearchSchema','verifyCommercialReleaseCandidates',
    'verifyCommercialPolicyEvidence','verifyInternalQuoteSnapshotSchema',
    'candidate foreign key','duplicate source candidate',
    'candidate approval state forbidden','self-review forbidden by SQL',
    'duplicate evidence revision','cross-tenant composite request foreign key',
    'paid snapshot status forbidden','snapshot over 48h expiry forbidden',
    'duplicate tenant/request/candidate','verifyInternalQuoteSnapshot'])
    expect(src).toContain(name);
 });
 it('ephemeral GitHub workflow has no user secrets, no production fallback or release steps',()=>{
  const w=read('.github/workflows/drvo-modular-ephemeral-sql.yml');
  expect(w).toContain('mcr.microsoft.com/mssql/server:2022-latest');
  expect(w).toContain("head.ref == 'agent/modular-commercial-release-gates-v1'");
  expect(w).toContain('DRVO_MODULAR_SQL_FIXTURE');
  expect(w).toContain('14331:1433');
  expect(w).toContain('scripts/drvo/integration/modular-sql-fixture.ts');
  expect(w).toContain('persist-credentials: false');
  expect(w).not.toContain('secrets.');
  expect(w).not.toContain('DRVO_STAGING_DB_PASSWORD');
  expect(w).not.toContain('VPS_HOST');
  expect(w).not.toContain('npm run drvo:migrate');
  expect(w).not.toContain('npm run deploy');
 });
});
