import fs from 'fs';
import type { ConnectionPool } from 'mssql';

export function readSqlBatches(filePath: string): string[] {
  const text = fs.readFileSync(filePath, 'utf8');
  return text
    .split(/^\s*GO\s*$/gim)
    .map((b) => b.trim())
    .filter(Boolean);
}

export async function executeSqlFile(pool: ConnectionPool, filePath: string): Promise<void> {
  const batches = readSqlBatches(filePath);
  for (const batch of batches) {
    await pool.request().batch(batch);
  }
}
