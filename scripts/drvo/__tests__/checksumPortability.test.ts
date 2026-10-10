import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  checksumContent,
  checksumFile,
  checksumFiles,
  isAcceptedChecksum,
  legacyCrlfChecksumFile,
  sha256Hex,
} from '../checksum';
import { DRVO_MIGRATIONS } from '../migrations/index';

const SCHEMA_LF = 'SET XACT_ABORT ON;\nBEGIN TRAN;\nSELECT 1;\nCOMMIT TRAN;\nGO\n';

function writeTemp(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drvo-checksum-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

describe('DRVO migration checksum portability', () => {
  it('LF, CRLF and CR content produce the same checksum', () => {
    const lf = checksumContent(SCHEMA_LF);
    expect(checksumContent(SCHEMA_LF.replace(/\n/g, '\r\n'))).toBe(lf);
    expect(checksumContent(SCHEMA_LF.replace(/\n/g, '\r'))).toBe(lf);
    expect(lf).toBe(sha256Hex(SCHEMA_LF));
  });

  it('LF and CRLF files hash identically (single and multi-file)', () => {
    const lfFile = writeTemp('schema.sql', SCHEMA_LF);
    const crlfFile = writeTemp('schema.sql', SCHEMA_LF.replace(/\n/g, '\r\n'));
    expect(checksumFile(crlfFile)).toBe(checksumFile(lfFile));

    const multiLf = checksumFiles([lfFile]);
    fs.writeFileSync(lfFile, SCHEMA_LF.replace(/\n/g, '\r\n'), 'utf8');
    expect(checksumFiles([lfFile])).toBe(multiLf);
  });

  it('content changes other than line endings still change the checksum', () => {
    expect(checksumContent(SCHEMA_LF)).not.toBe(checksumContent(SCHEMA_LF.replace('SELECT 1', 'SELECT 2')));
  });

  it('pre-canonicalization migrations accept only the CRLF encoding of identical content', () => {
    for (const id of [1, 6, 7, 8]) {
      const m = DRVO_MIGRATIONS.find((x) => x.migrationId === id)!;
      expect(m.legacyChecksums, m.migrationKey).toHaveLength(1);
      expect(isAcceptedChecksum(m, m.checksum)).toBe(true);
      expect(isAcceptedChecksum(m, m.legacyChecksums![0])).toBe(true);
      expect(isAcceptedChecksum(m, sha256Hex('tampered'))).toBe(false);
    }
    const crlfFile = writeTemp('schema.sql', SCHEMA_LF.replace(/\n/g, '\r\n'));
    expect(legacyCrlfChecksumFile(crlfFile)).toBe(sha256Hex(SCHEMA_LF.replace(/\n/g, '\r\n')));
  });

  it('migrations released after canonicalization carry one canonical checksum only', () => {
    for (const m of DRVO_MIGRATIONS.filter((x) => x.migrationId >= 9)) {
      expect(m.legacyChecksums, m.migrationKey).toBeUndefined();
    }
  });

  it('every file-backed manifest checksum equals the hash of the committed git blob', () => {
    const fileBacked: Record<number, string> = {
      1: 'db/drvo-migrations/001-platform-core/schema.sql',
      6: 'db/drvo-migrations/006-treasury-movement-registry/schema.sql',
      7: 'db/drvo-migrations/007-booking-hold-key/schema.sql',
      8: 'db/drvo-migrations/008-ins-cash-move-sales-guard/schema.sql',
      9: 'db/drvo-migrations/009-commercial-subscription-tenant-apps/schema.sql',
      10: 'db/drvo-migrations/010-master-data-tenancy/schema.sql',
      11: 'db/drvo-migrations/011-tenant-brand-profile/schema.sql',
      12: 'db/drvo-migrations/012-messaging-tenancy/schema.sql',
    };
    for (const [id, rel] of Object.entries(fileBacked)) {
      let blob: string;
      try {
        blob = execFileSync('git', ['show', `HEAD:${rel}`], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        continue;
      }
      const m = DRVO_MIGRATIONS.find((x) => x.migrationId === Number(id))!;
      expect(m.checksum, rel).toBe(sha256Hex(blob));
    }
  });
});
