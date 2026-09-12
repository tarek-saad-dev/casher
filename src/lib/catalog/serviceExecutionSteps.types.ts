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
