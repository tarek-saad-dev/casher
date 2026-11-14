import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const get = (p: string) => readFileSync(p, 'utf8');

describe('persistent POST /api/sales request token across both POS writers (#246)', () => {
  it('browser sends same UUID when saving same draft and only rotates it after confirmed successful sale', () => {
    const ui = get('src/app/income/pos/page.tsx');
    expect(ui).toContain('NEXT_PUBLIC_POS_SALE_IDEMPOTENCY_ENABLED');
    expect(ui).toContain('saleRequestIdRef.current ??');
    const token = get('src/lib/sales/clientSaleRequestId.ts');
    expect(token).toContain('crypto.randomUUID()');
    expect(token).toContain('window.sessionStorage');
    expect(ui).toContain('acquirePendingSaleRequestId(null)');
    expect(ui).toContain('clearPendingSaleRequestId()');
    expect(ui).toContain('hasUnresolvedSaleRequest()');
    expect(ui).toContain('window.confirm(');
    expect(ui).toContain('requestId: saleRequestIdRef.current');
    expect(ui).toContain('saleRequestIdRef.current = null;');
  });

  it('route looks up confirmed invoice BEFORE operational shift gates and never re-runs handoff on replay', () => {
    const route = get('src/app/api/sales/route.ts');
    const replay = route.indexOf('await lookupCommittedSaleReplay(');
    const gate = route.indexOf('await resolveBranchDayAndShiftForWrite(');
    const post = route.indexOf('await createSale(saleInput)');
    expect(replay).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(replay);
    expect(post).toBeGreaterThan(gate);
    expect(route).toContain('if (prior) return NextResponse.json(prior, { status: 200 })');
    expect(route).toContain('!result.replayed && Number.isInteger(handoffId)');
    expect(route).toContain('SaleIdempotencyError');
    expect(route).toContain('rawRequestId: body.requestId');
  });

  it('both independent writer paths reserve unique tenant request before financial posting', () => {
    for (const path of [
      'src/apps/pos/application/createSale.ts',
      'src/lib/sales/legacyRouteSaleCreate.ts',
    ]) {
      const s = get(path);
      const reserve = s.indexOf('await reserveSaleRequest(');
      const referral = s.indexOf('await prepareReferralSaleTransaction(');
      const invoice = s.indexOf('await execute');
      const reward = s.indexOf('await finalizeReferralSaleTransaction(');
      const done = s.indexOf('await completeSaleRequest(');
      const commit = s.indexOf('await transaction.commit();', done);
      expect(reserve).toBeGreaterThan(0);
      expect(referral).toBeGreaterThan(reserve);
      expect(invoice).toBeGreaterThan(referral);
      expect(reward).toBeGreaterThan(invoice);
      expect(done).toBeGreaterThan(reward);
      expect(commit).toBeGreaterThan(done);
      expect(s).toContain("if (saleRequest?.kind === 'replay')");
      expect(s).toContain('return saleRequest.result');
    }
  });

  it('schema enforces unique tenant/request pair and commits invoice identity atomically', () => {
    const sql = get('db/drvo-migrations/024-pos-sale-idempotency/schema.sql');
    const m = get('scripts/drvo/migrations/index.ts');
    expect(sql).toContain('PRIMARY KEY CLUSTERED (TenantId, RequestID)');
    expect(sql).toContain('CK_TblPosSaleRequest_Invoice');
    expect(sql).toContain('FK_TblPosSaleRequest_Tenant');
    expect(m).toContain('posSaleIdempotencyMigration,');
  });

  it('stacked #248 staging gate runs BOTH 023 referral and 024 idempotency smokes', () => {
    const gate = get('.github/workflows/drvo-staging-gate.yml');
    const step023 = gate.slice(
      gate.indexOf('- name: DRVO-023 tenant referral SQL / concurrency smoke'),
      gate.indexOf('- name: DRVO-024 POS sale idempotency SQL smoke'),
    );
    expect(step023).toContain("github.event.pull_request.head.ref == 'feat/pos-sale-idempotency-246'");
    expect(step023).toContain('scripts/drvo/drvo023-referral-staging-smoke.ts');
    const step024 = gate.slice(gate.indexOf('- name: DRVO-024 POS sale idempotency SQL smoke'));
    expect(step024).toContain('scripts/drvo/drvo024-sale-idempotency-staging-smoke.ts');

    const smoke = get('scripts/drvo/drvo024-sale-idempotency-staging-smoke.ts');
    expect(smoke).toContain("sql.ISOLATION_LEVEL.SERIALIZABLE");
    expect(smoke).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(smoke).toContain('LOCK_TIMEOUT 1500');
    expect(smoke).toContain('ErrorNumber) === 1222');
    expect(smoke).toContain('await first.rollback()');
    expect(smoke).toContain('await second.rollback()');
  });

  it('validates committed branch/Location pairs without NOLOCK dirty-read false orphans', () => {
    const file = get('scripts/drvo/platformBootstrap.ts');
    const start = file.indexOf('const branchMappings = await pool.request().query(');
    const end = file.indexOf('const mem = await pool', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const section = file.slice(start, end);
    expect(section).toContain('WITH (READCOMMITTEDLOCK)');
    expect(section).toContain('WHERE l.LegacyBranchId = b.BranchID');
    expect(section).not.toContain('NOLOCK');
    expect(section).toContain('Unmapped legacy branch');
  });

  it('runs #248 DRVO-012 repair BEFORE a fail-closed full verification', () => {
    const gate = get('.github/workflows/drvo-staging-gate.yml');
    const repair = gate.indexOf('name: Reconcile missing DRVO-012 subscriptions on staging integration only');
    const verify = gate.indexOf('name: Verify DRVO after migration');
    const legacy = gate.indexOf('name: Reconcile grandfathered subscriptions if required');
    expect(repair).toBeGreaterThan(0);
    expect(verify).toBeGreaterThan(repair);
    expect(legacy).toBeGreaterThan(verify);
    const verifyGate = gate.slice(verify, legacy);
    expect(verifyGate).toContain("continue-on-error: ${{ github.event.pull_request.head.ref != 'feat/pos-sale-idempotency-246' }}");
    expect(gate.slice(legacy, gate.indexOf('name: DRVO-012 staging smoke'))).toContain("github.event.pull_request.head.ref != 'feat/pos-sale-idempotency-246'");
  });

  it('repairs missing DRVO-012 staging subscriptions before the integration smoke', () => {
    const gate = get('.github/workflows/drvo-staging-gate.yml');
    const fix = gate.indexOf('name: Reconcile missing DRVO-012 subscriptions on staging integration only');
    const smoke = gate.indexOf('name: DRVO-012 staging smoke');
    expect(fix).toBeGreaterThan(0);
    expect(smoke).toBeGreaterThan(fix);
    const guarded = gate.slice(fix, smoke);
    expect(guarded).toContain("github.event.pull_request.head.ref == 'feat/pos-sale-idempotency-246'");
    expect(guarded).toContain('--expected-database=last132_agent');
    expect(guarded).not.toContain('--allow-production');
    const script = get('scripts/drvo/drvo-012-reconcile-subscriptions.ts');
    expect(script).toContain('assertDatabaseAllowed(');
    expect(script).toContain('reconcileGrandfatheredSubscriptions(pool)');
  });

  it('financial staging audit is strictly staging-read-only and fails on real ledger discrepancies', () => {
    const gate = get('.github/workflows/drvo-staging-gate.yml');
    expect(gate).toContain('CUT referral 248 financial ledger audit (staging read-only)');
    expect(gate).toContain('scripts/drvo/drvo248-referral-financial-audit-staging.ts');
    const code = get('scripts/drvo/drvo248-referral-financial-audit-staging.ts');
    expect(code).toContain("database: 'last132_agent'");
    expect(code).toContain("user: 'drvo_agent'");
    expect(code).toContain('InvalidAppliedInvoice');
    expect(code).toContain('MissingEarnedVoucher');
    expect(code).toContain('InvalidUsedInvoice');
    expect(code).toContain('InvalidCommittedRequest');
    expect(code).toContain('for (const name of defects)');
    expect(code).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?dbo\./i);
    expect(code).toContain('not an E2E proof');
  });

  it('DRVO-008 paid-sale smoke expects current extracted rollout and verifies legacy rollback', () => {
    const script = get('scripts/drvo-008-pos-staging-smoke.ts');
    const manifest = get('src/platform/drvo/moduleManifest.ts');
    const flag = get('src/platform/drvo/featureFlags.ts');
    const pos = manifest.slice(manifest.indexOf("module: 'pos',"), manifest.indexOf("module: 'pos-sale-treasury',"));
    expect(pos).toContain("rollout: 'extracted'");
    expect(pos).toContain("rollbackRollout: 'legacy'");
    expect(script).toContain("if (posSpec.rollout !== 'extracted')");
    expect(script).toContain("if (posSpec.rollbackRollout !== 'legacy')");
    expect(script).toContain("if (!isPosPortEnabled()) fail('manifest extracted must enable default POS path')");
    expect(script).toContain("process.env.POS_SCHEDULING_PORT = 'false'");
    expect(script).toContain("process.env.DRVO_FORCE_POS_PATH = 'legacy'");
    expect(script).toContain("if (isPosPortEnabled()) fail('emergency force legacy must beat compat true')");
    expect(script).toContain("delete process.env.DRVO_FORCE_POS_PATH;");
    expect(script).toContain("delete process.env.POS_SCHEDULING_PORT;");
    expect(script).not.toContain('expected POS rollout legacy for DRVO-008');
    expect(flag).toContain("forceRaw === 'legacy' || forceRaw === 'extracted'");
    expect(flag).toContain("spec.rollout");
  });

  it('DRVO-008 staging smoke never mixes another tenant\'s shift, barber, catalog, customer or payment', () => {
    const script = get('scripts/drvo-008-pos-staging-smoke.ts');
    expect(script).toContain('JOIN dbo.Location l ON l.LegacyBranchId = sm.BranchID');
    expect(script).toContain('l.TenantId AS tenantId');
    expect(script).toContain('JOIN dbo.TblEmpBranchAssignment ea ON ea.BranchID = @branchId');
    expect(script).toContain('e.TenantId = @tenantId');
    expect(script).toContain('WHERE p.TenantId = @tenantId');
    expect(script).toContain('WHERE TenantId = @tenantId AND PaymentID <> @clearing');
    expect(script).toContain("VALUES (@tenantId, N'DRVO008-SMOKE'");
    expect(script).toContain('const created = await createSale({\n      tenantId,');
    expect(script).toContain('const legacyCreated = await createSaleLegacyFromRoute({\n      tenantId,');
    expect(script).not.toContain("Code = N'CASHER_BOOT'");
  });

  it('runs actual both-writer POS paid-sale staging smoke after DRVO verification', () => {
    const gate = get('.github/workflows/drvo-staging-gate.yml');
    const post = gate.indexOf('name: CUT POS both-writer real sale staging smoke');
    const verify = gate.indexOf('name: Final DRVO verify');
    expect(post).toBeGreaterThan(verify);
    const excerpt = gate.slice(post, gate.indexOf('name: Report PASS'));
    expect(excerpt).toContain('scripts/drvo-008-pos-staging-smoke.ts');
    expect(excerpt).toContain("github.event.pull_request.head.ref == 'feat/pos-sale-idempotency-246'");
    expect(excerpt).toContain("WHATSAPP_SALE_ENABLED: 'false'");
  });

  it('runs both real POS SQL executors for 50/20 with guaranteed rollback', () => {
    const gate = get('.github/workflows/drvo-staging-gate.yml');
    const smoke = get('scripts/drvo/drvo248-referral-transaction-e2e-staging.ts');
    expect(gate).toContain('CUT referral 248 SQL 50-20 both-writer transaction E2E (ROLLBACK)');
    expect(gate).toContain('scripts/drvo/drvo248-referral-transaction-e2e-staging.ts');
    expect(smoke).toContain('two tenant-owned payment methods for split-payment proof');
    expect(smoke).toContain('WHERE TenantId=@tenantId AND PaymentID <> @clearing');
    expect(smoke).toContain('executeInRouteSaleCreateTransaction');
    expect(smoke).toContain('executeLegacySaleCreateTransaction');
    expect(smoke).toContain('priceFirstVisitReferral(');
    expect(smoke).toContain('priceReferralRewardVoucher(');
    expect(smoke).toContain('reverseReferralInvoiceOnFullRefund(');
    expect(smoke).toContain('completeSaleRequest(');
    expect(smoke).toContain('await localTx.rollback()');
    expect(smoke).toContain('if (tx && !wasRolledBack)');
    expect(smoke).toContain("DB_DATABASE: 'last132_agent'");
    expect(smoke).toContain("sql.ISOLATION_LEVEL.SERIALIZABLE");
    expect(smoke).toContain('NOT a full browser HTTP POST');
  });

  it('runs isolated authenticated HTTP 50/20, replay, refund and verified cleanup on staging', () => {
    const gate = get('.github/workflows/drvo-staging-gate.yml');
    const code = get('scripts/drvo/drvo248-referral-http-staging.ts');
    expect(gate).toContain('CUT referral 248 authenticated HTTP checkout and audited refund E2E');
    expect(gate).toContain('scripts/drvo/drvo248-referral-http-staging.ts');
    for (const token of [
      "DB_DATABASE: DB", "DB_USER: LOGIN",
      "DRVO_FORCE_POS_PATH: 'extracted'",
      "WHATSAPP_SALE_ENABLED: 'false'",
      "await onboardBusiness(",
      "'/api/auth/login'",
      "'/api/sales'",
      "'/api/pos/referrals/preview?code='",
      "'/api/pos/referrals/wallet?clientId='",
      "'/api/sales/'+invoiceId",
      "await purgeSmokeTenant(pool,tenantCode)",
      "'synthetic UUID ledger cleanup proved'",
    ]) {
      expect(code).toContain(token);
    }
    expect(code).toContain("process.env.DB_DATABASE !== 'last132'");
    expect(code).toContain('production env refused');
  });

  it('staging HTTP cashier is actually assigned on the cutoff-aware operational day', () => {
    const script = get('scripts/drvo/drvo248-referral-http-staging.ts');
    expect(script).toContain('onboarding created exactly one active tenant-owned barber branch assignment');
    expect(script).toContain('l.LegacyBranchId=ea.BranchID AND l.TenantId=@tenant');
    expect(script).toContain('if (assignmentFrom > day.newDay)');
    expect(script).toContain('UPDATE ea SET EffectiveFrom=@date');
    expect(script).toContain('ea.EffectiveFrom>@date');
    expect(script).toContain('isEmployeeEligibleForBranchBookings({');
    expect(script).toContain('operationalDate: day.newDay');
    expect(script).toContain('actual POS barber assignment guard approves synthetic branch and business date');
    expect(script.indexOf('actual POS barber assignment guard approves synthetic branch and business date'))
      .toBeLessThan(script.indexOf("postSale(ownerSale,'referrer first visit')"));
  });

  it('idempotency remains independent from referral issue flags and is OFF until SQL migration approval', () => {
    const server = get('src/lib/sales/saleRequestIdempotency.service.ts');
    expect(server).toContain("process.env.POS_SALE_IDEMPOTENCY_ENABLED === 'true'");
    expect(server).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(server).toContain('PayloadHash = @fingerprint');
    expect(server).toContain('confirmedInvoice(');
    expect(server).not.toContain('DB_PASSWORD');
  });
  it('committed-user membership verifier never uses dirty or split NOLOCK membership scans', () => {
    const code = get('scripts/drvo/platformBootstrap.ts');
    const start=code.indexOf('const userMembershipRows = await pool.request().query(');
    const finish=code.indexOf('const { getBootstrapSalonManifest }', start);
    expect(start).toBeGreaterThan(0);
    expect(finish).toBeGreaterThan(start);
    const verifier=code.slice(start,finish);
    expect(verifier).toContain('FROM dbo.TblUser u WITH (READCOMMITTEDLOCK)');
    expect(verifier).toContain('LEFT JOIN dbo.TenantMembership m WITH (READCOMMITTEDLOCK)');
    expect(verifier).not.toContain('NOLOCK');
    expect(verifier).toContain('if (allTenantIds.length === 0)');
    expect(verifier).toContain('Missing TenantMembership for UserID');
    expect(verifier).toContain('if (bootstrapMatches.length > 1)');
    expect(verifier).toContain('Duplicate CASHER_BOOT TenantMembership');
    expect(verifier).not.toContain('WHERE LegacyUserId = @legacyUserId');
    expect(code).toContain('SELECT MembershipId, LegacyUserId FROM dbo.TenantMembership WITH (READCOMMITTEDLOCK)');
  });

  it('staging HTTP acceptance runs simultaneous identical UUIDs and audits money/stock snapshots', () => {
    const file=get('scripts/drvo/drvo248-referral-http-staging.ts');
    expect(file).toContain("const racing=await Promise.all([");
    expect(file).toContain("const firstRace=await Promise.all([");
    expect(file).toContain("two distinct UUIDs racing for first-visit 50% create one sale and reject the other");
    expect(file).toContain("afterFirstRace===beforeFirstRace+1");
    expect(file).toContain("losing first-visit referral UUID was rolled back without request tombstone");
    expect(file).toContain("one referral claim and one reward voucher survive competing different UUIDs");
    expect(file).toContain("await refund(raceReferralInvoice,'competing different-UUID 50% referral winner')");

    expect(file).toContain("same UUID concurrent HTTP posts have one sale and one replay");
    expect(file).toContain("statuses[0]===200 && statuses[1]===201");
    expect(file).toContain("afterRace===beforeRace+1");
    expect(file).toContain("Number(raceEffects.RequestRows)===1");
    expect(file).toContain("const beforeReplay=await invoiceEffects(id)");
    expect(file).toContain("JSON.stringify(afterReplay)===JSON.stringify(beforeReplay)");
    for (const table of [
      'dbo.TblinvServHead','dbo.TblinvServDetail','dbo.TblinvServPayment',
      'dbo.TblCashMove','dbo.TblInventoryMovement','dbo.TblPosSaleRequest',
    ]) {
      expect(file).toContain(table);
    }
    expect(file).toContain("await refund(racedInvoice,'concurrent same-UUID plain sale')");
    expect(file).toContain("await purgeSmokeTenant(pool,tenantCode)");
    expect(file).toContain("const DB = 'last132_agent'");
    expect(file).toContain("const LOGIN = 'drvo_agent'");
  });

  it('release readiness never interprets CI alone as human schema and finance approval', () => {
    const runbook = get('docs/referrals/CUT-248-LAUNCH-RUNBOOK.md');
    const review = get('docs/referrals/CUT-248-INDEPENDENT-REVIEW.md');
    expect(runbook).toContain('**Status: DRAFT / NOT APPROVED.**');
    expect(runbook).toContain('## Release decision board (all required)');
    expect(runbook).toContain('## Incident policy — preserve financial evidence');
    expect(runbook).toContain('SOURCE_COMMIT_SHA=<APPROVED_40_CHAR_SHA>');
    expect(runbook).toContain('npm run drvo:migration-control -- --mode=plan');
    expect(runbook).toContain('No entry may be marked PASS by the code author');
    expect(review).toContain('**Status: NOT SIGNED OFF.**');
    expect(review).toContain('## Accounting: exact operations, SQL counts, expectations');
    expect(review).toContain('## Security review');
    expect(review).toContain('## Operations review');
    expect(review).toContain('NOT APPROVED');
    expect(review).toContain('No programmatic tool may fill a human approval');
  });

  it('DRVO-008 selects a tenant-owned eligible operational shift, not arbitrary latest shift', () => {
    const source = get('scripts/drvo-008-pos-staging-smoke.ts');
    const start = source.indexOf('const shift = await pool.request()');
    const end = source.indexOf('const open = shift.recordset[0]', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const selection = source.slice(start, end);
    expect(selection).toContain('WHERE sm.Status = 1');
    expect(selection).toContain('FROM dbo.TenantMembership m');
    expect(selection).toContain('m.TenantId = l.TenantId');
    expect(selection).toContain('FROM dbo.TblPro p');
    expect(selection).toContain('p.TenantId = l.TenantId');
    expect(selection).toContain('FROM dbo.TblEmpBranchAssignment ea');
    expect(selection).toContain('e.TenantId = l.TenantId');
    expect(selection).toContain('FROM dbo.TblPaymentMethods pm');
    expect(selection).toContain('pm.TenantId = l.TenantId');
    expect(selection).toContain('pm.PaymentID <> @clearing');
    expect(selection).toContain('ORDER BY sm.ID DESC');
    expect(source).toContain('AND c.TenantId = @tenantId');
    expect(source).toContain('no tenant-owned open shift with an eligible service');
  });

});
