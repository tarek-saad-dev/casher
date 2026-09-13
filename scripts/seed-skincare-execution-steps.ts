/**
 * Seed skincare execution steps from skincare-execution-steps.seed.json
 * into dbo.TblProExecutionStep for matched TblPro services.
 *
 * Safe / idempotent: per matched ProID, replaceSteps() deletes only that
 * service's steps then inserts the JSON steps in order (transaction).
 *
 * Usage:
 *   npm run seed:skincare-steps              # dry-run (default)
 *   npm run seed:skincare-steps:apply        # write
 *   npx tsx scripts/seed-skincare-execution-steps.ts --dry-run [--cloud|--local]
 *   npx tsx scripts/seed-skincare-execution-steps.ts --apply [--cloud|--local]
 *
 * Defaults to cloud DB (AUDIT_DB_TARGET / --cloud). Use --local for Express.
 * Requires DB env from .env.local / .env (same as other scripts).
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import Module from 'module';

// Allow importing Next `server-only` modules from a CLI script.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = Module as any;
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

const ROOT = process.cwd();
const DEFAULT_SEED_PATH = path.join(ROOT, 'skincare-execution-steps.seed.json');

/** Packages we are allowed to seed in this script. */
const ALLOWED_KEYS = new Set(['fresh_skin', 'deep_skin_care', 'royal_skin_care']);

interface SeedStep {
  order: number;
  name: string;
  durationMin?: number | null;
}

interface SeedServicePackage {
  key: string;
  displayName: string;
  serviceNameAliases: string[];
  /** Optional explicit ProID — wins over alias matching when present. */
  proId?: number | null;
  serviceId?: number | null;
  suggestedTotalDurationMin?: number;
  steps: SeedStep[];
}

interface SeedFile {
  version?: number;
  entity?: string;
  notes?: string[];
  services: SeedServicePackage[];
}

interface ProRow {
  ProID: number;
  ProName: string;
  ProNameAr: string | null;
  CatName: string | null;
  isDeleted: boolean;
}

interface MatchResult {
  pkg: SeedServicePackage;
  status: 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS' | 'SKIPPED';
  pro?: ProRow;
  candidates?: ProRow[];
  reason?: string;
}

function loadEnvLocal(): void {
  for (const envPath of ['.env.local', '.env']) {
    try {
      const envText = readFileSync(path.join(ROOT, envPath), 'utf8');
      for (const line of envText.split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) {
          let value = match[2].trim();
          value = value.replace(/^["']|["']$/g, '');
          process.env[match[1]] = value;
        }
      }
    } catch {
      /* missing ok */
    }
  }
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // SkinCare → Skin Care
    .toLowerCase()
    .replace(/[\u0640]/g, '') // tatweel
    .replace(/[إأآا]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/[ة]/g, 'ه')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseArgs(argv: string[]): {
  apply: boolean;
  seedPath: string;
  dbTarget: 'cloud' | 'local';
} {
  const apply = argv.includes('--apply');
  const dry = argv.includes('--dry-run');
  if (apply && dry) {
    throw new Error('Use either --apply or --dry-run, not both');
  }
  const pathIdx = argv.indexOf('--seed');
  const seedPath =
    pathIdx >= 0 && argv[pathIdx + 1]
      ? path.resolve(argv[pathIdx + 1])
      : DEFAULT_SEED_PATH;

  const envTarget = String(process.env.AUDIT_DB_TARGET || '').trim().toLowerCase();
  let dbTarget: 'cloud' | 'local' =
    envTarget === 'local' ? 'local' : 'cloud';
  if (argv.includes('--local')) dbTarget = 'local';
  if (argv.includes('--cloud')) dbTarget = 'cloud';

  return { apply, seedPath, dbTarget };
}

function loadSeedFile(seedPath: string): SeedFile {
  if (!existsSync(seedPath)) {
    throw new Error(`Seed file not found: ${seedPath}`);
  }
  const raw = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedFile;
  if (!raw || !Array.isArray(raw.services)) {
    throw new Error('Seed file must contain a services array');
  }
  return raw;
}

function scoreAliasMatch(pro: ProRow, aliases: string[]): number {
  const names = [normalizeName(pro.ProName), normalizeName(pro.ProNameAr)].filter(Boolean);
  let best = 0;
  for (const alias of aliases) {
    const a = normalizeName(alias);
    if (!a) continue;
    for (const n of names) {
      if (n === a) best = Math.max(best, 100);
      else if (n.includes(a) || a.includes(n)) best = Math.max(best, 60);
    }
  }
  return best;
}

function matchPackage(pkg: SeedServicePackage, catalog: ProRow[]): MatchResult {
  if (!ALLOWED_KEYS.has(pkg.key)) {
    return { pkg, status: 'SKIPPED', reason: 'key not in allowed seed set' };
  }

  const explicitId = Number(pkg.proId ?? pkg.serviceId);
  if (Number.isFinite(explicitId) && explicitId > 0) {
    const hit = catalog.find((p) => p.ProID === explicitId && !p.isDeleted);
    if (!hit) {
      return {
        pkg,
        status: 'UNMATCHED',
        reason: `explicit proId=${explicitId} not found (or soft-deleted)`,
      };
    }
    return { pkg, status: 'MATCHED', pro: hit };
  }

  const active = catalog.filter((p) => !p.isDeleted);
  const scored = active
    .map((pro) => ({ pro, score: scoreAliasMatch(pro, pkg.serviceNameAliases) }))
    .filter((x) => x.score >= 60)
    .sort((a, b) => b.score - a.score || a.pro.ProID - b.pro.ProID);

  if (scored.length === 0) {
    return { pkg, status: 'UNMATCHED', reason: 'no alias match in TblPro' };
  }

  const top = scored[0];
  const ties = scored.filter((x) => x.score === top.score);
  // Exact-only confidence: require score 100 and unique top match
  if (top.score < 100 || ties.length > 1) {
    return {
      pkg,
      status: 'AMBIGUOUS',
      candidates: ties.map((t) => t.pro),
      reason:
        top.score < 100
          ? `best score ${top.score} is partial — refusing to guess`
          : `multiple exact matches (${ties.length}) — set proId in seed JSON`,
    };
  }

  return { pkg, status: 'MATCHED', pro: top.pro };
}

function stepsToInputs(steps: SeedStep[]) {
  const ordered = [...steps].sort((a, b) => Number(a.order) - Number(b.order));
  return ordered.map((s, i) => ({
    TitleAr: String(s.name ?? '').trim() || null,
    TitleEn: null as string | null,
    DetailAr: null as string | null,
    DetailEn: null as string | null,
    DurationMinutes:
      s.durationMin != null && Number.isFinite(Number(s.durationMin)) && Number(s.durationMin) > 0
        ? Math.round(Number(s.durationMin))
        : null,
    SortOrder: Number.isFinite(Number(s.order)) ? Number(s.order) * 10 : (i + 1) * 10,
  }));
}

function printMapping(results: MatchResult[]): void {
  console.log('\n========== SERVICE MAPPING (pre-mutation) ==========');
  for (const r of results) {
    const stepCount = r.pkg.steps?.length ?? 0;
    if (r.status === 'MATCHED' && r.pro) {
      console.log(
        `MATCHED   | ${r.pkg.key.padEnd(16)} | ProID=${String(r.pro.ProID).padStart(5)} | ` +
          `"${r.pro.ProName}"` +
          (r.pro.ProNameAr ? ` / ${r.pro.ProNameAr}` : '') +
          ` | steps=${stepCount}` +
          (r.pro.CatName ? ` | cat=${r.pro.CatName}` : ''),
      );
    } else if (r.status === 'AMBIGUOUS') {
      console.log(`AMBIGUOUS | ${r.pkg.key.padEnd(16)} | ${r.reason}`);
      for (const c of r.candidates ?? []) {
        console.log(`           candidate ProID=${c.ProID} "${c.ProName}" / ${c.ProNameAr ?? '-'}`);
      }
    } else if (r.status === 'UNMATCHED') {
      console.log(`UNMATCHED | ${r.pkg.key.padEnd(16)} | aliases=${JSON.stringify(r.pkg.serviceNameAliases)}`);
    } else {
      console.log(`SKIPPED   | ${r.pkg.key.padEnd(16)} | ${r.reason}`);
    }
  }
  console.log('====================================================\n');
}

function printPlannedRows(results: MatchResult[]): void {
  console.log('========== PLANNED ROWS (will REPLACE per ProID) ==========');
  for (const r of results.filter((x) => x.status === 'MATCHED' && x.pro)) {
    const pro = r.pro!;
    const inputs = stepsToInputs(r.pkg.steps);
    console.log(`\n${r.pkg.key} → ProID ${pro.ProID} (${pro.ProName}) — ${inputs.length} steps:`);
    for (const [i, step] of inputs.entries()) {
      console.log(
        `  ${String(i + 1).padStart(2)}. SortOrder=${step.SortOrder} ` +
          `DurationMinutes=${step.DurationMinutes ?? 'null'} ` +
          `TitleAr=${step.TitleAr}`,
      );
    }
  }
  console.log('\n===========================================================\n');
}

async function main(): Promise<void> {
  loadEnvLocal();
  const { apply, seedPath, dbTarget } = parseArgs(process.argv.slice(2));
  const mode = apply ? 'APPLY' : 'DRY-RUN';

  // Prefer cloud catalog for this operational seed unless --local is set.
  // Clear local-like class flags so getPool() does not stick on isolated Express.
  if (dbTarget === 'cloud') {
    delete process.env.HAWAI_DB_CLASS;
    delete process.env.BOOKING_V2_DB_CLASS;
    delete process.env.BOOKING_V2_FORCE_LOCAL_DB;
  }

  console.log(`[seed-skincare-steps] mode=${mode} db=${dbTarget}`);
  console.log(`[seed-skincare-steps] seed=${seedPath}`);

  const seed = loadSeedFile(seedPath);
  const packages = seed.services.filter((s) => ALLOWED_KEYS.has(s.key));
  if (packages.length === 0) {
    throw new Error('No allowed packages found in seed file');
  }

  const { getPool, setDbTarget, sql } = await import('../src/lib/db');
  await setDbTarget(dbTarget);
  const { ensureProExecutionStepsTable } = await import('../src/lib/migrations/ensureProExecutionSteps');
  const { listStepsByProId, replaceSteps } = await import('../src/lib/catalog/serviceExecutionSteps');

  const db = await getPool();
  const ready = await ensureProExecutionStepsTable(db);
  if (!ready) {
    throw new Error('TblProExecutionStep is not available');
  }

  const catalogRes = await db.request().query(`
    SELECT
      p.ProID,
      p.ProName,
      p.ProNameAr,
      c.CatName,
      CASE WHEN p.isDeleted = 1 THEN 1 ELSE 0 END AS isDeleted
    FROM dbo.TblPro p
    LEFT JOIN dbo.TblCat c ON c.CatID = p.CatID
    ORDER BY p.ProID
  `);

  const catalog: ProRow[] = (catalogRes.recordset as Record<string, unknown>[]).map((row) => ({
    ProID: Number(row.ProID),
    ProName: String(row.ProName ?? ''),
    ProNameAr: row.ProNameAr != null ? String(row.ProNameAr) : null,
    CatName: row.CatName != null ? String(row.CatName) : null,
    isDeleted: Number(row.isDeleted) === 1,
  }));

  // Helpful context: skincare-related rows for operators when aliases miss
  const skincareish = catalog.filter((p) => {
    if (p.isDeleted) return false;
    const blob = normalizeName(`${p.ProName} ${p.ProNameAr ?? ''} ${p.CatName ?? ''}`);
    return (
      blob.includes('skin') ||
      blob.includes('بشرة') ||
      blob.includes('بشره') ||
      blob.includes('سكين') ||
      normalizeName(p.CatName).includes('skincare') ||
      normalizeName(p.CatName).includes('عناية')
    );
  });
  console.log(`\nSkincare-related services in DB (${skincareish.length}):`);
  for (const p of skincareish) {
    console.log(
      `  ProID=${p.ProID} | ${p.ProName}` +
        (p.ProNameAr ? ` | ${p.ProNameAr}` : '') +
        (p.CatName ? ` | cat=${p.CatName}` : ''),
    );
  }

  const results = packages.map((pkg) => matchPackage(pkg, catalog));
  printMapping(results);
  printPlannedRows(results);

  const matched = results.filter((r) => r.status === 'MATCHED' && r.pro);
  const blocked = results.filter((r) => r.status === 'UNMATCHED' || r.status === 'AMBIGUOUS');

  if (!apply) {
    console.log(
      `[dry-run] No mutations. Matched=${matched.length}, blocked=${blocked.length}. Re-run with --apply to write.`,
    );
    process.exit(blocked.length && matched.length === 0 ? 2 : 0);
  }

  if (matched.length === 0) {
    console.error('[apply] Nothing to seed — all packages unmatched/ambiguous.');
    process.exit(2);
  }

  console.log(`[apply] Replacing steps for ${matched.length} service(s)...`);

  for (const r of matched) {
    const proId = r.pro!.ProID;
    const inputs = stepsToInputs(r.pkg.steps);
    await replaceSteps(db, proId, inputs);
    console.log(`  wrote ${inputs.length} steps → ProID ${proId} (${r.pkg.key})`);
  }

  // Validation report
  console.log('\n========== VALIDATION REPORT ==========');
  let allPass = true;
  for (const r of results) {
    const expected = r.pkg.steps.length;
    const label = r.pkg.key.toUpperCase();
    if (r.status !== 'MATCHED' || !r.pro) {
      console.log(`${label}: SKIP — ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
      if (ALLOWED_KEYS.has(r.pkg.key)) allPass = false;
      continue;
    }
    const actual = await listStepsByProId(db, r.pro.ProID);
    const expectedInputs = stepsToInputs(r.pkg.steps);
    const countOk = actual.length === expected;
    let orderOk = true;
    let namesOk = true;
    let durationsOk = true;
    for (let i = 0; i < expectedInputs.length; i++) {
      const exp = expectedInputs[i];
      const act = actual[i];
      if (!act) {
        orderOk = false;
        namesOk = false;
        durationsOk = false;
        break;
      }
      if (Number(act.SortOrder) !== Number(exp.SortOrder)) orderOk = false;
      if (String(act.TitleAr ?? '').trim() !== String(exp.TitleAr ?? '').trim()) namesOk = false;
      const expDur = exp.DurationMinutes ?? null;
      const actDur = act.DurationMinutes ?? null;
      if (expDur !== actDur) durationsOk = false;
    }
    const pass = countOk && orderOk && namesOk && durationsOk;
    if (!pass) allPass = false;
    console.log(
      `${label}: ${pass ? 'PASS' : 'FAIL'} — ServiceID ${r.pro.ProID} — ${actual.length}/${expected} steps` +
        (!pass
          ? ` [count=${countOk} order=${orderOk} names=${namesOk} durations=${durationsOk}]`
          : ''),
    );
  }
  console.log('=======================================\n');

  // Touch sql import so bundlers don't drop it if unused in some paths
  void sql;

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
