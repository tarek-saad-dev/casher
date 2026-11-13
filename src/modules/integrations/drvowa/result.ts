import type { DrvowaToolResult } from './types';

export function toolOk(tool: string, data: unknown): DrvowaToolResult {
  return { ok: true, tool, data };
}

export function toolErr(
  tool: string,
  code: string,
  message: string,
): DrvowaToolResult {
  return { ok: false, tool, error: { code, message } };
}
