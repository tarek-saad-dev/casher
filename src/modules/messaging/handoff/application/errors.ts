export type HandoffErrorCode =
  | 'NOT_FOUND'
  | 'OWNED_BY_OTHER'
  | 'VERSION_CONFLICT'
  | 'NOT_OWNER'
  | 'EMPTY_CONTENT'
  | 'FEATURE_DISABLED';

export class HandoffError extends Error {
  readonly code: HandoffErrorCode;
  readonly status: number;
  readonly ownerName: string | null;

  constructor(message: string, code: HandoffErrorCode, status = 409, ownerName: string | null = null) {
    super(message);
    this.name = 'HandoffError';
    this.code = code;
    this.status = status;
    this.ownerName = ownerName;
  }
}
