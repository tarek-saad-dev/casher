import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'src');

export type BoundaryViolation = {
  file: string;
  importPath: string;
  rule: string;
};

const IMPORT_RE =
  /(?:import\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+|export\s+.*\s+from\s+)['"]([^'"]+)['"]/g;

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

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('@/')) return null;
  const target = spec.slice(2);
  const abs = path.join(ROOT, target);
  const candidates = [
    abs,
    `${abs}.ts`,
    `${abs}.tsx`,
    path.join(abs, 'index.ts'),
    path.join(abs, 'public', 'index.ts'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return toPosix(path.relative(ROOT, c));
  }
  return toPosix(target);
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

    let match: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(content))) {
      const spec = match[1];
      const resolved = resolveImport(file, spec);
      if (!resolved) continue;

      const relFile = toPosix(path.relative(ROOT, file));

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
        if (targetApp && targetApp !== fromApp && !resolved.includes('/public/')) {
          violations.push({
            file: relFile,
            importPath: spec,
            rule: 'apps must not import another app directly',
          });
        }
        if (targetApp && targetApp !== fromApp && resolved.includes('/internal/')) {
          violations.push({
            file: relFile,
            importPath: spec,
            rule: 'apps must not import another app internal path',
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
        if (resolved.includes('/apps/') && resolved.includes('/internal/')) {
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
