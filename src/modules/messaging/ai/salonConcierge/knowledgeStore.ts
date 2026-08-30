/**
 * Test-only fixture store. Production MUST NOT call getConciergeStore().
 */
import { DEFAULT_BRAND_VOICE, emptyConciergeSnapshot } from './defaults';
import type {
  ConciergeSnapshot,
  KnowledgeGap,
  KnowledgeItem,
  OfferItem,
  VoiceExample,
} from './types';

export { DEFAULT_BRAND_VOICE };

export type ConciergeStore = ConciergeSnapshot & {
  gapsMap: Map<string, KnowledgeGap>;
};

function snapshotGaps(map: Map<string, KnowledgeGap>): KnowledgeGap[] {
  return [...map.values()];
}

/** Test/fixture content only — not production salon truth. */
export function createFixtureStore(): ConciergeStore {
  const gapsMap = new Map<string, KnowledgeGap>();
  const knowledge: KnowledgeItem[] = [
    {
      id: 1,
      key: 'faq.parking.gleem',
      category: 'FAQ',
      branchId: null,
      branchCode: 'GLEEM',
      employeeId: null,
      language: 'ar',
      title: 'موقف جليم',
      subject: 'فيه جراج؟',
      answerText: 'فرع جليم فيه موقف قريب من الصالون — اسأل الاستقبال عند الوصول.',
      aliases: ['جراج', 'موقف', 'باركينج', 'parking'],
      tags: ['gleem', 'parking'],
      source: 'curated',
      status: 'active',
      priority: 50,
      validFrom: null,
      validTo: null,
    },
    {
      id: 2,
      key: 'booking.how',
      category: 'BOOKING_HELP',
      branchId: null,
      branchCode: null,
      employeeId: null,
      language: 'ar',
      title: 'طريقة الحجز',
      subject: 'احجز ازاي؟',
      answerText: 'تقدر تحجز من خلالنا على الواتساب أو من لينك الحجز الإلكتروني.',
      aliases: ['احجز ازاي', 'ازاي احجز', 'طريقة الحجز', 'الحجز منين'],
      tags: ['booking'],
      source: 'curated',
      status: 'active',
      priority: 40,
      validFrom: null,
      validTo: null,
    },
    {
      id: 3,
      key: 'faq.inactive',
      category: 'FAQ',
      branchId: null,
      branchCode: null,
      employeeId: null,
      language: 'ar',
      title: 'مخفي',
      subject: 'سؤال مخفي',
      answerText: 'يجب ألا يظهر',
      aliases: ['سؤال مخفي'],
      tags: [],
      source: 'curated',
      status: 'inactive',
      priority: 1,
      validFrom: null,
      validTo: null,
    },
    {
      id: 4,
      key: 'faq.expired',
      category: 'FAQ',
      branchId: null,
      branchCode: null,
      employeeId: null,
      language: 'ar',
      title: 'منتهي',
      subject: 'عرض قديم وهمي',
      answerText: 'منتهي',
      aliases: ['عرض قديم وهمي'],
      tags: [],
      source: 'curated',
      status: 'active',
      priority: 1,
      validFrom: '2020-01-01T00:00:00.000Z',
      validTo: '2020-06-01T00:00:00.000Z',
    },
  ];
  const offers: OfferItem[] = [
    {
      id: 1,
      key: 'offer.active.demo',
      titleAr: 'عرض تجريبي نشط',
      descriptionAr: 'خصم تجريبي للاختبار فقط — ليس عرض إنتاج.',
      branchCodes: ['GLEEM'],
      serviceIds: [],
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2099-12-31T00:00:00.000Z',
      status: 'active',
      priority: 10,
    },
    {
      id: 2,
      key: 'offer.expired.demo',
      titleAr: 'عرض منتهي',
      descriptionAr: 'انتهى — يجب ألا يظهر.',
      branchCodes: [],
      serviceIds: [],
      validFrom: '2020-01-01T00:00:00.000Z',
      validTo: '2020-12-31T00:00:00.000Z',
      status: 'active',
      priority: 1,
    },
  ];
  const examples: VoiceExample[] = [
    {
      id: 1,
      scenarioKey: 'price',
      category: 'PRICE',
      customerMessage: 'شعر ودقن بكام؟',
      preferredResponse: 'شعر ودقن بـ250 جنيه.',
      notes: 'no honorific on simple price',
      priority: 10,
      isActive: true,
    },
    {
      id: 2,
      scenarioKey: 'open-now',
      category: 'AVAILABILITY',
      customerMessage: 'فاتحين؟',
      preferredResponse: 'أيوه يا فندم، فاتحين دلوقتي.',
      notes: 'situational honorific',
      priority: 10,
      isActive: true,
    },
  ];
  const store: ConciergeStore = {
    knowledge,
    capabilities: [
      {
        id: 1,
        key: 'curly_hair',
        displayNameAr: 'شعر كيرلي',
        aliases: ['كيرلي', 'curly', 'مجعد', 'كيرلي هير', 'شعر كيرلي'],
        descriptionAr: 'خبرة في التعامل مع الشعر الكيرلي حسب بيانات الصالون المعتمدة.',
        serviceIds: [],
        employeeIds: [40],
        employeeNames: ['محمد'],
        branchCodes: ['GLEEM', 'CAMP_CAESAR'],
        status: 'active',
      },
      {
        id: 2,
        key: 'fade',
        displayNameAr: 'فيد / تدريج',
        aliases: ['فيد', 'تدريج', 'fade', 'taper', 'يدفر'],
        descriptionAr: 'تنفيذ فيد وتدريج حسب مهارة الحلاقين المعتمدين.',
        serviceIds: [],
        employeeIds: [41],
        employeeNames: ['أحمد'],
        branchCodes: ['GLEEM'],
        status: 'active',
      },
      {
        id: 3,
        key: 'hair_color',
        displayNameAr: 'صبغة',
        aliases: ['صبغة', 'لون', 'color', 'صبغه', 'رمادي'],
        descriptionAr: 'خدمات صبغة — التقييم النهائي يكون في الصالون.',
        serviceIds: [],
        employeeIds: [],
        employeeNames: [],
        branchCodes: ['GLEEM', 'CAMP_CAESAR'],
        status: 'active',
      },
    ],
    links: [
      {
        id: 1,
        key: 'booking.main',
        linkType: 'BOOKING',
        branchCode: null,
        labelAr: 'لينك الحجز',
        url: 'https://example.test/book',
        status: 'active',
      },
      {
        id: 2,
        key: 'social.instagram',
        linkType: 'INSTAGRAM',
        branchCode: null,
        labelAr: 'إنستجرام',
        url: 'https://instagram.com/example.test',
        status: 'active',
      },
      {
        id: 3,
        key: 'maps.gleem',
        linkType: 'GOOGLE_MAPS',
        branchCode: 'GLEEM',
        labelAr: 'لوكيشن جليم',
        url: 'https://maps.example.test/gleem',
        status: 'active',
      },
      {
        id: 4,
        key: 'website.main',
        linkType: 'WEBSITE',
        branchCode: null,
        labelAr: 'الموقع',
        url: 'https://example.test',
        status: 'active',
      },
      {
        id: 5,
        key: 'maps.camp',
        linkType: 'GOOGLE_MAPS',
        branchCode: 'CAMP_CAESAR',
        labelAr: 'لوكيشن كامب',
        url: 'https://maps.example.test/camp',
        status: 'active',
      },
    ],
    offers,
    brandVoice: { ...DEFAULT_BRAND_VOICE },
    examples,
    sources: [
      {
        id: 1,
        name: 'Manual owner',
        sourceType: 'MANUAL',
        urlOrRef: null,
        branchCode: null,
        active: true,
        lastReviewedAt: null,
        notes: 'Owner curated',
      },
    ],
    gaps: [],
    gapsMap,
  };
  store.gaps = snapshotGaps(gapsMap);
  return store;
}

let activeStore: ConciergeStore = createFixtureStore();

/** @deprecated production — tests only */
export function getConciergeStore(): ConciergeStore {
  return activeStore;
}

export function setConciergeStore(store: ConciergeStore): void {
  activeStore = store;
}

export function resetConciergeStoreForTests(): void {
  activeStore = createFixtureStore();
}

export function fixtureSnapshot(): ConciergeSnapshot {
  const s = getConciergeStore();
  return {
    knowledge: s.knowledge,
    capabilities: s.capabilities,
    links: s.links,
    offers: s.offers,
    brandVoice: s.brandVoice,
    examples: s.examples,
    sources: s.sources,
    gaps: [...s.gapsMap.values()],
  };
}

export function emptyProdSnapshot(): ConciergeSnapshot {
  return emptyConciergeSnapshot();
}
