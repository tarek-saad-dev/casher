import { describe, expect, it } from 'vitest';
import { extractOfficialSiteFacts } from '@/modules/messaging/ai/salonConcierge/officialSite';
import { applyBrandVoice, containsBannedSlang, unknownFactReply } from '@/modules/messaging/ai/salonConcierge/brandVoice';
import { DEFAULT_BRAND_VOICE } from '@/modules/messaging/ai/salonConcierge/defaults';
import { processConciergeTurn } from '@/modules/messaging/ai/salonConcierge/processConciergeTurn';
import { emptyConciergeSnapshot } from '@/modules/messaging/ai/salonConcierge/defaults';
import { detectConciergeIntent } from '@/modules/messaging/ai/salonConcierge/routing';
import { findLink } from '@/modules/messaging/ai/salonConcierge/lookup';
import { isSalonConciergeBrainEnabled } from '@/modules/messaging/ai/salonConcierge/featureFlag';
import type { ConciergeSnapshot, ExternalLinkItem, OfferItem } from '@/modules/messaging/ai/salonConcierge/types';

const HOME = `
فرع جليم – سابا باشا</p><p class="x">يسرى قمحة، فلمنج، قسم أول الرمل، الإسكندرية</p>
<a href="https://share.google/F4o7oOQVs3EJSgxaw">map</a>
كامب شيزار</p><p>كامب شيزار، الإسكندرية — أحدث فروع CUT</p>
<p>خصم 50% على كل الخدمات في زيارتك الأولى</p>
<a href="https://maps.app.goo.gl/217r3pLutcKFAW2x7">camp</a>
<a href="https://wa.me/201012126899">wa</a>
+20 101 212 6899 03 5861483 0101 212 6899
<p>عند حضورك في الموعد قد يكون هناك انتظار بسيط من <span>1 إلى 10 دقائق</span> كحد أقصى حتى يبدأ دورك.</p>
`;

const PRICES = `
<h3>Essential</h3><p>الأساسيات</p><p>1,250 ج.م</p>
<p class="font-display">GROOM SIGNATURE</p><p>1,650 ج.م</p>
<p>2,100 ج.م</p>
<p>Hair Detail Color</p><p>150 ج.م</p>
<p>Relax Session</p><p>200 ج.م</p>
<p>Pedicure</p><p>400 ج.م</p>
<p>Protein Treatment</p><p>1,000 ج.م</p>
<p>حسب الموقع: 1,500 / 1,750 / 2,000</p>
`;

const BANNED = ['يا باشا', 'يا معلم', 'يا كبير', 'يا نجم', 'يا ريس', 'يا حاج'];

function seededSnap(): ConciergeSnapshot {
  const links: ExternalLinkItem[] = [
    {
      id: 1,
      key: 'GLEEM_GOOGLE_MAPS',
      linkType: 'GOOGLE_MAPS',
      branchCode: 'GLEEM',
      labelAr: 'لوكيشن فرع جليم',
      url: 'https://share.google/F4o7oOQVs3EJSgxaw',
      status: 'active',
    },
    {
      id: 2,
      key: 'CAMP_CAESAR_GOOGLE_MAPS',
      linkType: 'GOOGLE_MAPS',
      branchCode: 'CAMP_CAESAR',
      labelAr: 'لوكيشن فرع كامب شيزار',
      url: 'https://maps.app.goo.gl/217r3pLutcKFAW2x7',
      status: 'active',
    },
    {
      id: 3,
      key: 'link.official.booking',
      linkType: 'BOOKING',
      branchCode: null,
      labelAr: 'حجز أونلاين',
      url: 'https://cutsaloon.com/book',
      status: 'active',
    },
  ];
  const offers: OfferItem[] = [
    {
      id: 9,
      key: 'offer.camp_caesar.first_visit_50',
      titleAr: 'خصم 50% أول زيارة — كامب شيزار',
      descriptionAr: 'firstVisitOnly=true\nbranch=CAMP_CAESAR',
      branchCodes: ['CAMP_CAESAR'],
      serviceIds: [],
      validFrom: null,
      validTo: null,
      status: 'active',
      priority: 20,
    },
  ];
  return {
    ...emptyConciergeSnapshot(DEFAULT_BRAND_VOICE),
    links,
    offers,
    capabilities: [],
  };
}

describe('official CUT site extract', () => {
  it('parses maps, offer, wait, groom, and leaves social empty', () => {
    const facts = extractOfficialSiteFacts(HOME, PRICES);
    expect(facts.hasCampFirstVisit50).toBe(true);
    expect(facts.gleemMapUrl).toContain('share.google');
    expect(facts.campCaesarMapUrl).toContain('maps.app.goo.gl');
    expect(facts.waitPolicyAr).toMatch(/1 إلى 10/);
    expect(facts.groom?.essentialEgp).toBe(1250);
    expect(facts.groom?.signatureEgp).toBe(1650);
    expect(facts.groom?.completeEgp).toBe(2100);
    expect(facts.instagramUrl).toBeNull();
    expect(facts.facebookUrl).toBeNull();
    expect(facts.tiktokUrl).toBeNull();
  });
});

describe('brand voice audit 50 replies', () => {
  const templates = [
    'مساء النور، تحت أمرك.',
    'أيوه يا فندم، فاتحين دلوقتي لحد 1 ص.',
    'شعر ودقن بـ250 جنيه.',
    'أكيد، ده لوكيشن فرع جليم.',
    'المتاح دلوقتي: عمر.',
    'الساعة دي مش متاحة. أقرب بديل مؤكد: 10:30.',
    'تقصد فرع جليم ولا كامب شيزار؟',
    unknownFactReply(),
    'من اللي متأكد منه: قصة عادية. تقرر حضرتك.',
    'تمام، أكد الحجز من خطوة التأكيد.',
  ];
  const replies: string[] = [];
  for (let i = 0; i < 50; i++) {
    replies.push(
      applyBrandVoice({
        answer: templates[i % templates.length]!,
        voice: DEFAULT_BRAND_VOICE,
        situation: 'none',
      }),
    );
  }

  it('emits 50 replies without banned slang or repeated يا فندم', () => {
    expect(replies).toHaveLength(50);
    for (const r of replies) {
      expect(containsBannedSlang(r, DEFAULT_BRAND_VOICE)).toBe(false);
      for (const b of BANNED) expect(r).not.toContain(b);
      const n = (r.match(/يا فندم/g) ?? []).length;
      expect(n).toBeLessThanOrEqual(1);
    }
  });
});

describe('knowledge safety gauntlet', () => {
  it('keeps live intents live and does not invent social/capability', async () => {
    const prev = process.env.SALON_CONCIERGE_BRAIN_V1;
    process.env.SALON_CONCIERGE_BRAIN_V1 = 'true';
    expect(detectConciergeIntent('فاتحين دلوقتي؟')).toBe('OPEN_NOW');
    expect(detectConciergeIntent('شعر ودقن بكام؟')).toBe('SERVICE_PRICE_LIVE');
    expect(detectConciergeIntent('مين متاح؟')).toBe('AVAILABILITY_LIVE');
    expect(detectConciergeIntent('فين جليم؟')).toBe('DIRECTIONS_MAPS');
    expect(detectConciergeIntent('لينك الحجز؟')).toBe('EXTERNAL_LINK');
    expect(detectConciergeIntent('عندكم انستجرام؟')).toBe('EXTERNAL_LINK');
    expect(detectConciergeIntent('مين شاطر في الكيرلي؟')).toBe('CAPABILITY_QUERY');
    expect(detectConciergeIntent('في عروض؟')).toBe('OFFER_QUERY');

    const snap = seededSnap();
    const gleem = await processConciergeTurn({
      text: 'ابعتلي لوكيشن جليم',
      snapshotOverride: snap,
      skipGapCapture: true,
    });
    expect(gleem?.replyText).toContain('share.google/F4o7oOQVs3EJSgxaw');
    expect(gleem?.replyText).not.toContain('217r3pLutcKFAW2x7');

    const book = await processConciergeTurn({
      text: 'لينك الحجز؟',
      snapshotOverride: snap,
      skipGapCapture: true,
    });
    expect(book?.replyText).toContain('cutsaloon.com/book');

    const ig = await processConciergeTurn({
      text: 'عندكم انستجرام؟',
      snapshotOverride: snap,
      skipGapCapture: true,
    });
    expect(ig?.trace.knowledgeGap).toBe(true);
    expect(ig?.replyText).toMatch(/مش مؤكدة/);

    const curly = await processConciergeTurn({
      text: 'مين شاطر في الكيرلي؟',
      snapshotOverride: snap,
      skipGapCapture: true,
    });
    expect(curly?.trace.answerSource).toBe('UNKNOWN');
    expect(curly?.replyText).not.toMatch(/كريم|عمر|محمد/);

    const unkTech = await processConciergeTurn({
      text: 'عندكم حد يعمل تقنية غير مسجلة؟',
      snapshotOverride: snap,
      skipGapCapture: true,
    });
    expect(unkTech?.trace.knowledgeGap).toBe(true);

    const offer = await processConciergeTurn({
      text: 'في عروض؟',
      snapshotOverride: snap,
      skipGapCapture: true,
    });
    expect(offer?.replyText).toMatch(/50%/);
    expect(offer?.replyText).toMatch(/الأهلية/);

    expect(findLink('ابعتلي لوكيشن جليم', snap, { branchCode: 'GLEEM' })?.url).toContain('share.google');
    expect(isSalonConciergeBrainEnabled({ SALON_CONCIERGE_BRAIN_V1: 'false' })).toBe(false);
    expect(isSalonConciergeBrainEnabled({})).toBe(false);
    if (prev === undefined) delete process.env.SALON_CONCIERGE_BRAIN_V1;
    else process.env.SALON_CONCIERGE_BRAIN_V1 = prev;
  });
});
