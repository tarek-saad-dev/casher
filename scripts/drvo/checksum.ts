import crypto from 'crypto';
import fs from 'fs';

export function sha256Hex(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function checksumFile(filePath: string): string {
  return sha256Hex(fs.readFileSync(filePath, 'utf8'));
}

export function checksumFiles(filePaths: string[]): string {
  const combined = filePaths
    .map((p) => `${p}\n${fs.readFileSync(p, 'utf8')}`)
    .join('\n---\n');
  return sha256Hex(combined);
}
