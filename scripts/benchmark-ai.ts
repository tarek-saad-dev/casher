#!/usr/bin/env npx tsx
/**
 * Safe Gemini latency benchmark (Phase 3).
 * Uses controlled non-customer prompts. Requires GEMINI_API_KEY.
 *
 *   npm run messaging:benchmark-ai
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

type Sample = { label: string; latencyMs: number };

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function summarize(label: string, samples: Sample[]) {
  const values = samples.map((s) => s.latencyMs);
  console.log(label, {
    n: values.length,
    min: Math.min(...values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
  });
}

async function main() {
  const { createGeminiModelClient } = await import(
    '../src/modules/messaging/ai/model/geminiModelClient'
  );
  const { getAiConfig } = await import('../src/modules/messaging/ai/config');
  const { AI_SYSTEM_INSTRUCTIONS_V1 } = await import(
    '../src/modules/messaging/ai/domain/systemInstructions'
  );

  const config = getAiConfig();
  if (!config.geminiApiKey) {
    console.error('GEMINI_API_KEY is required for benchmark');
    process.exit(1);
  }

  const client = createGeminiModelClient();
  const scenarios: Array<{ label: string; messages: Array<{ direction: 'inbound' | 'outbound'; text: string }> }> = [
    { label: 'greeting', messages: [{ direction: 'inbound', text: 'مساء الخير' }] },
    {
      label: 'booking_intent',
      messages: [{ direction: 'inbound', text: 'عايز أحجز بكرة مع عمر قص شعر' }],
    },
    {
      label: 'mixed_short_context',
      messages: [
        { direction: 'inbound', text: 'مساء الخير' },
        { direction: 'outbound', text: 'أهلاً! إزيك؟' },
        { direction: 'inbound', text: '3ayz a7gz bokra after 8' },
      ],
    },
    {
      label: 'availability_question',
      messages: [{ direction: 'inbound', text: 'عمر فاضي الساعة 8؟' }],
    },
  ];

  const all: Sample[] = [];
  const rounds = 2;

  for (const scenario of scenarios) {
    const samples: Sample[] = [];
    for (let i = 0; i < rounds; i++) {
      const started = performance.now();
      const output = await client.generateConversationTurn({
        systemInstructions: AI_SYSTEM_INSTRUCTIONS_V1,
        conversation: {
          conversationId: 0,
          phone: '200000000000',
          controlMode: 'BOT',
          burstInboundMessageIds: [1],
          messages: scenario.messages.map((m, idx) => ({
            messageId: idx + 1,
            direction: m.direction,
            text: m.text,
            occurredAt: new Date().toISOString(),
          })),
        },
      });
      const latencyMs = output.latencyMs ?? Math.round(performance.now() - started);
      const sample = { label: scenario.label, latencyMs };
      samples.push(sample);
      all.push(sample);
      console.log('sample', {
        scenario: scenario.label,
        round: i + 1,
        latencyMs,
        intent: output.result.intent,
        needsBusinessTool: output.result.needsBusinessTool,
        shouldReply: output.result.shouldReply,
      });
    }
    summarize(`scenario:${scenario.label}`, samples);
  }

  summarize('gemini_overall', all);
  console.log('model', config.geminiModel);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('benchmark failed', message);
  process.exit(1);
});
