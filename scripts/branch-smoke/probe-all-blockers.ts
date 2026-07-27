import Module from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';
for (const envPath of ['.env.local', '.env']) {
  try {
    const text = readFileSync(resolve(process.cwd(), envPath), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* */
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};
async function main() {
  const { evaluateBranchReadiness } = await import('../../src/lib/branch/branchReadinessService');
  const r = await evaluateBranchReadiness(3);
  console.log(
    JSON.stringify(
      r.blockers.map((b) => ({ key: b.key, requiredFor: b.requiredFor, details: b.details })),
      null,
      2,
    ),
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
