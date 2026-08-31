import { getAiConfig, DEFAULT_AI_MODEL_TIMEOUT_MS } from '@/modules/messaging/ai/config';
import {
  LEARNING_INTERPRETATION_JSON_SCHEMA,
  parseGeminiLearningInterpretation,
} from '../domain/learningInterpretationSchema';
import type { InterpretationResult } from '../domain/types';
import { postProcessGeminiInterpretation } from './interpretationPostProcessor';
import { buildLearningInterpreterSystemPrompt } from './learningInterpreterPrompt';

const MAX_RETRIES = 2;

export type GeminiLearningTransportInput = {
  rawInput: string;
  systemPrompt: string;
  schema: Record<string, unknown>;
  model: string;
  apiKey: string;
  timeoutMs: number;
};

export type GeminiLearningTransportResult = {
  text: string;
  model: string;
};

export type GeminiLearningTransport = (
  input: GeminiLearningTransportInput,
) => Promise<GeminiLearningTransportResult>;

let transportOverride: GeminiLearningTransport | null = null;

export function setGeminiLearningTransportForTests(transport: GeminiLearningTransport | null): void {
  transportOverride = transport;
}

async function defaultGeminiTransport(
  input: GeminiLearningTransportInput,
): Promise<GeminiLearningTransportResult> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const client = new GoogleGenerativeAI(input.apiKey);
  const model = client.getGenerativeModel({
    model: input.model,
    systemInstruction: input.systemPrompt,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: input.schema,
    },
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(Object.assign(new Error('Gemini learning interpreter timed out'), { retryable: true }));
    }, input.timeoutMs);
  });

  const response = await Promise.race([
    model.generateContent({
      contents: [{ role: 'user', parts: [{ text: input.rawInput }] }],
    }),
    timeoutPromise,
  ]);

  return {
    text: response.response.text(),
    model: input.model,
  };
}

export async function interpretLearningInputGemini(
  rawInput: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<InterpretationResult> {
  const config = getAiConfig(env);
  if (!config.geminiApiKey) {
    throw Object.assign(new Error('GEMINI_API_KEY is not configured'), { code: 'AI_NOT_CONFIGURED' });
  }

  const systemPrompt = buildLearningInterpreterSystemPrompt();
  const transport = transportOverride ?? defaultGeminiTransport;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { text, model } = await transport({
        rawInput,
        systemPrompt,
        schema: LEARNING_INTERPRETATION_JSON_SCHEMA as unknown as Record<string, unknown>,
        model: config.geminiModel,
        apiKey: config.geminiApiKey,
        timeoutMs: config.modelTimeoutMs ?? DEFAULT_AI_MODEL_TIMEOUT_MS,
      });
      const parsed = parseGeminiLearningInterpretation(JSON.parse(text));
      const result = postProcessGeminiInterpretation(rawInput, parsed);
      return { ...result, modelName: model, interpreterEngine: 'gemini' };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt >= MAX_RETRIES) break;
    }
  }

  throw lastError ?? new Error('Gemini learning interpretation failed');
}
