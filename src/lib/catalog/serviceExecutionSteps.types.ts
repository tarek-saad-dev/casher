export interface ExecutionStepInput {
  TitleAr?: string | null;
  TitleEn?: string | null;
  DetailAr?: string | null;
  DetailEn?: string | null;
  DurationMinutes?: number | null;
  SortOrder?: number;
}

export interface ExecutionStepRow {
  StepID: number;
  ProID: number;
  SortOrder: number;
  TitleAr: string | null;
  TitleEn: string | null;
  DetailAr: string | null;
  DetailEn: string | null;
  DurationMinutes: number | null;
  CreatedAt: string | null;
  UpdatedAt: string | null;
}

/** Public website wire for one execution stage */
export interface PublicExecutionStepWire {
  stepId: number;
  sortOrder: number;
  /** 1-based display order derived from SortOrder rank */
  order: number;
  titleAr: string | null;
  titleEn: string | null;
  detailAr: string | null;
  detailEn: string | null;
  durationMinutes: number | null;
}
