import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MESSAGING_TENANT_SCOPED_TABLES } from '../../../../scripts/drvo/migrations/012-messaging-tenancy';

const ROOT = path.resolve(__dirname, '../../../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '__tests__', '.next'].includes(e.name)) continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, '/');
const SRC_FILES = walk(path.join(ROOT, 'src'));
const read = (p: string) => fs.readFileSync(p, 'utf8');

/** Statements whose WHERE is built from a clause list that always starts with `TenantId = @tenantId`. */
const INTERPOLATED_TENANT_WHERE_FILES = new Set([
  'src/modules/ai-control-plane/infra/sqlRepository.ts',
  'src/modules/messaging/ai/salonConcierge/sqlRepository.ts',
]);

describe('DRVO-018 static guards', () => {
  it('every SQL statement on a messaging table references TenantId', () => {
    const stmt = new RegExp(
      String.raw`\b(FROM|INTO|UPDATE|JOIN|MERGE)\s+(?:\[?dbo\]?\.)?\[?(${MESSAGING_TENANT_SCOPED_TABLES.join('|')})\]?(?![A-Za-z])`,
      'i',
    );
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      const text = read(file);
      const literal = /`([^`]*)`|'((?:[^'\\\n]|\\.)*)'/g;
      let m: RegExpExecArray | null;
      while ((m = literal.exec(text))) {
        const body = m[1] ?? m[2] ?? '';
        const hit = stmt.exec(body);
        if (!hit || /TenantId/.test(body)) continue;
        if (INTERPOLATED_TENANT_WHERE_FILES.has(rel(file)) && body.includes('${')) continue;
        offenders.push(`${rel(file)}:${text.slice(0, m.index).split('\n').length} ${hit[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the env booking actor and the shared messaging worker seam are gone', () => {
    const hits = SRC_FILES.filter((f) =>
      /AI_BOOKING_ACTOR_USER_ID|legacy-messaging-worker|legacy-client-directory/.test(read(f)),
    );
    expect(hits.map(rel)).toEqual([]);
    expect(read(path.join(ROOT, 'scripts/messaging-outbox-worker.ts'))).not.toMatch(
      /resolveLegacyBootstrapTenantId|legacy-messaging-worker/,
    );
  });

  it('the WhatsApp gateway never falls back to a process-wide bridge URL', () => {
    const client = read(path.join(ROOT, 'src/lib/integrations/whatsapp/client.ts'));
    expect(client).not.toMatch(/cfg\.apiBaseUrl/);
  });

  it('the inbound webhook handler never accepts the shared env token', () => {
    const auth = read(path.join(ROOT, 'src/modules/messaging/inbox/auth.ts'));
    expect(auth).not.toMatch(/WHATSAPP_INBOX_WEBHOOK_TOKEN/);
    expect(auth).toMatch(/findActiveChannelByTokenHash/);
  });

  it('the generic AI path carries no CUT constants (salon specifics live in the opt-in pack)', () => {
    const generic = [
      'src/modules/messaging/ai/application/processAiTurn.ts',
      'src/modules/messaging/ai/application/processAiTick.ts',
      'src/modules/messaging/ai/domain/systemInstructions.ts',
      'src/modules/messaging/ai/tenantBookingDirectory.ts',
      ...SRC_FILES.map(rel).filter(
        (f) =>
          f.startsWith('src/modules/messaging/ai/tools/') ||
          f.startsWith('src/modules/messaging/ai/planner/'),
      ),
      ...SRC_FILES.map(rel).filter((f) => f.startsWith('src/modules/messaging/tenancy/')),
    ];
    const cut = /cutsaloon|GLEEM|CAMP_CAESAR|جليم|كامب شيزار|صالون|حلاق/i;
    const offenders = generic.filter((f) => cut.test(read(path.join(ROOT, f))));
    expect(offenders).toEqual([]);
  });

  it('every messaging SQL statement on TblClient is tenant filtered (DRVO-015 owns TblClient)', () => {
    const stmt = /\b(FROM|JOIN|UPDATE|INTO)\s+(?:\[?dbo\]?\.)?\[?TblClient\]?(?![A-Za-z])/i;
    const offenders: string[] = [];
    for (const file of SRC_FILES.filter((f) => rel(f).startsWith('src/modules/messaging/'))) {
      const text = read(file);
      const literal = /`([^`]*)`|'((?:[^'\\\n]|\\.)*)'/g;
      let m: RegExpExecArray | null;
      while ((m = literal.exec(text))) {
        const body = m[1] ?? m[2] ?? '';
        if (stmt.test(body) && !/TenantId/.test(body)) {
          offenders.push(`${rel(file)}:${text.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('messaging reaches TblClient only through the tenant client directory', () => {
    const direct = SRC_FILES.map(rel).filter(
      (f) =>
        f.startsWith('src/modules/messaging/') &&
        /lookupClientIdByPhone\(/.test(read(path.join(ROOT, f))) &&
        f !== 'src/modules/messaging/contacts/tenantClientDirectory.ts',
    );
    expect(direct).toEqual([]);
  });

  it('AI tools read branches and bookings through the tenant booking directory', () => {
    const direct = SRC_FILES.map(rel).filter(
      (f) =>
        f.startsWith('src/modules/messaging/ai/') &&
        /listPublicDiscoverableBranches\(|listPublicUpcomingBookings\(/.test(read(path.join(ROOT, f))) &&
        f !== 'src/modules/messaging/ai/tenantBookingDirectory.ts',
    );
    expect(direct).toEqual([]);
  });
});
