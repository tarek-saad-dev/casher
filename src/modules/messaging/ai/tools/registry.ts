import 'server-only';
import type {
  AiBusinessToolName,
  AiToolCallRequest,
  AiToolExecutionContext,
  AiToolResult,
  AiToolTrace,
} from './types';
import { AI_BUSINESS_TOOL_NAMES, MAX_AI_TOOL_CALLS_PER_TURN } from './types';
import { executeListBranches } from './listBranches';
import { executeListServices } from './listServices';
import { executeListEmployees } from './listEmployees';
import { executeGetBusinessHours } from './getBusinessHours';
import { executeGetAvailability } from './getAvailability';
import { executeGetCustomerContext } from './getCustomerContext';
import { executeGetUpcomingBookings } from './getUpcomingBookings';

const NAME_SET = new Set<string>(AI_BUSINESS_TOOL_NAMES);

export function isAiBusinessToolName(value: unknown): value is AiBusinessToolName {
  return typeof value === 'string' && NAME_SET.has(value);
}

export async function executeAiBusinessTool(
  request: AiToolCallRequest,
  ctx: AiToolExecutionContext,
): Promise<AiToolResult> {
  const started = performance.now();
  let partial: Omit<AiToolResult, 'durationMs'>;
  switch (request.name) {
    case 'list_branches':
      partial = await executeListBranches(request);
      break;
    case 'list_services':
      partial = await executeListServices(request);
      break;
    case 'list_employees':
      partial = await executeListEmployees(request);
      break;
    case 'get_business_hours':
      partial = await executeGetBusinessHours(request);
      break;
    case 'get_availability':
      partial = await executeGetAvailability(request);
      break;
    case 'get_customer_context':
      partial = await executeGetCustomerContext(request, ctx);
      break;
    case 'get_upcoming_bookings':
      partial = await executeGetUpcomingBookings(request, ctx);
      break;
    default:
      partial = {
        name: request.name,
        ok: false,
        input: {},
        errorCode: 'UNKNOWN_TOOL',
        errorMessage: `Unsupported tool ${String((request as { name?: string }).name)}`,
      };
  }
  return {
    ...partial,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
  };
}

export async function executeAiToolPlan(
  requested: AiToolCallRequest[],
  ctx: AiToolExecutionContext,
  maxCalls: number = MAX_AI_TOOL_CALLS_PER_TURN,
): Promise<AiToolTrace> {
  const truncated = requested.length > maxCalls;
  const plan = requested.slice(0, Math.max(0, maxCalls));
  const executed: AiToolResult[] = [];
  for (const call of plan) {
    if (!isAiBusinessToolName(call.name)) {
      executed.push({
        name: 'list_branches',
        ok: false,
        durationMs: 0,
        input: call as unknown as Record<string, unknown>,
        errorCode: 'MALFORMED_TOOL_REQUEST',
        errorMessage: `Invalid tool name: ${String(call.name)}`,
      });
      continue;
    }
    executed.push(await executeAiBusinessTool(call, ctx));
  }
  return { requested: plan, executed, truncated };
}
