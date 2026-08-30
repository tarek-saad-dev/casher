import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/modules/messaging/ai/tools/getBusinessHours', () => ({
  executeGetBusinessHours: vi.fn(async () => ({
    name: 'get_business_hours',
    ok: true,
    input: {},
    data: {
      openTime: '12:00:00',
      closeTime: '01:00:00',
      branchName: 'جليم',
      branchCode: 'GLEEM',
    },
  })),
}));

import {
  processConciergeTurn,
  resetConciergeStoreForTests,
  findKnowledge,
  findCapability,
  findLink,
  listActiveOffers,
  applyBrandVoice,
  containsBannedSlang,
  BANNED_SLANG_DEFAULT,
  pickVoiceExamples,
  recordKnowledgeGap,
  listKnowledgeGaps,
  detectConciergeIntent,
  buildUnavailableEmployeeAdvice,
  loadConciergeSnapshot,
  invalidateConciergeCache,
  getCachedSnapshot,
  fixtureSnapshot,
  validateConciergeMigrationSql,
  loadConciergeMigrationSql,
  mergeImportedWithoutOverwrite,
  isConciergeTestHub,
  runConciergeBenchmark,
  meetsConciergeBenchmarkGates,
  meetsConciergeMetricTargets,
} from '@/modules/messaging/ai/salonConcierge';
import { emptyConciergeSnapshot } from '@/modules/messaging/ai/salonConcierge/defaults';
import { mutateKnowledge as mutateKnowledgeDirect } from '@/modules/messaging/ai/salonConcierge/adminMutations';
import {
  processKernelTurn,
  resetTaskStackForTests,
} from '@/modules/messaging/ai/conversationKernel';
import {
  resetSessionMemoryForTests,
  recordBotAction,
} from '@/modules/messaging/ai/conversationOrchestrator/sessionMemory';
import { evaluateBookingConfirmationGate } from '@/modules/messaging/ai/conversationOrchestrator/confirmationGate';
import { buildTurnFrame } from '@/modules/messaging/ai/conversationOrchestrator/turnFrame';
import {
  runV4Benchmark,
  meetsV4BenchmarkGates,
} from '@/modules/messaging/ai/conversationKernel/benchmark';
import {
  runOrchestratorV3Benchmark,
  meetsV3BenchmarkGates,
} from '@/modules/messaging/ai/conversationOrchestrator/benchmark';
import {
  runOrchestratorV31Benchmark,
  meetsV31BenchmarkGates,
} from '@/modules/messaging/ai/conversationOrchestrator/benchmarkV31';
import type { BookingPlanSnapshot } from '@/modules/messaging/ai/planner/types';
import type { KnowledgeItem } from '@/modules/messaging/ai/salonConcierge/types';

const SLANG = ['يا باشا', 'يا معلم', 'يا كبير', 'يا نجم', 'يا ريس'];

function readyPlan(): BookingPlanSnapshot {
  return {
    planId: 19,
    conversationId: 9901,
    stage: 'ready_to_confirm',
    version: 2,
    branchId: 3,
    branchCode: 'CAMP_CAESAR',
    branchName: 'كامب',
    serviceIds: [20],
    serviceNames: ['شعر ودقن'],
    empId: 25,
    employeeName: 'عمر',
    requestedDate: '2026-08-29',
    timePreference: { kind: 'around', timeHm: '22:00' },
    candidateSlots: [
      { time: '22:00', dayOffset: 0, empId: 25, empName: 'عمر', label: '10م' },
    ],
    selectedSlot: { time: '22:00', dayOffset: 0, empId: 25, empName: 'عمر', label: '10م' },
    clientId: null,
    missingFields: ['confirm'],
    clarification: null,
    lastAvailabilityCheckedAt: null,
    lastTurnId: 1,
    bookingId: null,
    bookingCode: null,
    idempotencyKey: null,
    executionErrorCode: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
}

function assertGrounded(d: Awaited<ReturnType<typeof processConciergeTurn>>) {
  expect(d).toBeTruthy();
  expect(d!.mutatesBookingPlan).toBe(false);
  if (d!.handled && d!.replyText) {
    for (const s of SLANG) expect(d!.replyText).not.toContain(s);
    if (d!.trace.knowledgeGap) {
      expect(d!.trace.answerSource).toBe('UNKNOWN');
    } else {
      expect(d!.trace.answerSource).not.toBe('NONE');
    }
  }
}

describe('Salon Concierge Brain V1.1 production hub', () => {
  beforeEach(() => {
    process.env.SALON_CONCIERGE_BRAIN_V1 = 'true';
    process.env.CUSTOMER_LED_CONVERSATION_V4 = 'true';
    resetConciergeStoreForTests();
    resetSessionMemoryForTests();
    resetTaskStackForTests();
    invalidateConciergeCache();
  });

  it('fixtures are test-only; production SQL files never import fixture store', () => {
    expect(isConciergeTestHub()).toBe(true);
    const root = process.cwd();
    const sqlRepo = readFileSync(join(root, 'src/modules/messaging/ai/salonConcierge/sqlRepository.ts'), 'utf8');
    const hub = readFileSync(join(root, 'src/modules/messaging/ai/salonConcierge/hub.ts'), 'utf8');
    const processTurn = readFileSync(join(root, 'src/modules/messaging/ai/salonConcierge/processConciergeTurn.ts'), 'utf8');
    expect(sqlRepo).not.toMatch(/createFixtureStore|getConciergeStore|fixtureSnapshot|knowledgeStore/);
    expect(processTurn).not.toMatch(/getConciergeStore|createFixtureStore|fixtureSnapshot/);
    expect(hub).toMatch(/isConciergeTestHub/);
    expect(hub).toMatch(/loadProductionSnapshot/);
    expect(hub).toMatch(/await import\('\.\/knowledgeStore'\)/);
  });

  it('migration SQL is additive, idempotent, and complete', () => {
    const sql = loadConciergeMigrationSql();
    const v = validateConciergeMigrationSql(sql);
    expect(v.missingTables).toEqual([]);
    expect(v.destructive).toBe(false);
    expect(v.idempotentMarkers).toBe(true);
    expect(v.ok).toBe(true);
  });

  it('1-5 repository: inactive hidden, branch scope, validity, production-style snapshot', () => {
    const snap = emptyConciergeSnapshot();
    const base: Omit<KnowledgeItem, 'id' | 'key' | 'status' | 'validTo' | 'branchCode'> = {
      category: 'FAQ',
      branchId: null,
      employeeId: null,
      language: 'ar',
      title: 'جراج',
      subject: 'جراج',
      answerText: 'موقف جليم',
      aliases: ['جراج', 'موقف'],
      tags: [],
      source: 'curated',
      priority: 10,
      validFrom: null,
    };
    snap.knowledge.push(
      { ...base, id: 1, key: 'k.active', status: 'active', branchCode: 'GLEEM', validTo: null, answerText: 'موقف جليم' },
      { ...base, id: 2, key: 'k.inactive', status: 'inactive', branchCode: null, validTo: null, title: 'مخفي', subject: 'سؤال مخفي', aliases: ['سؤال مخفي'], answerText: 'يجب ألا يظهر' },
      { ...base, id: 3, key: 'k.expired', status: 'active', branchCode: null, validFrom: '2020-01-01T00:00:00.000Z', validTo: '2020-06-01T00:00:00.000Z', title: 'منتهي', subject: 'عرض قديم وهمي', aliases: ['عرض قديم وهمي'], answerText: 'منتهي' },
      { ...base, id: 4, key: 'k.camp', status: 'active', branchCode: 'CAMP_CAESAR', title: 'جراج كامب', subject: 'جراج كامب', aliases: ['جراج كامب'], answerText: 'كامب فقط' },
    );
    expect(findKnowledge('جراج', snap, { branchCode: 'GLEEM' }).item?.answerText).toMatch(/موقف جليم/);
    expect(findKnowledge('سؤال مخفي', snap).resolution).toBe('unknown');
    expect(findKnowledge('عرض قديم وهمي', snap).resolution).toBe('unknown');
    expect(findKnowledge('جراج كامب', snap, { branchCode: 'CAMP_CAESAR' }).item?.branchCode).toBe('CAMP_CAESAR');
  });

  it('6 cache invalidates after admin mutation', async () => {
    let n = 0;
    invalidateConciergeCache();
    await getCachedSnapshot(async () => {
      n += 1;
      return 'a';
    });
    await getCachedSnapshot(async () => {
      n += 1;
      return 'b';
    });
    expect(n).toBe(1);
    await mutateKnowledgeDirect({
      key: 'faq.cache-bust',
      title: 'كاش',
      answerText: 'بعد الإبطال',
      category: 'FAQ',
      aliases: ['كاش'],
    });
    await getCachedSnapshot(async () => {
      n += 1;
      return 'c';
    });
    expect(n).toBe(2);
  });

  it('7-12 voice: banned slang blocked, يا فندم situational, examples style-only', async () => {
    expect(applyBrandVoice({ answer: 'تمام يا باشا يا معلم' })).not.toMatch(/باشا|معلم/);
    expect(BANNED_SLANG_DEFAULT.length).toBeGreaterThan(3);
    const open = await processConciergeTurn({
      text: 'فاتحين؟',
      openNowOverride: { openTime: '12:00', closeTime: '01:00', nowMinutes: 15 * 60, branchName: 'جليم' },
    });
    expect(open?.replyText).toMatch(/يا فندم/);
    const faq = await processConciergeTurn({ text: 'فيه جراج؟' });
    expect(faq?.replyText).not.toMatch(/يا فندم|حضرتك/);
    expect(containsBannedSlang(faq?.replyText || '')).toBe(false);
    const examples = pickVoiceExamples({
      text: 'شعر ودقن بكام؟',
      intent: 'SERVICE_PRICE_LIVE',
      examples: fixtureSnapshot().examples,
    });
    expect(examples.length).toBeGreaterThan(0);
    const maps = await processConciergeTurn({ text: 'ابعتلي لوكيشن جليم' });
    expect(maps?.replyText).toContain('maps.example.test/gleem');
    expect(maps?.replyText).not.toContain('250');
    expect(maps?.trace.voiceExampleIds.length).toBeLessThanOrEqual(3);
  });

  it('13-18 knowledge FAQ / alias / unknown / gap increment', async () => {
    expect((await processConciergeTurn({ text: 'فيه جراج؟' }))?.replyText).toMatch(/موقف/);
    const curly = findCapability('شعر مجعد');
    expect(curly.resolution).toBe('resolved');
    const unk = await processConciergeTurn({ text: 'بتقدموا مساج تايلاندي؟' });
    expect(unk?.trace.knowledgeGap).toBe(true);
    expect(unk?.replyText).toMatch(/مش مؤكدة/);
    const before = listKnowledgeGaps().find((g) => g.normalizedSubject.includes('تايلاند'));
    await processConciergeTurn({ text: 'بتقدموا مساج تايلاندي؟' });
    const after = listKnowledgeGaps().find((g) => g.normalizedSubject.includes('تايلاند'));
    expect((after?.hitCount ?? 0) >= (before?.hitCount ?? 1)).toBe(true);
    recordKnowledgeGap({ subject: 'بتقدموا مساج تايلاندي؟' });
    expect(listKnowledgeGaps().find((g) => g.normalizedSubject.includes('تايلاند'))!.hitCount).toBeGreaterThan(1);
  });

  it('19-22 links: gleem map, camp map, booking, unknown safe', async () => {
    const gleem = await processConciergeTurn({ text: 'ابعتلي جليم' });
    expect(gleem?.replyText).toContain('gleem');
    const camp = await processConciergeTurn({ text: 'ابعتلي لوكيشن كامب' });
    expect(camp?.replyText).toContain('camp');
    const book = await processConciergeTurn({ text: 'لينك الحجز؟' });
    expect(book?.replyText).toContain('example.test/book');
    const ig = await processConciergeTurn({ text: 'عندكم انستجرام؟' });
    expect(ig?.replyText).toContain('instagram');
    const missing = await processConciergeTurn({ text: 'عندكم تيك توك؟' });
    expect(missing?.trace.knowledgeGap).toBe(true);
    expect(findLink('تيك توك', fixtureSnapshot())).toBeNull();
  });

  it('23-27 capabilities: known, alias, branch, unknown no hallucination', async () => {
    const cap = await processConciergeTurn({ text: 'عندكم حد شاطر في الكيرلي؟' });
    expect(cap?.replyText).toMatch(/محمد/);
    expect(cap?.trace.answerSource).toBe('CAPABILITY');
    const fade = await processConciergeTurn({ text: 'عندكو حد يدفر الشعر؟' });
    expect(fade?.handled).toBe(true);
    expect(fade?.replyText).not.toMatch(/أشطر|أحسن واحد/);
    const gleemFade = await processConciergeTurn({ text: 'في جليم حد متخصص في الفيد؟' });
    expect(gleemFade?.replyText).toMatch(/فيد|تدريج|أحمد/);
    const unk = await processConciergeTurn({ text: 'عندكم حد شاطر في الوشم الياباني؟' });
    expect(unk?.trace.knowledgeGap).toBe(true);
    expect(unk?.replyText).not.toMatch(/أيوه عندنا/);
  });

  it('28-30 offers: active, expired hidden, no unwanted upsell on FAQ', async () => {
    const offers = await processConciergeTurn({ text: 'في عروض؟' });
    expect(offers?.replyText).toMatch(/تجريبي/);
    expect(listActiveOffers().every((o) => o.key !== 'offer.expired.demo')).toBe(true);
    const faq = await processConciergeTurn({ text: 'فيه جراج؟' });
    expect(faq?.replyText).not.toMatch(/عرض تجريبي/);
    expect(faq?.trace.offerId).toBeNull();
  });

  it('31-35 concierge advisor + current question first + no auto resume', async () => {
    const advice = buildUnavailableEmployeeAdvice({
      employeeName: 'عمر',
      requestedTimeLabel: '10',
      alternatives: [
        { label: 'أقرب حاجة معاه 9:45', kind: 'same_employee_near' },
        { label: 'كريم متاح الساعة 10', kind: 'same_time_other_employee' },
        { label: 'نفس الخدمة في جليم', kind: 'other_branch' },
        { label: 'بكرة', kind: 'nearby_day' },
      ],
    });
    expect(advice).toMatch(/9:45/);
    expect(advice.split('\n').length).toBeLessThanOrEqual(4);
    expect(advice).not.toMatch(/أشطر/);
    const cap = await processConciergeTurn({ text: 'عندكم حد شاطر في الكيرلي؟' });
    expect(cap?.replyText).toMatch(/كيرلي|محمد/);
    expect(cap?.mutatesBookingPlan).toBe(false);
  });

  it('36-40 V4 booking plan survives FAQ/maps/instagram; resume later; stale yes blocked', async () => {
    const plan = readyPlan();
    for (const text of ['فيه جراج؟', 'ابعتلي لوكيشن جليم', 'عندكم انستجرام؟']) {
      const d = await processKernelTurn({ conversationId: plan.conversationId, inboundText: text, plan });
      expect(d?.mutatesBookingPlan).toBe(false);
      expect(plan.stage).toBe('ready_to_confirm');
      expect(plan.employeeName).toBe('عمر');
    }
    await processKernelTurn({
      conversationId: plan.conversationId,
      inboundText: 'كمل الحجز',
      plan,
    });
    recordBotAction(plan.conversationId, {
      text: 'أأكدلك عمر الساعة 10؟',
      action: 'ask_booking_confirm',
      answeredWell: true,
      planId: plan.planId,
      planVersion: plan.version,
    });
    recordBotAction(plan.conversationId, {
      text: 'instagram',
      action: 'answered_query',
      answeredWell: true,
      customerText: 'عندكم انستجرام؟',
    });
    const gate = evaluateBookingConfirmationGate({
      conversationId: plan.conversationId,
      turn: { ...buildTurnFrame({ text: 'اه' }), isConfirmation: true, primaryIntent: 'BOOKING_CONFIRMATION' },
      plan,
    });
    expect(gate.allow).toBe(false);
  });

  it('41-42 grounding: unknown does not hallucinate; live hours vs static maps', async () => {
    expect(detectConciergeIntent('مواعيد جليم إيه؟')).toBe('HOURS_LIVE');
    expect(detectConciergeIntent('جليم فاتح دلوقتي؟')).toBe('OPEN_NOW');
    expect(detectConciergeIntent('ابعتلي جليم')).toBe('DIRECTIONS_MAPS');
    const unk = await processConciergeTurn({ text: 'بتقدموا مساج تايلاندي؟' });
    assertGrounded(unk);
    expect(unk?.replyText).not.toMatch(/أيوه/);
  });

  it('imported drafts cannot overwrite curated facts', () => {
    const curated = fixtureSnapshot().knowledge;
    mergeImportedWithoutOverwrite({
      curated,
      importedDrafts: [
        { sourceId: 9, title: 'موقف جليم', subject: 'فيه جراج؟', answerText: 'WRONG', aliases: [], reviewed: false },
      ],
    });
    expect(curated.find((k) => k.key === 'faq.parking.gleem')?.answerText).not.toBe('WRONG');
  });

  it('30+ human quality gauntlets', async () => {
    const turns: Array<{ text: string; check: (d: Awaited<ReturnType<typeof processConciergeTurn>>) => boolean }> = [
      { text: 'فاتحين دلوقتي؟', check: (d) => Boolean(d?.handled && /فاتح|مقفول/.test(d.replyText || '')) },
      { text: 'فين جليم؟', check: (d) => Boolean(d?.replyText?.includes('gleem')) },
      { text: 'ابعت اللوكيشن', check: (d) => Boolean(d?.trace.answerSource === 'LINK' || d?.trace.knowledgeGap) },
      { text: 'مين موجود دلوقتي؟', check: (d) => Boolean(d && !d.handled && d.passToPhase2) },
      { text: 'عندكم حد شاطر في الكيرلي؟', check: (d) => Boolean(d?.replyText?.includes('محمد')) },
      { text: 'في جليم؟', check: (d) => d?.handled !== undefined || d == null },
      { text: 'مين مناسب؟', check: (d) => d == null || d.mutatesBookingPlan === false },
      { text: 'متاح امتى؟', check: (d) => Boolean(!d || d.passToPhase2 || d.handled) },
      { text: 'شعر ودقن بكام؟', check: (d) => Boolean(d?.passToPhase2) },
      { text: 'وعندكم عروض؟', check: (d) => Boolean(d?.handled) },
      { text: 'طب الحجز منين؟', check: (d) => Boolean(d?.replyText?.includes('حجز') || d?.replyText?.includes('book')) },
      { text: 'عايز صبغة رمادي', check: (d) => Boolean(d?.handled && d.trace.answerSource === 'CAPABILITY') },
      { text: 'مين يعملها؟', check: (d) => Boolean(d?.handled) },
      { text: 'هل محتاج أشوف حد الأول؟', check: (d) => Boolean(d?.handled || d == null) },
      { text: 'عندكم انستجرام؟', check: (d) => Boolean(d?.replyText?.includes('instagram')) },
      { text: 'ابعتلي لوكيشن جليم', check: (d) => Boolean(d?.replyText?.includes('gleem')) },
      { text: 'فيه جراج؟', check: (d) => Boolean(d?.replyText?.match(/موقف/)) },
      { text: 'بتقدموا مساج تايلاندي؟', check: (d) => Boolean(d?.trace.knowledgeGap) },
      { text: 'عندكو حد يدفر الشعر؟', check: (d) => Boolean(d?.handled) },
      { text: 'لينك الحجز؟', check: (d) => Boolean(d?.replyText?.includes('book')) },
      { text: 'جليم مفتوح؟', check: (d) => Boolean(d?.handled) },
      { text: 'مواعيد جليم إيه؟', check: (d) => Boolean(d && !d.handled && d.passToPhase2) },
      { text: 'في عروض؟', check: (d) => Boolean(d?.handled) },
      { text: 'عندكم فيسبوك؟', check: (d) => Boolean(d?.handled) },
      { text: 'موقعكم إيه؟', check: (d) => Boolean(d?.replyText?.includes('example.test')) },
      { text: 'احجز ازاي؟', check: (d) => Boolean(d?.handled) },
      { text: 'عندكم حد شاطر في الوشم الياباني؟', check: (d) => Boolean(d?.trace.knowledgeGap) },
      { text: 'ابعتلي لوكيشن كامب', check: (d) => Boolean(d?.replyText?.includes('camp')) },
      { text: 'شعر مجعد', check: (d) => d == null || d.mutatesBookingPlan === false },
      { text: 'فاتحين؟', check: (d) => Boolean(d?.handled) },
      { text: 'عندكم تيك توك؟', check: (d) => Boolean(d?.handled) },
      { text: 'عايز حاجة تخلي الشعر', check: (d) => d == null || !containsBannedSlang(d.replyText || '') },
    ];
    expect(turns.length).toBeGreaterThanOrEqual(30);
    for (const t of turns) {
      const d = await processConciergeTurn({
        text: t.text,
        openNowOverride: { openTime: '12:00', closeTime: '01:00', nowMinutes: 15 * 60, branchName: 'جليم' },
      });
      if (d?.replyText) {
        for (const s of SLANG) expect(d.replyText).not.toContain(s);
      }
      if (!t.check(d)) {
        throw new Error(`gauntlet failed: ${t.text} intent=${d?.trace.intent} src=${d?.trace.answerSource} reply=${d?.replyText}`);
      }
    }
  });

  it('gauntlet E: booking + instagram + location + price + expertise + resume', async () => {
    const plan = readyPlan();
    const ig = await processKernelTurn({ conversationId: plan.conversationId, inboundText: 'عندكم انستجرام؟', plan });
    expect(ig?.replyText).toMatch(/instagram/);
    const loc = await processKernelTurn({ conversationId: plan.conversationId, inboundText: 'ابعتلي لوكيشن جليم', plan });
    expect(loc?.replyText).toMatch(/gleem/);
    const price = await processKernelTurn({ conversationId: plan.conversationId, inboundText: 'شعر ودقن بكام؟', plan });
    expect(price?.passToPhase2).toBe(true);
    const exp = await processKernelTurn({ conversationId: plan.conversationId, inboundText: 'عندكم حد شاطر في الكيرلي؟', plan });
    expect(exp?.replyText).toMatch(/محمد/);
    expect(plan.stage).toBe('ready_to_confirm');
    await processKernelTurn({ conversationId: plan.conversationId, inboundText: 'كمل الحجز', plan });
    expect(plan.employeeName).toBe('عمر');
  });

  it('preview skipGapCapture does not increment gaps', async () => {
    const before = listKnowledgeGaps().length;
    await processConciergeTurn({
      text: 'بتقدموا خدمة غير موجودة نهائيا؟',
      skipGapCapture: true,
    });
    expect(listKnowledgeGaps().length).toBe(before);
  });

  it('performance: static lookups faster than a few ms', () => {
    const snap = fixtureSnapshot();
    const t0 = Date.now();
    for (let i = 0; i < 200; i += 1) {
      findLink('لينك الحجز', snap);
      findKnowledge('فيه جراج؟', snap);
      findCapability('كيرلي', snap);
      pickVoiceExamples({ text: 'فاتحين؟', intent: 'OPEN_NOW', examples: snap.examples });
    }
    expect(Date.now() - t0).toBeLessThan(80);
  });

  it('metrics + concierge/V4/V3 benchmarks', async () => {
    const c = await runConciergeBenchmark();
    expect(meetsConciergeBenchmarkGates(c)).toBe(true);
    expect(
      meetsConciergeMetricTargets({
        KnowledgeAccuracy: 1,
        SourceGroundingRate: 1,
        UnknownSafetyRate: 1,
        BrandVoiceCompliance: 1,
        CustomerQuestionAnswered: 1,
        SolutionUsefulness: 1,
        UnwantedUpsellRate: 0,
        BookingPlanPreservation: 1,
        StaticFastPathRate: 1,
        KnowledgeGapCaptureRate: 1,
        UnsupportedBusinessClaims: 0,
      }),
    ).toBe(true);
    resetSessionMemoryForTests();
    expect(meetsV4BenchmarkGates(runV4Benchmark())).toBe(true);
    expect(meetsV3BenchmarkGates(runOrchestratorV3Benchmark())).toBe(true);
    expect(meetsV31BenchmarkGates(runOrchestratorV31Benchmark())).toBe(true);
  });

  it('loadConciergeSnapshot in tests returns fixture hub', async () => {
    const snap = await loadConciergeSnapshot();
    expect(snap.links.some((l) => l.url.includes('example.test'))).toBe(true);
  });
});
