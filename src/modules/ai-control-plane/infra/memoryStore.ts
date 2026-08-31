import type {
  ArtifactStatus,
  SubmissionStatus,
} from '../domain/enums';
import type {
  LearningArtifact,
  LearningAuditEvent,
  LearningSubmission,
  ProposedArtifact,
} from '../domain/types';

export interface ControlPlaneStore {
  createSubmission(input: {
    rawInput: string;
    sourceType: LearningSubmission['sourceType'];
    submittedByUserId: number;
    contextJson: Record<string, unknown> | null;
  }): Promise<LearningSubmission>;

  getSubmission(submissionId: number): Promise<LearningSubmission | null>;

  updateSubmission(
    submissionId: number,
    patch: Partial<Pick<LearningSubmission, 'status' | 'interpreterVersion' | 'modelName' | 'sourceType'>>,
  ): Promise<LearningSubmission>;

  listSubmissions(limit?: number): Promise<LearningSubmission[]>;

  createArtifacts(
    submissionId: number,
    proposals: ProposedArtifact[],
    createdByUserId: number,
  ): Promise<LearningArtifact[]>;

  getArtifact(artifactId: number): Promise<LearningArtifact | null>;

  listArtifacts(filter?: {
    submissionId?: number;
    status?: ArtifactStatus;
    normalizedKey?: string;
  }): Promise<LearningArtifact[]>;

  listApprovedArtifacts(): Promise<LearningArtifact[]>;

  updateArtifact(
    artifactId: number,
    patch: Partial<
      Pick<
        LearningArtifact,
        | 'status'
        | 'approvedByUserId'
        | 'approvedAt'
        | 'supersedesArtifactId'
        | 'version'
      >
    >,
  ): Promise<LearningArtifact>;

  appendAudit(event: Omit<LearningAuditEvent, 'eventId' | 'createdAt'>): Promise<LearningAuditEvent>;

  listAudit(filter?: { submissionId?: number; artifactId?: number }): Promise<LearningAuditEvent[]>;
}

export class MemoryControlPlaneStore implements ControlPlaneStore {
  private submissionSeq = 1;
  private artifactSeq = 1;
  private auditSeq = 1;
  private submissions = new Map<number, LearningSubmission>();
  private artifacts = new Map<number, LearningArtifact>();
  private audits: LearningAuditEvent[] = [];

  async createSubmission(input: {
    rawInput: string;
    sourceType: LearningSubmission['sourceType'];
    submittedByUserId: number;
    contextJson: Record<string, unknown> | null;
  }): Promise<LearningSubmission> {
    const now = new Date();
    const row: LearningSubmission = {
      submissionId: this.submissionSeq++,
      rawInput: input.rawInput,
      sourceType: input.sourceType,
      submittedByUserId: input.submittedByUserId,
      contextJson: input.contextJson,
      status: 'RECEIVED',
      interpreterVersion: null,
      modelName: null,
      createdAt: now,
      updatedAt: now,
    };
    this.submissions.set(row.submissionId, row);
    return row;
  }

  async getSubmission(submissionId: number): Promise<LearningSubmission | null> {
    return this.submissions.get(submissionId) ?? null;
  }

  async updateSubmission(
    submissionId: number,
    patch: Partial<Pick<LearningSubmission, 'status' | 'interpreterVersion' | 'modelName' | 'sourceType'>>,
  ): Promise<LearningSubmission> {
    const existing = this.submissions.get(submissionId);
    if (!existing) throw new Error('Submission not found');
    const updated = { ...existing, ...patch, updatedAt: new Date() };
    this.submissions.set(submissionId, updated);
    return updated;
  }

  async listSubmissions(limit = 50): Promise<LearningSubmission[]> {
    return [...this.submissions.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async createArtifacts(
    submissionId: number,
    proposals: ProposedArtifact[],
    createdByUserId: number,
  ): Promise<LearningArtifact[]> {
    const now = new Date();
    const created: LearningArtifact[] = [];
    for (const p of proposals) {
      const row: LearningArtifact = {
        ...p,
        artifactId: this.artifactSeq++,
        submissionId,
        status: 'NEEDS_REVIEW',
        version: 1,
        supersedesArtifactId: null,
        createdByUserId,
        approvedByUserId: null,
        approvedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      this.artifacts.set(row.artifactId, row);
      created.push(row);
    }
    return created;
  }

  async getArtifact(artifactId: number): Promise<LearningArtifact | null> {
    return this.artifacts.get(artifactId) ?? null;
  }

  async listArtifacts(filter?: {
    submissionId?: number;
    status?: ArtifactStatus;
    normalizedKey?: string;
  }): Promise<LearningArtifact[]> {
    let rows = [...this.artifacts.values()];
    if (filter?.submissionId != null) {
      rows = rows.filter((a) => a.submissionId === filter.submissionId);
    }
    if (filter?.status) rows = rows.filter((a) => a.status === filter.status);
    if (filter?.normalizedKey) rows = rows.filter((a) => a.normalizedKey === filter.normalizedKey);
    return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listApprovedArtifacts(): Promise<LearningArtifact[]> {
    return this.listArtifacts({ status: 'APPROVED' });
  }

  async updateArtifact(
    artifactId: number,
    patch: Partial<
      Pick<
        LearningArtifact,
        'status' | 'approvedByUserId' | 'approvedAt' | 'supersedesArtifactId' | 'version'
      >
    >,
  ): Promise<LearningArtifact> {
    const existing = this.artifacts.get(artifactId);
    if (!existing) throw new Error('Artifact not found');
    const updated = { ...existing, ...patch, updatedAt: new Date() };
    this.artifacts.set(artifactId, updated);
    return updated;
  }

  async appendAudit(
    event: Omit<LearningAuditEvent, 'eventId' | 'createdAt'>,
  ): Promise<LearningAuditEvent> {
    const row: LearningAuditEvent = {
      ...event,
      eventId: this.auditSeq++,
      createdAt: new Date(),
    };
    this.audits.push(row);
    return row;
  }

  async listAudit(filter?: { submissionId?: number; artifactId?: number }): Promise<LearningAuditEvent[]> {
    let rows = [...this.audits];
    if (filter?.submissionId != null) {
      rows = rows.filter((e) => e.submissionId === filter.submissionId);
    }
    if (filter?.artifactId != null) {
      rows = rows.filter((e) => e.artifactId === filter.artifactId);
    }
    return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

let defaultStore: ControlPlaneStore | null = null;

export function getMemoryStore(): MemoryControlPlaneStore {
  if (!defaultStore) defaultStore = new MemoryControlPlaneStore();
  return defaultStore as MemoryControlPlaneStore;
}

export function setControlPlaneStore(store: ControlPlaneStore): void {
  defaultStore = store;
}

export function resetControlPlaneStore(): void {
  defaultStore = new MemoryControlPlaneStore();
}
