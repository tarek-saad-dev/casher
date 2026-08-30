/**
 * Salon Concierge Brain — process turn (ephemeral; never mutates booking).
 */
import { executeGetBusinessHours } from '../tools/getBusinessHours';
import { buildCapabilityAdvice, buildConsultativeAdvice } from './advisor';
import { applyBrandVoice, unknownFactReply } from './brandVoice';
import { isSalonConciergeBrainEnabled } from './featureFlag';
import { attachFollowUp, optionalFollowUp } from './followUp';
import { loadConciergeSnapshot } from './hub';
import { captureKnowledgeGap } from './knowledgeGaps';
import { findCapability, findKnowledge, findLink, listActiveOffers } from './lookup';
import { evaluateOpenNow } from './openNow';
import { detectConciergeIntent, extractBranchHint } from './routing';
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
  openNowOverride?: {
    openTime: string;
    closeTime: string;
    nowMinutes: number;
    branchName?: string;
  } | null;
  skipGapCapture?: boolean;
  snapshotOverride?: ConciergeSnapshot | null;
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

  const intent = detectConciergeIntent(input.text);
  if (intent === 'NONE') return null;

  if (
    intent === 'SERVICE_PRICE_LIVE' ||
    intent === 'AVAILABILITY_LIVE' ||
    intent === 'HOURS_LIVE'
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

  // --- Open now (LIVE hours) ---
  if (intent === 'OPEN_NOW') {
    const trace = emptyTrace(intent);
    trace.liveTools.push('get_business_hours');
    trace.answerSource = 'LIVE_TOOL';
    trace.voiceExampleIds = voiceExamples.map((e) => e.id);

    let openTime: string | null = null;
    let closeTime: string | null = null;
    let branchName =
      branchHint === 'GLEEM' ? 'جليم' : branchHint === 'CAMP_CAESAR' ? 'كامب' : 'الفرع';
    let nowM = localNowMinutes();

    if (input.openNowOverride) {
      openTime = input.openNowOverride.openTime;
      closeTime = input.openNowOverride.closeTime;
      nowM = input.openNowOverride.nowMinutes;
      if (input.openNowOverride.branchName) branchName = input.openNowOverride.branchName;
    } else {
      const hours = await executeGetBusinessHours({
        name: 'get_business_hours',
        branchCode: branchHint,
      });
      if (hours.ok && hours.data) {
        const d = hours.data as {
          openTime?: string | null;
          closeTime?: string | null;
          branchName?: string;
        };
        openTime = d.openTime ?? null;
        closeTime = d.closeTime ?? null;
        if (d.branchName) branchName = d.branchName;
      }
    }

    const evalResult = evaluateOpenNow({
      openTime,
      closeTime,
      nowMinutes: nowM,
    });

    if (evalResult.reason === 'hours_unknown') {
      await maybeGap('OPENING_POLICY');
      return finish({
        text: input.text,
        intent,
        snapshot,
        answer: `مقدرش أأكد حالة ${branchName} دلوقتي من مواعيد التشغيل.`,
        trace: { ...trace, knowledgeGap: true },
      });
    }

    const answer = evalResult.isOpen
      ? `أيوه، ${branchName} فاتح دلوقتي. ${evalResult.nextHint ?? ''}`.trim()
      : `${branchName} مقفول دلوقتي. ${evalResult.nextHint ?? ''}`.trim();

    return finish({
      text: input.text,
      intent,
      snapshot,
      answer,
      trace,
      situation: evalResult.isOpen ? 'open_yes' : 'none',
    });
  }

  // --- Maps / directions / external links ---
  if (intent === 'DIRECTIONS_MAPS' || intent === 'EXTERNAL_LINK') {
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
      answer: `${o.titleAr}: ${o.descriptionAr}`,
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
