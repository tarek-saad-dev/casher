/**
 * Phase 2 AI business read-tool contracts.
 * Application-owned; Gemini never executes SQL/HTTP.
 */
export const AI_BUSINESS_TOOL_NAMES = [
  'list_branches',
  'list_services',
  'list_employees',
  'get_business_hours',
  'get_availability',
  'get_customer_context',
] as const;

export type AiBusinessToolName = (typeof AI_BUSINESS_TOOL_NAMES)[number];

export const MAX_AI_TOOL_CALLS_PER_TURN = 3;
export const MAX_AVAILABILITY_SLOTS = 8;
export const MAX_SERVICES_RETURNED = 40;
export const MAX_EMPLOYEES_RETURNED = 30;

export type AiToolCallRequest = {
  name: AiBusinessToolName;
  branchCode?: string | null;
  serviceQuery?: string | null;
  employeeName?: string | null;
  dateText?: string | null;
  timePreference?: string | null;
  serviceIds?: number[] | null;
  empId?: number | null;
};

export type AiToolExecutionContext = {
  phone: string;
  conversationId: number;
  turnId: number;
};

export type AiToolResult = {
  name: AiBusinessToolName;
  ok: boolean;
  durationMs: number;
  input: Record<string, unknown>;
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
};

export type AiToolTrace = {
  requested: AiToolCallRequest[];
  executed: AiToolResult[];
  truncated: boolean;
};
