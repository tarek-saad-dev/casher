import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'src');

export type BoundaryViolation = {
  file: string;
  importPath: string;
  rule: string;
};

const FROM_RE = /\bfrom\s+['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const SIDE_EFFECT_RE = /^\s*import\s+['"]([^'"]+)['"]/gm;

function listTsFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      listTsFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function moduleRootForFile(filePath: string): string | null {
  const rel = toPosix(path.relative(ROOT, filePath));
  const m =
    /^(platform|shared\/[^/]+|apps\/[^/]+|packs\/[^/]+)\//.exec(rel) ??
    (/^(platform|shared\/[^/]+|apps\/[^/]+|packs\/[^/]+)\./.exec(rel));
  if (!m) return null;
  return m[1];
}

function extractSpecifiers(content: string): string[] {
  const specs: string[] = [];
  for (const re of [FROM_RE, DYNAMIC_RE, SIDE_EFFECT_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content))) {
      specs.push(match[1]);
    }
  }
  return specs;
}

/**
 * Resolve `@/` and relative specifiers to a path under `src/`.
 * Bare package imports are ignored. Missing files still return the
 * intended path so a forbidden specifier is reported before the file exists.
 */
function resolveImport(fromFile: string, spec: string): string | null {
  let abs: string;
  if (spec.startsWith('@/')) {
    abs = path.join(ROOT, spec.slice(2));
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    abs = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null;
  }

  const candidates = [
    abs,
    `${abs}.ts`,
    `${abs}.tsx`,
    path.join(abs, 'index.ts'),
    path.join(abs, 'index.tsx'),
    path.join(abs, 'public', 'index.ts'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return toPosix(path.relative(ROOT, candidate));
    }
  }
  return toPosix(path.relative(ROOT, abs));
}

function isAppInternalPath(resolved: string): boolean {
  return /^apps\/[^/]+\/internal(?:\/|\.|$)/.test(resolved);
}

export function checkImportBoundaries(files?: string[]): BoundaryViolation[] {
  const scanFiles =
    files ??
    [
      ...listTsFiles(path.join(ROOT, 'platform')),
      ...listTsFiles(path.join(ROOT, 'shared')),
      ...listTsFiles(path.join(ROOT, 'apps')),
      ...listTsFiles(path.join(ROOT, 'packs')),
    ];

  const violations: BoundaryViolation[] = [];

  for (const file of scanFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const fromRoot = moduleRootForFile(file);
    if (!fromRoot) continue;

    const relFile = toPosix(path.relative(ROOT, file));

    for (const spec of extractSpecifiers(content)) {
      const resolved = resolveImport(file, spec);
      if (!resolved) continue;

      if (fromRoot === 'platform') {
        if (
          resolved.startsWith('shared/') ||
          resolved.startsWith('apps/') ||
          resolved.startsWith('packs/')
        ) {
          violations.push({
            file: relFile,
            importPath: spec,
            rule: 'platform must not import shared/apps/packs',
          });
        }
      }

      if (fromRoot.startsWith('apps/')) {
        const fromApp = fromRoot.split('/')[1];
        const targetApp = /^apps\/([^/]+)/.exec(resolved)?.[1];
        if (targetApp && targetApp !== fromApp) {
          violations.push({
            file: relFile,
            importPath: spec,
            rule: 'apps must not import another app directly',
          });
        }
      }

      if (fromRoot.startsWith('shared/')) {
        const fromDomain = fromRoot.split('/')[1];
        const targetDomain = /^shared\/([^/]+)/.exec(resolved)?.[1];
        if (targetDomain && targetDomain !== fromDomain) {
          violations.push({
            file: relFile,
            importPath: spec,
            rule: 'shared domains must not import another shared domain directly',
          });
        }
      }

      if (fromRoot.startsWith('packs/')) {
        if (isAppInternalPath(resolved)) {
          violations.push({
            file: relFile,
            importPath: spec,
            rule: 'packs must not import app internal paths',
          });
        }
      }
    }
  }

  return violations;
}
