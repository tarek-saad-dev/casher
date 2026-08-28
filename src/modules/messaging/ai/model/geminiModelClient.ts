import type { GenerateConversationTurnInput, GenerateConversationTurnOutput } from '../domain/types';
import type { AiModelClient } from './aiModelClient';
import { AI_SYSTEM_INSTRUCTIONS_V1 } from '../domain/systemInstructions';
import { AI_RESPONSE_JSON_SCHEMA, parseAiStructuredResult, validateAiStructuredResult } from '../domain/structuredOutput';
import { getAiConfig } from '../config';

function buildUserPrompt(input: GenerateConversationTurnInput): string {
  const lines = input.conversation.messages.map((m) => {
    const role = m.direction === 'inbound' ? 'customer' : 'assistant';
    return `[${role}] ${m.text}`;
  });
  return [
    'Recent conversation (oldest first):',
    ...lines,
    '',
    'Respond with JSON only matching the schema.',
  ].join('\n');
}

export function createGeminiModelClient(env: NodeJS.ProcessEnv = process.env): AiModelClient {
  const config = getAiConfig(env);
  if (!config.geminiApiKey) {
    return {
      async generateConversationTurn(): Promise<GenerateConversationTurnOutput> {
        throw Object.assign(new Error('GEMINI_API_KEY is not configured'), {
          code: 'AI_NOT_CONFIGURED',
          retryable: false,
        });
      },
    };
  }

  return {
    async generateConversationTurn(
      input: GenerateConversationTurnInput,
    ): Promise<GenerateConversationTurnOutput> {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const client = new GoogleGenerativeAI(config.geminiApiKey);
      const model = client.getGenerativeModel({
        model: config.geminiModel,
        systemInstruction: input.systemInstructions || AI_SYSTEM_INSTRUCTIONS_V1,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
          responseSchema: AI_RESPONSE_JSON_SCHEMA as Record<string, unknown>,
        },
      });

      const started = performance.now();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            Object.assign(new Error('Gemini request timed out'), {
              code: 'AI_TIMEOUT',
              retryable: true,
            }),
          );
        }, config.modelTimeoutMs);
      });

      try {
        const response = await Promise.race([
          model.generateContent({
            contents: [{ role: 'user', parts: [{ text: buildUserPrompt(input) }] }],
          }),
          timeoutPromise,
        ]);
        const text = response.response.text();
        const parsed = parseAiStructuredResult(JSON.parse(text));
        validateAiStructuredResult(parsed);
        return {
          result: parsed,
          model: config.geminiModel,
          latencyMs: Math.max(0, Math.round(performance.now() - started)),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string }).code;
        const isQuota = /quota|429|rate/i.test(message);
        throw Object.assign(new Error(message), {
          code: code ?? (message.includes('timed out') ? 'AI_TIMEOUT' : isQuota ? 'AI_RATE_LIMIT' : 'AI_MODEL_ERROR'),
          retryable: code === 'AI_TIMEOUT' || message.includes('timed out') || isQuota,
        });
      }
    },
  };
}
