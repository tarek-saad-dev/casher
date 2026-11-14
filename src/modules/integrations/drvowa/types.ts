export type DrvowaToolMode = 'READ' | 'WRITE';
export type DrvowaToolApproval = 'AUTO' | 'CUSTOMER_CONFIRM' | 'HUMAN_APPROVAL';

export type DrvowaToolDefinition = {
  name: string;
  description: string;
  mode: DrvowaToolMode;
  approval: DrvowaToolApproval;
  inputSchema?: Record<string, unknown>;
};

export type DrvowaManifest = {
  contractVersion: 'drvowa-erp-v1';
  provider: string;
  providerVersion?: string | null;
  capabilities: string[];
  tools: DrvowaToolDefinition[];
};

export type DrvowaToolError = {
  code: string;
  message: string;
};

export type DrvowaToolResult = {
  ok: boolean;
  tool: string;
  data?: unknown;
  error?: DrvowaToolError;
};

export type DrvowaToolRequestBody = {
  requestId: string;
  input: Record<string, unknown>;
};

export type DrvowaInvoiceStatus = 'active' | 'cancelled';
