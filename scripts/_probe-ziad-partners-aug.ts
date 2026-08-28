import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { buildPartnersMonthlyReport } = await import('@/lib/services/partnersReportService');
  const report = await buildPartnersMonthlyReport(2026, 8, 1);
  const ziad = report.employeeSummary.find((r) => r.employeeId === 12);
  console.log('Ziad partners row:', JSON.stringify(ziad, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
