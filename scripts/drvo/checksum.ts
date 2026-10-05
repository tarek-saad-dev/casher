import crypto from 'crypto';
import fs from 'fs';

export function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Canonical migration text: CRLF / CR become LF so a checkout with core.autocrlf
 * (Windows) hashes identically to the LF blob stored in git and checked out on Linux.
 */
export function canonicalizeMigrationText(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

export function checksumContent(content: string): string {
  return sha256Hex(canonicalizeMigrationText(content));
}

export function checksumFile(filePath: string): string {
  return checksumContent(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Checksum the same canonical content would have had if hashed from a CRLF working tree.
 * Only for migrations released before line-ending canonicalization, whose ledger rows may
 * have been recorded from a Windows checkout.
 */
export function legacyCrlfChecksumFile(filePath: string): string {
  return sha256Hex(canonicalizeMigrationText(fs.readFileSync(filePath, 'utf8')).replace(/\n/g, '\r\n'));
}

export function isAcceptedChecksum(
  migration: { checksum: string; legacyChecksums?: readonly string[] },
  appliedChecksum: string,
): boolean {
  return (
    appliedChecksum === migration.checksum ||
    (migration.legacyChecksums ?? []).includes(appliedChecksum)
  );
}

export function checksumFiles(filePaths: string[]): string {
  const combined = filePaths
    .map((p) => `${p}\n${canonicalizeMigrationText(fs.readFileSync(p, 'utf8'))}`)
    .join('\n---\n');
  return sha256Hex(combined);
}
