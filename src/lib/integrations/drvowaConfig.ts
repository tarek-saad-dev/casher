import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

import { getLocalPool, sql } from '@/lib/db';

export type DrvowaIntegrationConfig = {
  drvowaBaseUrl: string;
  inboundApiKey: string;
  outboundTokenHash: string;
  drvowaIntegrationId: string | null;
  status: string;
  connectedAtUtc: Date | null;
  updatedAtUtc: Date;
};

type ConfigRow = {
  DrvowaBaseUrl: string;
  InboundApiKeyCiphertext: string;
  OutboundTokenHash: string;
  DrvowaIntegrationID: string | null;
  Status: string;
  ConnectedAtUtc: Date | null;
  UpdatedAtUtc: Date;
};

function secretKey(): Buffer {
  const raw = process.env.DRVOWA_CONNECTOR_SECRET?.trim();
  if (!raw) {
    throw new Error('DRVOWA_CONNECTOR_SECRET_NOT_CONFIGURED');
  }
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function hashDrvowaToken(value: string): string {
  return createHash('sha256').update(value.trim(), 'utf8').digest('hex');
}

export function generateDrvowaOutboundToken(): string {
  return `drvowa_erp_${randomBytes(32).toString('base64url')}`;
}

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

function decrypt(value: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error('INVALID_DRVOWA_SECRET_PAYLOAD');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    secretKey(),
    Buffer.from(ivRaw, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export async function getDrvowaIntegrationConfig(): Promise<DrvowaIntegrationConfig | null> {
  const pool = await getLocalPool();
  const result = await pool.request().query<ConfigRow>(`
    IF OBJECT_ID(N'dbo.TblDrvowaIntegrationConfig', N'U') IS NULL
      SELECT TOP 0
        CAST(NULL AS NVARCHAR(500)) AS DrvowaBaseUrl,
        CAST(NULL AS NVARCHAR(MAX)) AS InboundApiKeyCiphertext,
        CAST(NULL AS NVARCHAR(128)) AS OutboundTokenHash,
        CAST(NULL AS NVARCHAR(64)) AS DrvowaIntegrationID,
        CAST(NULL AS NVARCHAR(32)) AS Status,
        CAST(NULL AS DATETIME2) AS ConnectedAtUtc,
        CAST(NULL AS DATETIME2) AS UpdatedAtUtc;
    ELSE
      SELECT TOP 1
        DrvowaBaseUrl,
        InboundApiKeyCiphertext,
        OutboundTokenHash,
        DrvowaIntegrationID,
        Status,
        ConnectedAtUtc,
        UpdatedAtUtc
      FROM dbo.TblDrvowaIntegrationConfig
      WHERE ConfigID = 1;
  `);
  const row = result.recordset[0];
  if (!row) return null;
  return {
    drvowaBaseUrl: row.DrvowaBaseUrl,
    inboundApiKey: decrypt(row.InboundApiKeyCiphertext),
    outboundTokenHash: row.OutboundTokenHash,
    drvowaIntegrationId: row.DrvowaIntegrationID,
    status: row.Status,
    connectedAtUtc: row.ConnectedAtUtc,
    updatedAtUtc: row.UpdatedAtUtc,
  };
}

export async function saveDrvowaIntegrationConfig(params: {
  drvowaBaseUrl: string;
  inboundApiKey: string;
  outboundTokenHash: string;
  drvowaIntegrationId?: string | null;
  status?: string;
}): Promise<void> {
  const pool = await getLocalPool();
  await pool
    .request()
    .input('drvowaBaseUrl', sql.NVarChar(500), params.drvowaBaseUrl)
    .input('inboundApiKeyCiphertext', sql.NVarChar(sql.MAX), encrypt(params.inboundApiKey))
    .input('outboundTokenHash', sql.NVarChar(128), params.outboundTokenHash)
    .input('drvowaIntegrationId', sql.NVarChar(64), params.drvowaIntegrationId ?? null)
    .input('status', sql.NVarChar(32), params.status ?? 'ACTIVE')
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.TblDrvowaIntegrationConfig WHERE ConfigID = 1)
      BEGIN
        UPDATE dbo.TblDrvowaIntegrationConfig
        SET DrvowaBaseUrl = @drvowaBaseUrl,
            InboundApiKeyCiphertext = @inboundApiKeyCiphertext,
            OutboundTokenHash = @outboundTokenHash,
            DrvowaIntegrationID = @drvowaIntegrationId,
            Status = @status,
            ConnectedAtUtc = SYSUTCDATETIME(),
            UpdatedAtUtc = SYSUTCDATETIME()
        WHERE ConfigID = 1;
      END
      ELSE
      BEGIN
        INSERT INTO dbo.TblDrvowaIntegrationConfig (
          ConfigID, DrvowaBaseUrl, InboundApiKeyCiphertext, OutboundTokenHash,
          DrvowaIntegrationID, Status, ConnectedAtUtc, UpdatedAtUtc
        ) VALUES (
          1, @drvowaBaseUrl, @inboundApiKeyCiphertext, @outboundTokenHash,
          @drvowaIntegrationId, @status, SYSUTCDATETIME(), SYSUTCDATETIME()
        );
      END
    `);
}

export async function getDrvowaOutboundTokenHash(): Promise<string | null> {
  const pool = await getLocalPool();
  const result = await pool.request().query<{ OutboundTokenHash: string }>(`
    IF OBJECT_ID(N'dbo.TblDrvowaIntegrationConfig', N'U') IS NULL
      SELECT TOP 0 CAST(NULL AS NVARCHAR(128)) AS OutboundTokenHash;
    ELSE
      SELECT TOP 1 OutboundTokenHash
      FROM dbo.TblDrvowaIntegrationConfig
      WHERE ConfigID = 1 AND Status = N'ACTIVE';
  `);
  return result.recordset[0]?.OutboundTokenHash ?? null;
}
