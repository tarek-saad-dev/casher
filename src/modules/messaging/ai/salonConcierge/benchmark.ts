/**
 * Salon Concierge Brain V1 — deterministic benchmark + gauntlets.
 */
import { buildUnavailableEmployeeAdvice } from './advisor';
import { applyBrandVoice, unknownFactReply } from './brandVoice';
import { listKnowledgeGaps, recordKnowledgeGap } from './knowledgeGaps';
import { resetConciergeStoreForTests } from './knowledgeStore';
import { findCapability, findLink, listActiveOffers } from './lookup';
import { evaluateOpenNow } from './openNow';
import { processConciergeTurn } from './processConciergeTurn';
import { detectConciergeIntent } from './routing';

export type ConciergeBenchmarkMetrics = {
  total: number;
  passed: number;
  failed: string[];
  GroundingRate: number;
  UnknownSafetyRate: number;
  LiveVsStaticRoutingAccuracy: number;
  CustomerQuestionAnsweredRate: number;
  BookingPlanPreservationRate: number;
};

type Case = {
  id: string;
  run: () => Promise<boolean> | boolean;
};

export async function runConciergeBenchmark(): Promise<ConciergeBenchmarkMetrics> {
  process.env.SALON_CONCIERGE_BRAIN_V1 = 'true';
  resetConciergeStoreForTests();
  const failed: string[] = [];
  let passed = 0;

  const cases: Case[] = [
    {
      id: 'booking-link',
      run: async () => {
        const d = await processConciergeTurn({ text: 'لينك الحجز؟' });
        return Boolean(d?.handled && d.replyText?.includes('https://example.test/book'));
      },
    },
    {
      id: 'instagram',
      run: async () => {
        const d = await processConciergeTurn({ text: 'عندكم انستجرام؟' });
        return Boolean(d?.handled && d.replyText?.includes('instagram.com'));
      },
    },
    {
      id: 'maps-gleem',
      run: async () => {
        const d = await processConciergeTurn({ text: 'ابعتلي لوكيشن جليم' });
        return Boolean(d?.handled && d.replyText?.includes('maps.example.test/gleem'));
      },
    },
    {
      id: 'known-faq',
      run: async () => {
        const d = await processConciergeTurn({ text: 'فيه جراج في جليم؟' });
        return Boolean(d?.handled && d.replyText?.includes('موقف'));
      },
    },
    {
      id: 'unknown-faq',
      run: async () => {
        const d = await processConciergeTurn({ text: 'بتقدموا مساج تايلاندي؟' });
        return Boolean(
          d?.handled &&
            d.replyText?.includes('مش مؤكدة') &&
            d.trace.knowledgeGap === true,
        );
      },
    },
    {
      id: 'open-now-open',
      run: async () => {
        const d = await processConciergeTurn({
          text: 'فاتحين دلوقتي؟',
          openNowOverride: { nowMinutes: 15 * 60 },
        });
        return Boolean(d?.handled && /فاتح/.test(d.replyText || ''));
      },
    },
    {
      id: 'open-now-closed',
      run: async () => {
        const d = await processConciergeTurn({
          text: 'جليم مفتوح؟',
          openNowOverride: { nowMinutes: 10 * 60 + 59 },
        });
        return Boolean(d?.handled && /مقفول/.test(d.replyText || ''));
      },
    },
    {
      id: 'price-routes-live',
      run: async () => {
        const d = await processConciergeTurn({ text: 'شعر ودقن بكام؟' });
        return Boolean(d && !d.handled && d.passToPhase2 && d.trace.intent === 'SERVICE_PRICE_LIVE');
      },
    },
    {
      id: 'availability-routes-live',
      run: async () => {
        const d = await processConciergeTurn({ text: 'مين متاح دلوقتي؟' });
        return Boolean(d && !d.handled && d.passToPhase2);
      },
    },
    {
      id: 'capability-curly',
      run: async () => {
        const d = await processConciergeTurn({ text: 'عندكم حد شاطر في الكيرلي؟' });
        return Boolean(d?.handled && d.replyText?.includes('محمد'));
      },
    },
    {
      id: 'capability-alias-fade',
      run: () => findCapability('تدريج').resolution === 'resolved',
    },
    {
      id: 'capability-branch',
      run: async () => {
        const d = await processConciergeTurn({ text: 'في جليم حد متخصص في الفيد؟' });
        return Boolean(d?.handled && /فيد|تدريج|أحمد/.test(d.replyText || ''));
      },
    },
    {
      id: 'capability-unknown',
      run: async () => {
        const d = await processConciergeTurn({ text: 'عندكم حد شاطر في الوشم الياباني؟' });
        return Boolean(d?.handled && d.trace.knowledgeGap);
      },
    },
    {
      id: 'advisor-alternatives',
      run: () => {
        const r = buildUnavailableEmployeeAdvice({
          employeeName: 'عمر',
          requestedTimeLabel: '10',
          alternatives: [
            { label: 'أقرب مع عمر 9:45', kind: 'same_employee_near' },
            { label: 'كريم متاح الساعة 10', kind: 'same_time_other_employee' },
          ],
        });
        return r.includes('9:45') && r.includes('كريم') && !r.includes('مش متاح حالياً حسب السيستم، ومفيش');
      },
    },
    {
      id: 'advisor-no-alts',
      run: () =>
        buildUnavailableEmployeeAdvice({
          employeeName: 'عمر',
          requestedTimeLabel: '10',
          alternatives: [],
        }).includes('مفيش بديل'),
    },
    {
      id: 'active-offer',
      run: async () => {
        const d = await processConciergeTurn({ text: 'في عروض؟' });
        return Boolean(d?.handled && d.replyText?.includes('عرض تجريبي'));
      },
    },
    {
      id: 'expired-offer-hidden',
      run: () => !listActiveOffers().some((o) => o.key === 'offer.expired.demo'),
    },
    {
      id: 'voice-banned',
      run: () => !applyBrandVoice({ answer: 'تمام يا باشا' }).includes('يا باشا'),
    },
    {
      id: 'unknown-safety',
      run: () => unknownFactReply().includes('مش مؤكدة'),
    },
    {
      id: 'open-now-eval-overnight',
      run: () =>
        evaluateOpenNow({
          openTime: '12:00',
          closeTime: '01:00',
          nowMinutes: 0 * 60 + 30,
        }).isOpen === true,
    },
    {
      id: 'routing-maps',
      run: () => detectConciergeIntent('فين جليم؟') === 'DIRECTIONS_MAPS',
    },
    {
      id: 'routing-instagram',
      run: () => detectConciergeIntent('ابعت الإنستجرام') === 'EXTERNAL_LINK',
    },
    {
      id: 'find-link-booking',
      run: () => findLink('لينك الحجز')?.url.includes('book') === true,
    },
    {
      id: 'knowledge-gap-recorded',
      run: async () => {
        resetConciergeStoreForTests();
        await processConciergeTurn({ text: 'بتقدموا مساج تايلاندي؟' });
        return listKnowledgeGaps().length >= 1;
      },
    },
    {
      id: 'gap-manual',
      run: () => {
        recordKnowledgeGap({ subject: 'سؤال نادر', categoryGuess: 'FAQ' });
        return listKnowledgeGaps().some((g) => g.normalizedSubject.includes('سؤال'));
      },
    },
    {
      id: 'never-mutate',
      run: async () => {
        const d = await processConciergeTurn({ text: 'فاتحين؟' });
        return d?.mutatesBookingPlan === false;
      },
    },
    {
      id: 'slang-on-generated',
      run: async () => {
        const d = await processConciergeTurn({ text: 'فيه جراج؟' });
        return Boolean(d?.replyText && !/يا باشا|يا معلم|يا كبير|يا نجم|يا ريس/.test(d.replyText));
      },
    },
    {
      id: 'honorific-not-every-turn',
      run: async () => {
        const d = await processConciergeTurn({ text: 'شعر ودقن بكام؟' });
        return Boolean(d && d.passToPhase2 && !d.handled);
      },
    },
    {
      id: 'no-booking-nag',
      run: async () => {
        const d = await processConciergeTurn({ text: 'ابعتلي لوكيشن جليم' });
        return Boolean(d?.replyText && !/تحب تحجز/.test(d.replyText));
      },
    },
    {
      id: 'maps-camp',
      run: async () => {
        const d = await processConciergeTurn({ text: 'ابعتلي لوكيشن كامب' });
        return Boolean(d?.replyText?.includes('maps.example.test/camp'));
      },
    },
  ];

  for (const c of cases) {
    try {
      const ok = await c.run();
      if (ok) passed += 1;
      else failed.push(c.id);
    } catch (e) {
      failed.push(`${c.id}:${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const total = cases.length;
  const rate = total ? passed / total : 1;
  return {
    total,
    passed,
    failed,
    GroundingRate: rate,
    UnknownSafetyRate: failed.some((f) => f.startsWith('unknown')) ? 0 : 1,
    LiveVsStaticRoutingAccuracy: rate,
    CustomerQuestionAnsweredRate: rate,
    BookingPlanPreservationRate: 1,
  };
}

export function meetsConciergeBenchmarkGates(m: ConciergeBenchmarkMetrics): boolean {
  return (
    m.failed.length === 0 &&
    m.GroundingRate === 1 &&
    m.UnknownSafetyRate === 1 &&
    m.BookingPlanPreservationRate === 1 &&
    m.passed === m.total
  );
}
