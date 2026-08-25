export class MessageTemplateError extends Error {
  readonly code: 'UNKNOWN_TEMPLATE' | 'EMPTY_TEMPLATE' | 'RENDER_FAILED';

  constructor(
    message: string,
    code: 'UNKNOWN_TEMPLATE' | 'EMPTY_TEMPLATE' | 'RENDER_FAILED' = 'UNKNOWN_TEMPLATE',
  ) {
    super(message);
    this.name = 'MessageTemplateError';
    this.code = code;
  }
}

export class MessageTemplateAdminError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'MessageTemplateAdminError';
    this.status = status;
    this.code = code;
  }
}

export type MessageTemplateSource = 'branch_db' | 'global_db' | 'code_default';

export type MessageTemplateLanguage = 'ar' | 'en';

export type ComposeMessageContext = {
  branchId?: number;
  language?: MessageTemplateLanguage;
  channel?: 'whatsapp';
};

export type ComposeMessageInput = {
  templateKey: string;
  variables?: Record<string, unknown>;
  /** @deprecated Prefer `variables`. Kept so existing callers keep compiling. */
  data?: Record<string, unknown>;
  context?: ComposeMessageContext;
};

export type ComposeMessageResult = {
  text: string;
  source: MessageTemplateSource;
};
