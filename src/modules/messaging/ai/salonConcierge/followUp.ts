/** Contextual optional follow-up. Never a standing booking nag. */
import type { ConciergeIntent } from './types';

export function optionalFollowUp(args: {
  intent: ConciergeIntent;
  handled: boolean;
  knowledgeGap: boolean;
}): string | null {
  if (!args.handled || args.knowledgeGap) return null;
  if (args.intent === 'DIRECTIONS_MAPS') {
    return 'ولو جاي دلوقتي أقدر أشوفلك مين متاح.';
  }
  return null;
}

export function attachFollowUp(answer: string, followUp: string | null): string {
  if (!followUp) return answer;
  if (answer.includes(followUp)) return answer;
  if (/تحب تحجز/.test(followUp)) return answer;
  return `${answer.trim()}\n${followUp}`;
}
