/**
 * Salon Concierge Brain — process turn (ephemeral; never mutates booking).
 */
import { buildFixedHoursScheduleReply, buildFixedOpenNowReply } from './branchHoursReplies';
import { cairoNowMinutes } from './branchBusinessHours';
import { buildCapabilityAdvice, buildConsultativeAdvice } from './advisor';
import { applyBrandVoice, unknownFactReply } from './brandVoice';
import { isSalonConciergeBrainEnabled } from './featureFlag';
import { attachFollowUp, optionalFollowUp } from './followUp';
import { loadConciergeSnapshot } from './hub';
import { captureKnowledgeGap } from './knowledgeGaps';
import { findCapability, findKnowledge, findLink, listActiveOffers } from './lookup';
import { detectConciergeIntent, extractBranchHint, resolveConciergeIntent } from './routing';
import type {
  ConciergeAnswerSource,
  ConciergeDecision,
  ConciergeIntent,
  ConciergeSnapshot,
  ConciergeTrace,
  KnowledgeSource,
} from './types';
import { pickVoiceExamples } from './voiceExamples';

function emptyTrace(intent: ConciergeIntent): ConciergeTrace {
  return {
    version: 'concierge_v1',
    intent,
    answerSource: 'NONE',
    knowledgeKeys: [],
    knowledgeItemIds: [],
    capabilityIds: [],
    liveTools: [],
    source: 'none',
    recommendationReason: null,
    knowledgeGap: false,
    voiceExampleIds: [],
    offerId: null,
    followUpUsed: false,
    mutatesBookingPlan: false,
  };
}

function localNowMinutes(timeZone = 'Africa/Cairo'): number {
  if (timeZone === 'Africa/Cairo') return cairoNowMinutes();
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return h * 60 + m;
  } catch {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
}

function sourceFromAnswer(answerSource: ConciergeAnswerSource): KnowledgeSource | 'none' {
  if (answerSource === 'LIVE_TOOL') return 'live_tool';
  if (answerSource === 'CURATED_KNOWLEDGE' || answerSource === 'LINK' || answerSource === 'CAPABILITY' || answerSource === 'OFFER') {
    return 'curated';
  }
  return 'none';
}

export type ConciergeInput = {
  text: string;
  /** Test hook: freeze Cairo local minutes for open-now evaluation. */
  openNowOverride?: {
    nowMinutes: number;
    openTime?: string;
    closeTime?: string;
    branchName?: string;
  } | null;
  skipGapCapture?: boolean;
  snapshotOverride?: ConciergeSnapshot | null;
  session?: { recentTurns: Array<{ role: string; text?: string }> };
};

function finish(args: {
  text: string;
  intent: ConciergeIntent;
  snapshot: ConciergeSnapshot;
  answer: string;
  trace: ConciergeTrace;
  situation?: 'open_yes' | 'clarify_branch' | 'none';
  optionalOfferLine?: string | null;
  passToPhase2?: boolean;
  handled?: boolean;
}): ConciergeDecision {
  const examples = pickVoiceExamples({
    text: args.text,
    intent: args.intent,
    examples: args.snapshot.examples,
  });
  args.trace.voiceExampleIds = examples.map((e) => e.id);
  if (args.trace.source === 'none') {
    args.trace.source = sourceFromAnswer(args.trace.answerSource);
  }

  let reply = applyBrandVoice({
    answer: args.answer,
    voice: args.snapshot.brandVoice,
    optionalOfferLine: args.optionalOfferLine ?? null,
    examples,
    intent: args.intent,
    situation: args.situation ?? 'none',
  });

  const follow = optionalFollowUp({
    intent: args.intent,
    handled: args.handled !== false,
    knowledgeGap: args.trace.knowledgeGap,
  });
  if (follow) {
    reply = attachFollowUp(reply, follow);
    args.trace.followUpUsed = true;
  }

  const handled = args.handled !== false;
  return {
    handled,
    replyText: handled ? reply : null,
    passToPhase2: Boolean(args.passToPhase2),
    bypassPlanner: true,
    blockBookingConfirm: true,
    mutatesBookingPlan: false,
    trace: args.trace,
  };
}

/**
 * Attempt to answer as concierge. Returns null if flag off or not a concierge turn.
 * Never mutates booking plan.
 */
export async function processConciergeTurn(
  input: ConciergeInput,
): Promise<ConciergeDecision | null> {
  if (!isSalonConciergeBrainEnabled()) return null;

  const intent = resolveConciergeIntent(input.text, input.session);
  if (intent === 'NONE') return null;

  if (
    intent === 'SERVICE_PRICE_LIVE' ||
    intent === 'AVAILABILITY_LIVE'
  ) {
    const trace = emptyTrace(intent);
    trace.answerSource = 'LIVE_TOOL';
    trace.source = 'live_tool';
    return {
      handled: false,
      replyText: null,
      passToPhase2: true,
      bypassPlanner: true,
      blockBookingConfirm: true,
      mutatesBookingPlan: false,
      trace,
    };
  }

  const snapshot = input.snapshotOverride ?? (await loadConciergeSnapshot());
  const branchHint = extractBranchHint(input.text);
  const voiceExamples = pickVoiceExamples({
    text: input.text,
    intent,
    examples: snapshot.examples,
  });

  const maybeGap = async (categoryGuess: string) => {
    if (input.skipGapCapture) return;
    await captureKnowledgeGap({ subject: input.text, categoryGuess });
  };

  // --- Open now (owner-approved fixed hours) ---
  if (intent === 'OPEN_NOW') {
    const trace = emptyTrace(intent);
    trace.answerSource = 'CURATED_KNOWLEDGE';
    trace.source = 'curated';
    trace.knowledgeKeys.push('hours.fixed.owner_approved');
    trace.voiceExampleIds = voiceExamples.map((e) => e.id);

    const nowM = input.openNowOverride?.nowMinutes ?? localNowMinutes();
    const answer = buildFixedOpenNowReply({
      branchCode: branchHint,
      nowMinutes: nowM,
    });
    const anyOpen =
      /فاتحين دلوقتي|فاتح دلوقتي/.test(answer) && !/^مقفلين/.test(answer);

    return finish({
      text: input.text,
      intent,
      snapshot,
      answer,
      trace,
      situation: anyOpen ? 'open_yes' : 'none',
    });
  }

  // --- Fixed branch hours (curated; not ERP) ---
  if (intent === 'HOURS_LIVE') {
    const trace = emptyTrace(intent);
    trace.answerSource = 'CURATED_KNOWLEDGE';
    trace.source = 'curated';
    trace.knowledgeKeys.push(
      branchHint ? `hours.${branchHint.toLowerCase()}.fixed` : 'hours.branches.fixed',
    );
    const answer = buildFixedHoursScheduleReply({ branchCode: branchHint });
    return finish({
      text: input.text,
      intent,
      snapshot,
      answer,
      trace,
    });
  }

  // --- Maps / directions / external links ---
  if (intent === 'DIRECTIONS_MAPS' || intent === 'EXTERNAL_LINK') {
    const maps = snapshot.links.filter(
      (l) =>
        l.status === 'active' &&
        (l.linkType === 'GOOGLE_MAPS' || l.linkType === 'BRANCH_LOCATION'),
    );
    if (intent === 'DIRECTIONS_MAPS' && !branchHint && maps.length > 1) {
      return finish({
        text: input.text,
        intent,
        snapshot,
        answer: 'تقصد فرع جليم ولا كامب شيزار؟',
        trace: { ...emptyTrace(intent), answerSource: 'LINK' },
        situation: 'clarify_branch',
      });
    }
    const link = findLink(input.text, snapshot, {
      branchCode: branchHint,
      preferType: intent === 'DIRECTIONS_MAPS' ? 'GOOGLE_MAPS' : undefined,
    });
    const trace = emptyTrace(intent);
    if (!link) {
      await maybeGap(intent === 'DIRECTIONS_MAPS' ? 'GOOGLE_MAPS' : 'SOCIAL_LINK');
      return finish({
        text: input.text,
        intent,
        snapshot,
        answer: unknownFactReply(),
        trace: { ...trace, knowledgeGap: true, answerSource: 'UNKNOWN' },
      });
    }
    trace.knowledgeKeys.push(link.key);
    trace.knowledgeItemIds.push(link.id);
    trace.answerSource = 'LINK';
    return finish({
      text: input.text,
      intent,
      snapshot,
      answer: `${link.labelAr}:\n${link.url}`,
      trace,
    });
  }

  // --- Offers ---
  if (intent === 'OFFER_QUERY') {
    const offers = listActiveOffers(snapshot);
    const trace = emptyTrace(intent);
    if (!offers.length) {
      return finish({
        text: input.text,
        intent,
        snapshot,
        answer: 'حالياً مفيش عرض نشط مسجّل عندي.',
        trace: { ...trace, answerSource: 'OFFER' },
      });
    }
    const o = offers[0]!;
    trace.knowledgeKeys.push(o.key);
    trace.knowledgeItemIds.push(o.id);
    trace.offerId = o.id;
    trace.answerSource = 'OFFER';
    return finish({
      text: input.text,
      intent,
      snapshot,
      answer: `${o.titleAr}\n${o.descriptionAr}\nالأهلية بتتأكد حسب شروط العرض، ومش بقدر أطبّق الخصم تلقائي.`,
      trace,
    });
  }

  // --- Capabilities / consultative ---
  if (intent === 'CAPABILITY_QUERY' || intent === 'CONSULTATIVE') {
    const { item, resolution } = findCapability(input.text, snapshot, branchHint);
    const trace = emptyTrace(intent);
    if (resolution === 'unknown' || !item) {
      await maybeGap('CAPABILITY');
      return finish({
        text: input.text,
        intent,
        snapshot,
        answer: unknownFactReply(),
        trace: { ...trace, knowledgeGap: true, answerSource: 'UNKNOWN' },
      });
    }
    if (resolution === 'ambiguous') {
      return finish({
        text: input.text,
        intent,
        snapshot,
        answer: 'تقصد إيه بالظبط عشان أجاوبك بدقة؟',
        trace: {
          ...trace,
          knowledgeKeys: [item.key],
          capabilityIds: [item.id],
          answerSource: 'CAPABILITY',
        },
        situation: 'none',
      });
    }
    trace.knowledgeKeys.push(item.key);
    trace.capabilityIds.push(item.id);
    trace.answerSource = 'CAPABILITY';
    trace.recommendationReason =
      intent === 'CONSULTATIVE' ? 'consultative_capability_match' : 'curated_capability';
    const answer =
      intent === 'CONSULTATIVE'
        ? buildConsultativeAdvice({
            capabilityName: item.displayNameAr,
            description: item.descriptionAr,
            askOneQuestion: /رمادي|لون|مش عارف/.test(input.text),
          })
        : buildCapabilityAdvice({
            capabilityName: item.displayNameAr,
            description: item.descriptionAr,
            employeeNames: item.employeeNames,
            branchCodes: item.branchCodes,
            askedBranch: branchHint,
          });
    return finish({
      text: input.text,
      intent,
      snapshot,
      answer,
      trace,
    });
  }

  // --- FAQ / curated knowledge ---
  if (intent === 'FAQ_KNOWLEDGE') {
    const { item, resolution } = findKnowledge(input.text, snapshot, {
      branchCode: branchHint,
    });
    const trace = emptyTrace(intent);
    if (resolution === 'unknown' || !item) {
      await maybeGap('FAQ');
      return finish({
        text: input.text,
        intent,
        snapshot,
        answer: unknownFactReply(),
        trace: { ...trace, knowledgeGap: true, answerSource: 'UNKNOWN' },
      });
    }
    if (resolution === 'ambiguous') {
      return finish({
        text: input.text,
        intent,
        snapshot,
        answer: 'تقصد فرع جليم ولا كامب شيزار؟',
        trace: {
          ...trace,
          knowledgeKeys: [item.key],
          knowledgeItemIds: [item.id],
          answerSource: 'CURATED_KNOWLEDGE',
        },
        situation: 'clarify_branch',
      });
    }
    trace.knowledgeKeys.push(item.key);
    trace.knowledgeItemIds.push(item.id);
    trace.answerSource = item.source === 'imported' ? 'CURATED_KNOWLEDGE' : 'CURATED_KNOWLEDGE';
    if (item.source === 'imported') {
      trace.source = 'imported';
    }
    return finish({
      text: input.text,
      intent,
      snapshot,
      answer: item.answerText,
      trace,
    });
  }

  return null;
}
