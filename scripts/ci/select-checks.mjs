import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const GROUPS = Object.freeze([
  'onboarding', 'commercial', 'migration', 'booking', 'queue',
  'payroll', 'printing', 'pos', 'treasury', 'messaging',
]);

// Narrow allowlist. Never silently skip a file we have not classified.
// Multiple matches deliberately select the union of their dependency groups.
const rules = [
  { paths: [/^src\/app\/(?:setup|start)\//, /^src\/components\/onboarding\//,
    /^src\/components\/public\/PublicSignup/],
    groups: ['onboarding', 'commercial'] },
  { paths: [/^src\/platform\/(?:onboarding|publicSignup)\//,
    /^src\/app\/api\/(?:tenant\/onboarding|public\/signup)\//,
    /^src\/platform\/__tests__\/(?:onboardingWizard|selfServiceJourney|tenantOnboarding|goLiveReadiness|publicSignup)/],
    groups: ['onboarding', 'commercial', 'booking', 'queue', 'payroll', 'pos'] },
  { paths: [/^src\/(?:platform\/(?:commercial|apps|packs|registry)|packs)\//,
    /^src\/platform\/__tests__\/(?:tenantBilling|modular|tariffResearch|tenantAppManager|drvo012|appRegistry|pricingCatalog)/,
    /^src\/app\/(?:admin\/(?:billing|apps)|api\/tenant\/(?:billing|apps))\//],
    groups: ['commercial', 'onboarding', 'pos', 'booking', 'queue', 'treasury', 'payroll', 'messaging'] },
  { paths: [/^src\/(?:apps\/booking|lib\/booking|lib\/availability|modules\/availability|components\/bookings|app\/(?:bookings|api\/bookings))\//,
    /^src\/lib\/(?:booking[A-Z]|barberAvailability|publicBookingHelpers|schedule[A-Z])/,
    /^src\/lib\/__tests__\/(?:staffBooking|staffAddon|employeePortalBooking|cashierAssistedAddon|handoff)/],
    groups: ['booking', 'queue', 'onboarding', 'pos', 'messaging'] },
  { paths: [/^src\/(?:apps\/queue|lib\/queue|components\/queue|app\/api\/queue)\//,
    /^src\/lib\/(?:queue[A-Z]|quickQueue|operationsQueue|barberQueue)/],
    groups: ['queue', 'booking', 'pos', 'messaging'] },
  { paths: [/^src\/(?:apps\/payroll|apps\/attendance|lib\/payroll|lib\/hr|components\/payroll|components\/hr|app\/api\/(?:payroll|employees|deductions))\//,
    /^scripts\/(?:hr|payroll)\//],
    groups: ['payroll', 'onboarding', 'booking', 'pos', 'treasury'] },
  { paths: [/^print-service\//, /^public\/downloads\/(?:Install|Check)-CUT-Print-Agent\.ps1$/,
    /^src\/(?:lib\/receipt-studio|components\/receipt-studio|components\/printing|app\/api\/receipt-studio)\//,
    /^src\/lib\/(?:localPrintClient|printRecoveryPlan|printService|printBookingTicket|printQueueTicket)\./,
    /^src\/lib\/__tests__\/(?:localPrint|printRecovery)/,
    /^src\/components\/expenses\/__tests__\/ExpenseReceiptPopup\.print/],
    groups: ['printing', 'pos', 'booking', 'queue'] },
  { paths: [/^src\/(?:apps\/pos|lib\/pos|lib\/sales|components\/pos|components\/sales|app\/api\/(?:pos|sales|incomes))\//,
    /^src\/lib\/(?:posComposition|posSaleTreasuryComposition|splitPaymentService|deleteSalesInvoice)\./],
    groups: ['pos', 'treasury', 'booking', 'queue', 'printing', 'messaging', 'payroll'] },
  { paths: [/^src\/(?:apps\/treasury|lib\/treasury|components\/treasury|app\/api\/treasury)\//],
    groups: ['treasury', 'pos', 'payroll'] },
  { paths: [/^src\/(?:apps\/messaging|modules\/messaging|lib\/whatsapp|apps\/ai-receptionist)\//,
    /^scripts\/(?:messaging-|run-message|run-bot)/],
    groups: ['messaging', 'booking', 'queue', 'pos'] },
  { paths: [/^src\/lib\/branch\/assignmentIntegrity\.ts$/],
    groups: ['onboarding', 'booking', 'queue', 'payroll', 'pos'] },
];

function isDocsOnly(path) {
  return /^(?:README\.md|CHANGELOG\.md|docs\/(?!drvo\/|agent-control-plane\/).+\.md)$/.test(path);
}

export function selectChecks(paths, { full = false } = {}) {
  if (full || !Array.isArray(paths) || paths.length === 0) {
    return { groups: [...GROUPS], mode: 'full', reason: 'full request or empty/unavailable diff' };
  }
  const chosen = new Set();
  for (const path of paths) {
    if (isDocsOnly(path)) continue;
    const matches = rules.filter(rule => rule.paths.some(pattern => pattern.test(path)));
    if (!matches.length) {
      // Includes auth, tenant context, shared UI, db, migrations, dependencies,
      // workflow/test configuration and new, deleted or unfamiliar modules.
      return { groups: [...GROUPS], mode: 'full', reason: 'shared or unclassified path: ' + path };
    }
    for (const rule of matches) for (const group of rule.groups) chosen.add(group);
  }
  return { groups: GROUPS.filter(group => chosen.has(group)), mode: 'targeted', reason: 'classified diff' };
}

export function readChangedPaths(base, cwd = process.cwd()) {
  // Use the checkout merge commit (not a paginated PR-files API) and disable
  // rename detection so both old and new paths are considered. Fail closed.
  if (!/^[0-9a-f]{40}$/i.test(base ?? '')) throw new Error('Invalid base SHA');
  const raw = execFileSync('git', ['diff', '--name-only', '-z', '--no-renames', base, 'HEAD', '--'], {
    cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  return raw.split('\0').filter(Boolean);
}

function main() {
  let plan;
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    plan = selectChecks([], { full: true });
  } else {
    try {
      plan = selectChecks(readChangedPaths(process.env.CI_BASE_SHA));
    } catch (error) {
      console.warn('Diff unavailable; running all checks:', error.message);
      plan = selectChecks([], { full: true });
    }
  }
  console.log(JSON.stringify(plan));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'groups=' + JSON.stringify(plan.groups) + '\n');
    appendFileSync(process.env.GITHUB_OUTPUT, 'mode=' + plan.mode + '\n');
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    // Avoid rendering arbitrary filenames as Markdown.
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### CI selection\n\nMode: ' + plan.mode +
      '\n\nSelected regression groups: ' + (plan.groups.join(', ') || 'none (core checks still run)') + '\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
