import { getPool, sql } from '@/lib/db';
import type { ArtifactStatus, SubmissionStatus } from '../domain/enums';
import type { LearningArtifact, LearningAuditEvent, LearningSubmission, ProposedArtifact } from '../domain/types';
import type { ControlPlaneStore } from './memoryStore';

export async function probeControlPlaneTables(): Promise<{ ready: boolean; tables: Record<string, boolean> }> {
  const pool = await getPool();
  const tables = ['TblAiLearningSubmission', 'TblAiLearningArtifact', 'TblAiLearningAuditEvent'];
  const result: Record<string, boolean> = {};
  for (const t of tables) {
    const r = await pool.request().query(`SELECT OBJECT_ID(N'dbo.${t}', N'U') AS oid`);
    result[t] = r.recordset[0]?.oid != null;
  }
  const ready = Object.values(result).every(Boolean);
  return { ready, tables: result };
}

function mapSubmission(row: Record<string, unknown>): LearningSubmission {
  return {
    submissionId: Number(row.SubmissionID),
    rawInput: String(row.RawInput),
    sourceType: String(row.SourceType) as LearningSubmission['sourceType'],
    submittedByUserId: Number(row.SubmittedByUserID),
    contextJson: row.ContextJson ? JSON.parse(String(row.ContextJson)) : null,
    status: String(row.Status) as SubmissionStatus,
    interpreterVersion: row.InterpreterVersion != null ? String(row.InterpreterVersion) : null,
    modelName: row.ModelName != null ? String(row.ModelName) : null,
    createdAt: new Date(String(row.CreatedAt)),
    updatedAt: new Date(String(row.UpdatedAt)),
  };
}

function mapArtifact(row: Record<string, unknown>): LearningArtifact {
  return {
    artifactId: Number(row.ArtifactID),
    submissionId: Number(row.SubmissionID),
    artifactType: String(row.ArtifactType) as LearningArtifact['artifactType'],
    domain: String(row.Domain) as LearningArtifact['domain'],
    scopeType: String(row.ScopeType) as LearningArtifact['scopeType'],
    scopeKey: row.ScopeKey != null ? String(row.ScopeKey) : null,
    targetLayer: String(row.TargetLayer) as LearningArtifact['targetLayer'],
    entityType: row.EntityType != null ? (String(row.EntityType) as LearningArtifact['entityType']) : null,
    entityId: row.EntityID != null ? Number(row.EntityID) : null,
    entityCode: row.EntityCode != null ? String(row.EntityCode) : null,
    topicKey: String(row.TopicKey),
    normalizedKey: String(row.NormalizedKey),
    title: String(row.Title),
    summary: String(row.Summary),
    structuredPayload: JSON.parse(String(row.StructuredPayloadJson)),
    authorityClass: String(row.AuthorityClass) as LearningArtifact['authorityClass'],
    priority: Number(row.Priority),
    confidence: Number(row.Confidence),
    status: String(row.Status) as LearningArtifact['status'],
    version: Number(row.Version),
    supersedesArtifactId: row.SupersedesArtifactID != null ? Number(row.SupersedesArtifactID) : null,
    effectiveFrom: row.EffectiveFrom != null ? String(row.EffectiveFrom) : null,
    effectiveUntil: row.EffectiveUntil != null ? String(row.EffectiveUntil) : null,
    createdByUserId: Number(row.CreatedByUserID),
    approvedByUserId: row.ApprovedByUserID != null ? Number(row.ApprovedByUserID) : null,
    approvedAt: row.ApprovedAt != null ? new Date(String(row.ApprovedAt)) : null,
    createdAt: new Date(String(row.CreatedAt)),
    updatedAt: new Date(String(row.UpdatedAt)),
  };
}

export class SqlControlPlaneStore implements ControlPlaneStore {
  async createSubmission(input: {
    rawInput: string;
    sourceType: LearningSubmission['sourceType'];
    submittedByUserId: number;
    contextJson: Record<string, unknown> | null;
  }): Promise<LearningSubmission> {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('raw', sql.NVarChar(4000), input.rawInput)
      .input('source', sql.NVarChar(40), input.sourceType)
      .input('userId', sql.Int, input.submittedByUserId)
      .input('ctx', sql.NVarChar(sql.MAX), input.contextJson ? JSON.stringify(input.contextJson) : null)
      .query(`
        INSERT INTO dbo.TblAiLearningSubmission (RawInput, SourceType, SubmittedByUserID, ContextJson, Status)
        OUTPUT INSERTED.*
        VALUES (@raw, @source, @userId, @ctx, N'RECEIVED')
      `);
    return mapSubmission(r.recordset[0] as Record<string, unknown>);
  }

  async getSubmission(submissionId: number): Promise<LearningSubmission | null> {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.BigInt, submissionId)
      .query('SELECT * FROM dbo.TblAiLearningSubmission WHERE SubmissionID = @id');
    const row = r.recordset[0];
    return row ? mapSubmission(row as Record<string, unknown>) : null;
  }

  async updateSubmission(
    submissionId: number,
    patch: Partial<Pick<LearningSubmission, 'status' | 'interpreterVersion' | 'modelName' | 'sourceType'>>,
  ): Promise<LearningSubmission> {
    const pool = await getPool();
    const sets: string[] = ['UpdatedAt = SYSUTCDATETIME()'];
    const req = pool.request().input('id', sql.BigInt, submissionId);
    if (patch.status) { sets.push('Status = @status'); req.input('status', sql.NVarChar(30), patch.status); }
    if (patch.interpreterVersion !== undefined) { sets.push('InterpreterVersion = @iv'); req.input('iv', sql.NVarChar(60), patch.interpreterVersion); }
    if (patch.modelName !== undefined) { sets.push('ModelName = @mn'); req.input('mn', sql.NVarChar(120), patch.modelName); }
    if (patch.sourceType) { sets.push('SourceType = @st'); req.input('st', sql.NVarChar(40), patch.sourceType); }
    const r = await req.query(`UPDATE dbo.TblAiLearningSubmission SET ${sets.join(', ')} OUTPUT INSERTED.* WHERE SubmissionID = @id`);
    return mapSubmission(r.recordset[0] as Record<string, unknown>);
  }

  async listSubmissions(limit = 50): Promise<LearningSubmission[]> {
    const pool = await getPool();
    const r = await pool.request().input('lim', sql.Int, limit)
      .query('SELECT TOP (@lim) * FROM dbo.TblAiLearningSubmission ORDER BY CreatedAt DESC');
    return r.recordset.map((row: Record<string, unknown>) => mapSubmission(row));
  }

  async createArtifacts(submissionId: number, proposals: ProposedArtifact[], createdByUserId: number): Promise<LearningArtifact[]> {
    const pool = await getPool();
    const created: LearningArtifact[] = [];
    for (const p of proposals) {
      const r = await pool
        .request()
        .input('sid', sql.BigInt, submissionId)
        .input('atype', sql.NVarChar(40), p.artifactType)
        .input('domain', sql.NVarChar(40), p.domain)
        .input('scopeType', sql.NVarChar(30), p.scopeType)
        .input('scopeKey', sql.NVarChar(200), p.scopeKey)
        .input('targetLayer', sql.NVarChar(40), p.targetLayer)
        .input('entityType', sql.NVarChar(20), p.entityType)
        .input('entityId', sql.Int, p.entityId)
        .input('entityCode', sql.NVarChar(80), p.entityCode)
        .input('topicKey', sql.NVarChar(200), p.topicKey)
        .input('normKey', sql.NVarChar(300), p.normalizedKey)
        .input('title', sql.NVarChar(300), p.title)
        .input('summary', sql.NVarChar(1000), p.summary)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(p.structuredPayload))
        .input('auth', sql.NVarChar(40), p.authorityClass)
        .input('priority', sql.Int, p.priority)
        .input('conf', sql.Decimal(5, 4), p.confidence)
        .input('userId', sql.Int, createdByUserId)
        .input('effFrom', sql.DateTime2, p.effectiveFrom ? new Date(p.effectiveFrom) : null)
        .input('effUntil', sql.DateTime2, p.effectiveUntil ? new Date(p.effectiveUntil) : null)
        .query(`
          INSERT INTO dbo.TblAiLearningArtifact (
            SubmissionID, ArtifactType, Domain, ScopeType, ScopeKey, TargetLayer,
            EntityType, EntityID, EntityCode, TopicKey, NormalizedKey, Title, Summary,
            StructuredPayloadJson, AuthorityClass, Priority, Confidence, Status, CreatedByUserID,
            EffectiveFrom, EffectiveUntil
          )
          OUTPUT INSERTED.*
          VALUES (
            @sid, @atype, @domain, @scopeType, @scopeKey, @targetLayer,
            @entityType, @entityId, @entityCode, @topicKey, @normKey, @title, @summary,
            @payload, @auth, @priority, @conf, N'NEEDS_REVIEW', @userId,
            @effFrom, @effUntil
          )
        `);
      created.push(mapArtifact(r.recordset[0] as Record<string, unknown>));
    }
    return created;
  }

  async getArtifact(artifactId: number): Promise<LearningArtifact | null> {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.BigInt, artifactId)
      .query('SELECT * FROM dbo.TblAiLearningArtifact WHERE ArtifactID = @id');
    const row = r.recordset[0];
    return row ? mapArtifact(row as Record<string, unknown>) : null;
  }

  async listArtifacts(filter?: { submissionId?: number; status?: ArtifactStatus; normalizedKey?: string }): Promise<LearningArtifact[]> {
    const pool = await getPool();
    const clauses: string[] = ['1=1'];
    const req = pool.request();
    if (filter?.submissionId != null) { clauses.push('SubmissionID = @sid'); req.input('sid', sql.BigInt, filter.submissionId); }
    if (filter?.status) { clauses.push('Status = @st'); req.input('st', sql.NVarChar(30), filter.status); }
    if (filter?.normalizedKey) { clauses.push('NormalizedKey = @nk'); req.input('nk', sql.NVarChar(300), filter.normalizedKey); }
    const r = await req.query(`SELECT * FROM dbo.TblAiLearningArtifact WHERE ${clauses.join(' AND ')} ORDER BY CreatedAt DESC`);
    return r.recordset.map((row: Record<string, unknown>) => mapArtifact(row));
  }

  async listApprovedArtifacts(): Promise<LearningArtifact[]> {
    return this.listArtifacts({ status: 'APPROVED' });
  }

  async updateArtifact(
    artifactId: number,
    patch: Partial<Pick<LearningArtifact, 'status' | 'approvedByUserId' | 'approvedAt' | 'supersedesArtifactId' | 'version'>>,
  ): Promise<LearningArtifact> {
    const pool = await getPool();
    const sets: string[] = ['UpdatedAt = SYSUTCDATETIME()'];
    const req = pool.request().input('id', sql.BigInt, artifactId);
    if (patch.status) { sets.push('Status = @status'); req.input('status', sql.NVarChar(30), patch.status); }
    if (patch.approvedByUserId !== undefined) { sets.push('ApprovedByUserID = @abu'); req.input('abu', sql.Int, patch.approvedByUserId); }
    if (patch.approvedAt !== undefined) { sets.push('ApprovedAt = @aa'); req.input('aa', sql.DateTime2, patch.approvedAt); }
    if (patch.supersedesArtifactId !== undefined) { sets.push('SupersedesArtifactID = @sup'); req.input('sup', sql.BigInt, patch.supersedesArtifactId); }
    if (patch.version !== undefined) { sets.push('Version = @ver'); req.input('ver', sql.Int, patch.version); }
    const r = await req.query(`UPDATE dbo.TblAiLearningArtifact SET ${sets.join(', ')} OUTPUT INSERTED.* WHERE ArtifactID = @id`);
    return mapArtifact(r.recordset[0] as Record<string, unknown>);
  }

  async appendAudit(event: Omit<LearningAuditEvent, 'eventId' | 'createdAt'>): Promise<LearningAuditEvent> {
    const pool = await getPool();
    const r = await pool
      .request()
      .input('sid', sql.BigInt, event.submissionId)
      .input('aid', sql.BigInt, event.artifactId)
      .input('etype', sql.NVarChar(60), event.eventType)
      .input('actor', sql.Int, event.actorUserId)
      .input('model', sql.NVarChar(120), event.modelName)
      .input('details', sql.NVarChar(sql.MAX), JSON.stringify(event.detailsJson))
      .query(`
        INSERT INTO dbo.TblAiLearningAuditEvent (SubmissionID, ArtifactID, EventType, ActorUserID, ModelName, DetailsJson)
        OUTPUT INSERTED.*
        VALUES (@sid, @aid, @etype, @actor, @model, @details)
      `);
    const row = r.recordset[0] as Record<string, unknown>;
    return {
      eventId: Number(row.EventID),
      submissionId: row.SubmissionID != null ? Number(row.SubmissionID) : null,
      artifactId: row.ArtifactID != null ? Number(row.ArtifactID) : null,
      eventType: String(row.EventType) as LearningAuditEvent['eventType'],
      actorUserId: row.ActorUserID != null ? Number(row.ActorUserID) : null,
      modelName: row.ModelName != null ? String(row.ModelName) : null,
      detailsJson: row.DetailsJson ? JSON.parse(String(row.DetailsJson)) : {},
      createdAt: new Date(String(row.CreatedAt)),
    };
  }

  async listAudit(filter?: { submissionId?: number; artifactId?: number }): Promise<LearningAuditEvent[]> {
    const pool = await getPool();
    const clauses: string[] = ['1=1'];
    const req = pool.request();
    if (filter?.submissionId != null) { clauses.push('SubmissionID = @sid'); req.input('sid', sql.BigInt, filter.submissionId); }
    if (filter?.artifactId != null) { clauses.push('ArtifactID = @aid'); req.input('aid', sql.BigInt, filter.artifactId); }
    const r = await req.query(`SELECT * FROM dbo.TblAiLearningAuditEvent WHERE ${clauses.join(' AND ')} ORDER BY CreatedAt DESC`);
    return r.recordset.map((row: Record<string, unknown>) => ({
      eventId: Number(row.EventID),
      submissionId: row.SubmissionID != null ? Number(row.SubmissionID) : null,
      artifactId: row.ArtifactID != null ? Number(row.ArtifactID) : null,
      eventType: String(row.EventType) as LearningAuditEvent['eventType'],
      actorUserId: row.ActorUserID != null ? Number(row.ActorUserID) : null,
      modelName: row.ModelName != null ? String(row.ModelName) : null,
      detailsJson: row.DetailsJson ? JSON.parse(String(row.DetailsJson)) : {},
      createdAt: new Date(String(row.CreatedAt)),
    }));
  }
}
