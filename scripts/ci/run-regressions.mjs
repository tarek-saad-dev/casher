import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { GROUPS, readChangedPaths } from './select-checks.mjs';

// Existing PR regression inventory, grouped by domain. Full mode retains all
// old suites. Security and DB guard run independently in every workflow run.
export const REGRESSIONS = Object.freeze({
  "onboarding": [
    "src/platform/__tests__/publicSignup.test.ts",
    "src/platform/__tests__/publicSignupAppSelection.test.ts",
    "src/platform/__tests__/tenantOnboarding.test.ts",
    "src/platform/__tests__/onboardingWizard.test.ts",
    "src/platform/__tests__/onboardingWizardStages.test.ts",
    "src/platform/__tests__/goLiveReadiness.test.ts",
    "src/lib/hr/__tests__/tenantEmployeeCreate.test.ts"
  ],
  "commercial": [
    "src/platform/__tests__/selfServiceJourney.test.ts",
    "src/platform/__tests__/onboardingWizardStages.test.ts",
    "src/platform/__tests__/tenantBillingRequests.test.ts",
    "src/platform/__tests__/tenantBillingService.test.ts",
    "src/platform/__tests__/modularPricingScenario.test.ts",
    "src/platform/__tests__/modularQuoteEngine.test.ts",
    "src/platform/__tests__/modularCommercialDrafts.test.ts",
    "src/platform/__tests__/modularDraftSelfService.test.ts",
    "src/platform/__tests__/modularQuoteInquiry.test.ts",
    "src/platform/__tests__/modularInquiryReview.test.ts",
    "src/platform/__tests__/tariffResearchGovernance.test.ts",
    "src/platform/__tests__/tenantAppManager.test.ts",
    "src/platform/__tests__/tenantAppManagerService.test.ts",
    "src/platform/__tests__/drvo012Composition.test.ts",
    "src/platform/__tests__/drvo012Commercial.test.ts"
  ],
  "migration": [
    "scripts/drvo/__tests__",
    "src/platform/drvo/__tests__"
  ],
  "booking": [
    "src/lib/booking/__tests__/bookingBranchDefaults.test.ts",
    "src/apps/booking/__tests__/bookingPathRegression.test.ts",
    "src/apps/booking/__tests__/holdKeyPersistence.test.ts",
    "src/apps/booking/__tests__/publicBootstrapErrorLeak.test.ts",
    "src/apps/booking/__tests__/schedulingPortWiring.test.ts",
    "src/lib/__tests__/staffAddonSchedulingBehavior.test.ts",
    "src/lib/__tests__/staffAddonSchedulingGuard.test.ts",
    "src/lib/__tests__/employeePortalBookingPrivacy.test.ts",
    "src/lib/__tests__/staffBookingLifecycle.test.ts",
    "src/lib/__tests__/cashierAssistedAddonContracts.test.ts",
    "src/lib/__tests__/handoffChargeReconciliationContracts.test.ts",
    "src/lib/__tests__/handoffPaidLinePolicy.test.ts"
  ],
  "queue": [
    "src/apps/queue/__tests__/queuePortFlag.test.ts",
    "src/apps/queue/__tests__/queuePortWiring.test.ts"
  ],
  "payroll": [
    "src/lib/payroll/__tests__/payrollAgreementMath.test.ts",
    "src/lib/payroll/__tests__/retroPayrollRolloutGate.test.ts",
    "src/components/hr/__tests__/payrollAgreementDate.test.ts"
  ],
  "printing": [
    "src/lib/receipt-studio/__tests__/template.test.ts",
    "src/lib/receipt-studio/__tests__/editor.test.ts",
    "src/lib/receipt-studio/__tests__/render.test.ts",
    "src/lib/receipt-studio/__tests__/cutClassic.test.ts",
    "src/lib/receipt-studio/__tests__/layers.test.ts",
    "src/lib/__tests__/localPrintClient.test.ts",
    "src/lib/__tests__/localPrintAgentV2.test.ts",
    "src/lib/__tests__/printRecoveryPlan.test.ts",
    "src/components/printing/__tests__/PrintRecoveryCenter.test.tsx",
    "src/components/printing/__tests__/MissingChromeRepairPrompt.test.tsx",
    "src/components/printing/__tests__/PrintAgentInstallerDownload.test.tsx",
    "src/components/expenses/__tests__/ExpenseReceiptPopup.print.test.tsx",
    "src/components/printing/__tests__/LocalPrintConnectionHelp.test.tsx"
  ],
  "pos": [
    "src/apps/pos/__tests__"
  ],
  "treasury": [
    "src/apps/treasury/__tests__/deployMigration.test.ts",
    "src/apps/treasury/__tests__/importBoundaries.test.ts"
  ],
  "messaging": [
    "src/modules/messaging/__tests__/saleCustomerReceiptSend.test.ts",
    "src/modules/messaging/__tests__/phase5aCallersUnchanged.test.ts",
    "src/modules/messaging/__tests__/phase6SendTemplateMessage.test.ts",
    "src/modules/messaging/__tests__/adminWhatsAppTemplates.test.ts"
  ]
});

export function selectedFilters(groups, exists = existsSync, changed = []) {
  if (!Array.isArray(groups) || groups.some(g => !GROUPS.includes(g))) {
    throw new Error('Invalid CI regression selection');
  }
  const result = new Set(groups.flatMap(g => REGRESSIONS[g]));
  // Added by the separate onboarding PR; allow either merge order.
  const selfService = 'src/platform/__tests__/selfServiceJourney.test.ts';
  if (groups.includes('onboarding') && exists(selfService)) result.add(selfService);
  // New or edited unit tests must run too, even before their group inventory
  // is updated. DB integration tests are intentionally never opted in here.
  // CI's Node test suites run independently via node --test, not Vitest.
  for (const path of changed) {
    if (/^scripts\/ci\/[^/]+\.test\.mjs$/.test(path)) continue;
    if (/^(?:src|scripts)\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
        && !/\.integration\.test\./.test(path) && exists(path)) result.add(path);
  }
  return [...result];
}

function main() {
  const groups = JSON.parse(process.env.CI_GROUPS || 'null');
  let changed = [];
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    try { changed = readChangedPaths(process.env.CI_BASE_SHA); }
    catch { console.warn('Unable to enumerate changed tests; using selected regression inventory.'); }
  }
  const filters = selectedFilters(groups, existsSync, changed);
  if (!filters.length) {
    console.log('No domain regressions selected; mandatory checks still run.');
    return;
  }
  console.log('Running ' + filters.length + ' regression filters: ' + filters.join(', '));
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...filters, '--reporter=default'], {
    stdio: 'inherit', env: { ...process.env, INCLUDE_DB_INTEGRATION_TESTS: '0' },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
