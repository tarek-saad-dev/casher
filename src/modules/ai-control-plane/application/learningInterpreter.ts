import type { InterpretationResult } from '../domain/types';
import { interpretLearningInputGemini } from './geminiLearningInterpreter';
import { interpretLearningInputHeuristic } from './heuristicInterpreter';

export type LearningInterpreterOptions = {
  /** Force deterministic heuristic (tests / explicit fallback). */
  forceHeuristic?: boolean;
  /** Use Gemini even under Vitest when transport is mocked. */
  engine?: 'gemini' | 'heuristic';
  /** Allow safe heuristic fallback when Gemini fails (default true in production). */
  allowHeuristicFallback?: boolean;
};

export const HEURISTIC_INTERPRETER_MODEL_NAME = 'heuristic-phase1-fallback';

function shouldUseHeuristic(options: LearningInterpreterOptions): boolean {
  if (options.forceHeuristic || options.engine === 'heuristic') return true;
  if (options.engine === 'gemini') return false;
  // CI/unit tests default to heuristic unless explicitly testing Gemini contract.
  return process.env.AI_CONTROL_PLANE_INTERPRETER === 'heuristic';
}

/** Stable facade — Gemini primary in production; heuristic for tests/fallback. */
export async function interpretLearningSubmission(
  rawInput: string,
  options: LearningInterpreterOptions = {},
): Promise<InterpretationResult> {
  if (shouldUseHeuristic(options)) {
    const result = interpretLearningInputHeuristic(rawInput);
    return {
      ...result,
      interpreterEngine: 'heuristic',
      modelName: HEURISTIC_INTERPRETER_MODEL_NAME,
    };
  }

  const allowFallback = options.allowHeuristicFallback !== false;
  try {
    return await interpretLearningInputGemini(rawInput);
  } catch (err) {
    if (!allowFallback) throw err;
    const fallback = interpretLearningInputHeuristic(rawInput);
    return {
      ...fallback,
      requiresHumanClarification: true,
      warnings: [
        ...fallback.warnings,
        'تعذر التحليل بالذكاء الاصطناعي — راجع المقترحات بعناية قبل الاعتماد.',
      ],
      interpreterEngine: 'heuristic',
      modelName: HEURISTIC_INTERPRETER_MODEL_NAME,
    };
  }
}

export function resolveInterpreterModelName(result: InterpretationResult): string {
  return result.modelName ?? HEURISTIC_INTERPRETER_MODEL_NAME;
}
