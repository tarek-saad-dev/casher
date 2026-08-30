/**
 * Trusted Concierge knowledge bootstrap from ERP + official CUT website.
 * Does not enable SALON_CONCIERGE_BRAIN_V1.
 * Does not invent capabilities, social URLs, or third-party prices.
 */
import { getPool, sql } from '@/lib/db';
import { isBarberJob } from '@/lib/booking/publicBookingBarberPolicy';
import { isTestOrSmokeEmployeeName } from '@/lib/hr/testEmployeePolicy';
import { DEFAULT_BRAND_VOICE } from './defaults';
import {
  sqlUpsertBrandVoice,
  sqlUpsertKnowledge,
  sqlUpsertLink,
  sqlUpsertOffer,
  sqlUpsertVoiceExample,
} from './sqlWrites';
import {
  fetchOfficialSiteFacts,
  phonesMatchOfficialMobile,
  VERIFIED_LANDLINE_DIGITS,
  type OfficialSiteFacts,
} from './officialSite';
import { conciergeHoursKnowledgeRows, CONCIERGE_FIXED_BRANCH_HOURS } from './branchBusinessHours';
import { invalidateConciergeCache } from './cache';

const WEBSITE_TEAM_HINTS = ['كريم', 'عمر', 'محمد', 'محمود', 'زياد'] as const;

export type BootstrapReport = {
  ok: boolean;
  database: string;
  flagSalonConciergeBrainV1: string;
  site: OfficialSiteFacts;
  branches: Array<{
    branchId: number;
    branchCode: string;
    branchName: string;
    shortName: string | null;
    address: string | null;
    phone: string | null;
    timeZone: string;
    lifecycleStatus: string;
    publicBookingEnabled: boolean;
    isActive: boolean;
    hoursNote: string;
  }>;
  addressConflicts: string[];
  phoneMatch: boolean;
  landlineSeeded: boolean;
  social: { instagram: boolean; facebook: boolean; tiktok: boolean };
  campOfferSeeded: boolean;
  groomDecision: 'erp_live_only' | 'website_curated' | 'conflict_skipped' | 'none';
  groomConflict?: string;
  teamNamesExposed: string[];
  capabilitiesSeeded: number;
  counts: Record<string, number>;
  duplicates: string[];
  invalidOffers: string[];
  brokenLinks: string[];
  liveRemainLive: string[];
  unknown: string[];
};

type BranchRow = {
  BranchID: number;
  BranchCode: string;
  BranchName: string;
  ShortName: string | null;
  Address: string | null;
  Phone: string | null;
  TimeZone: string;
  DefaultOpenTime: unknown;
  DefaultCloseTime: unknown;
  IsActive: boolean | number;
  LifecycleStatus: string | null;
  PublicBookingEnabled: boolean | number | null;
};

function normAddr(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function mergeSource(name: string, type: string, url: string | null, branch: string | null, notes: string) {
  const pool = await getPool();
  await pool
    .request()
    .input('name', sql.NVarChar(200), name)
    .input('type', sql.NVarChar(40), type)
    .input('url', sql.NVarChar(1000), url)
    .input('branch', sql.NVarChar(50), branch)
    .input('notes', sql.NVarChar(500), notes)
    .query(`
      MERGE dbo.TblSalonKnowledgeSource AS t
      USING (SELECT @name AS SourceName) AS s
      ON t.SourceName = s.SourceName
      WHEN MATCHED THEN UPDATE SET
        SourceType=@type, UrlOrRef=@url, BranchCode=@branch, Active=1,
        Notes=@notes, LastReviewedAt=SYSUTCDATETIME(), UpdatedAt=SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT
        (SourceName, SourceType, UrlOrRef, BranchCode, Active, LastReviewedAt, Notes)
      VALUES (@name, @type, @url, @branch, 1, SYSUTCDATETIME(), @notes);
    `);
}

const VOICE_EXAMPLES: Array<{
  scenarioKey: string;
  category: string;
  customerMessage: string;
  preferredResponse: string;
  notes: string;
}> = [
  {
    scenarioKey: 'style.greeting.evening',
    category: 'GREETING',
    customerMessage: 'مساء الخير',
    preferredResponse: 'مساء النور يا فندم، تحت أمرك.',
    notes: 'style only; honorific once',
  },
  {
    scenarioKey: 'style.greeting.morning',
    category: 'GREETING',
    customerMessage: 'صباح الخير',
    preferredResponse: 'صباح النور، تحت أمرك.',
    notes: 'style only; no forced honorific',
  },
  {
    scenarioKey: 'style.price.hair_beard',
    category: 'PRICE',
    customerMessage: 'شعر ودقن بكام؟',
    preferredResponse: 'شعر ودقن بـ[PRICE] جنيه.',
    notes: 'placeholder — live ERP price',
  },
  {
    scenarioKey: 'style.open_now',
    category: 'OPEN_NOW',
    customerMessage: 'فاتحين دلوقتي؟',
    preferredResponse: 'أيوه يا فندم، فاتحين دلوقتي لحد [LIVE_CLOSING_TIME].',
    notes: 'placeholder — fixed owner-approved hours',
  },
  {
    scenarioKey: 'style.location.gleem',
    category: 'LOCATION',
    customerMessage: 'ابعتلي لوكيشن جليم',
    preferredResponse: 'أكيد، ده لوكيشن فرع جليم:\n[MAP_LINK]',
    notes: 'placeholder — curated official map',
  },
  {
    scenarioKey: 'style.availability',
    category: 'AVAILABILITY',
    customerMessage: 'مين متاح؟',
    preferredResponse: 'المتاح دلوقتي: [LIVE_AVAILABLE].',
    notes: 'placeholder — live availability',
  },
  {
    scenarioKey: 'style.unavailable.time',
    category: 'UNAVAILABLE_OPTION',
    customerMessage: 'عمر مش متاح 10؟',
    preferredResponse: 'الساعة دي مش متاحة لعمر. أقرب بديل مؤكد: [ALT_1].',
    notes: 'state problem then 1–2 grounded alternatives',
  },
  {
    scenarioKey: 'style.clarification.branch',
    category: 'CLARIFICATION',
    customerMessage: 'فين الفرع؟',
    preferredResponse: 'تقصد فرع جليم ولا كامب شيزار؟',
    notes: 'one concise clarification',
  },
  {
    scenarioKey: 'style.unknown.capability',
    category: 'UNKNOWN_INFORMATION',
    customerMessage: 'عندكم حد متخصص في حاجة مش متسجلة؟',
    preferredResponse:
      'مش حابب أقول لحضرتك معلومة مش مؤكدة. لو تحب أوضحلي المطلوب أكتر وأشوف أنسب حاجة نقدر نساعدك بيها.',
    notes: 'no hallucination',
  },
  {
    scenarioKey: 'style.recommendation.one',
    category: 'RECOMMENDATION',
    customerMessage: 'ترشحلي إيه؟',
    preferredResponse: 'من اللي متأكد منه: [GROUNDED_OPTION]. تقرر حضرتك.',
    notes: 'one suggestion; customer decides',
  },
  {
    scenarioKey: 'style.booking.confirm',
    category: 'BOOKING_CONFIRMATION',
    customerMessage: 'تمام احجز',
    preferredResponse: 'تمام، أكد الحجز من خلال خطوة التأكيد في التطبيق.',
    notes: 'style; does not invent booking IDs',
  },
];

function categoryAliases(catName: string): { key: string; aliases: string[]; title: string } | null {
  const n = catName.toLowerCase();
  if (/حلاق|شعر|hair\s*cut|قص/.test(n) && !/ذقن|beard|صبغ|لون|skin/.test(n)) {
    return {
      key: 'svc.cat.hair',
      title: 'قص الشعر',
      aliases: ['قص شعر', 'حلاقة شعر', 'haircut', 'قصه', 'قصة شعر'],
    };
  }
  if (/ذقن|دقن|beard/.test(n)) {
    return {
      key: 'svc.cat.beard',
      title: 'حلاقة الذقن',
      aliases: ['ذقن', 'دقن', 'beard', 'حلاقة دقن'],
    };
  }
  if (/تصفيف|فينيش|styling|finish/.test(n)) {
    return {
      key: 'svc.cat.styling',
      title: 'تصفيف',
      aliases: ['تصفيف', 'فينيش', 'styling'],
    };
  }
  if (/صبغ|لون|color|highlight/.test(n)) {
    return {
      key: 'svc.cat.color',
      title: 'صبغة',
      aliases: ['صبغة', 'لون', 'color'],
    };
  }
  if (/عناية|treatment|skin|skincare/.test(n)) {
    return {
      key: 'svc.cat.care',
      title: 'عناية',
      aliases: ['عناية', 'skincare'],
    };
  }
  return null;
}

export async function bootstrapSalonConciergeKnowledge(): Promise<BootstrapReport> {
  const site = await fetchOfficialSiteFacts();
  const pool = await getPool();
  const dbName = String((await pool.request().query(`SELECT DB_NAME() AS name`)).recordset[0]?.name || '');

  const unknown: string[] = [];
  const addressConflicts: string[] = [];

  const branchRes = await pool.request().query(`
    SELECT
      BranchID, BranchCode, BranchName, ShortName, Address, Phone, TimeZone,
      DefaultOpenTime, DefaultCloseTime, IsActive,
      ISNULL(LifecycleStatus, N'SETUP') AS LifecycleStatus,
      PublicBookingEnabled
    FROM dbo.TblBranch
    WHERE BranchCode IN (N'GLEEM', N'CAMP_CAESAR')
       OR ISNULL(IsActive, 0) = 1
    ORDER BY BranchID
  `);
  const branches = (branchRes.recordset as BranchRow[]).map((r) => ({
    branchId: Number(r.BranchID),
    branchCode: String(r.BranchCode),
    branchName: String(r.BranchName),
    shortName: r.ShortName == null ? null : String(r.ShortName),
    address: r.Address == null ? null : String(r.Address),
    phone: r.Phone == null ? null : String(r.Phone),
    timeZone: String(r.TimeZone),
    lifecycleStatus: String(r.LifecycleStatus ?? 'SETUP'),
    publicBookingEnabled: r.PublicBookingEnabled == null ? Boolean(r.IsActive) : Boolean(r.PublicBookingEnabled),
    isActive: Boolean(r.IsActive),
    hoursNote: 'LIVE_ERP_HOURS_ONLY',
  }));

  const gleem = branches.find((b) => b.branchCode === 'GLEEM');
  const camp = branches.find((b) => b.branchCode === 'CAMP_CAESAR');
  if (!gleem) unknown.push('ERP missing GLEEM branch');
  if (!camp) unknown.push('ERP missing CAMP_CAESAR branch');

  if (gleem?.address && site.gleemAddressWebsiteAr) {
    const ea = normAddr(gleem.address);
    const wa = normAddr(site.gleemAddressWebsiteAr);
    if (ea && wa && !wa.includes(ea.slice(0, 6)) && !ea.includes('يسرى') && !wa.includes(ea.split(' ')[0] ?? '___')) {
      addressConflicts.push(
        `GLEEM address ERP="${gleem.address}" website="${site.gleemAddressWebsiteAr}" — ERP kept; website not merged`,
      );
    }
  }

  const erpPhones = branches.map((b) => b.phone).filter(Boolean);
  const phoneMatch = erpPhones.some((p) => phonesMatchOfficialMobile(p));

  await mergeSource('OFFICIAL_WEBSITE', 'WEBSITE', site.homeUrl, null, 'reviewed/authoritative for brand content');
  await mergeSource('PRODUCTION_ERP', 'ERP', dbName, null, 'authoritative for branches/hours/services/prices/employees');
  await mergeSource('BOOKING_WEBSITE', 'BOOKING_WEBSITE', site.bookingUrl, null, 'official CUT booking page');
  if (site.gleemMapUrl) {
    await mergeSource('GOOGLE_MAPS_GLEEM', 'GOOGLE_MAPS', site.gleemMapUrl, 'GLEEM', 'official site Gleem map');
  } else {
    unknown.push('GLEEM official map URL missing on website HTML');
  }
  if (site.campCaesarMapUrl) {
    await mergeSource('GOOGLE_MAPS_CAMP_CAESAR', 'GOOGLE_MAPS', site.campCaesarMapUrl, 'CAMP_CAESAR', 'official site Camp Caesar map');
  } else {
    unknown.push('CAMP_CAESAR official map URL missing on website HTML');
  }

  await sqlUpsertLink({
    key: 'link.official.website',
    linkType: 'WEBSITE',
    branchCode: null,
    labelAr: 'موقع CUT الرسمي',
    url: site.homeUrl,
    status: 'active',
  });
  await sqlUpsertLink({
    key: 'link.official.booking',
    linkType: 'BOOKING',
    branchCode: null,
    labelAr: 'حجز أونلاين',
    url: site.bookingUrl,
    status: 'active',
  });
  if (site.whatsappUrl && phoneMatch) {
    await sqlUpsertLink({
      key: 'link.official.whatsapp',
      linkType: 'WHATSAPP',
      branchCode: null,
      labelAr: 'واتساب CUT',
      url: site.whatsappUrl,
      status: 'active',
    });
  }
  if (gleem && site.gleemMapUrl) {
    await sqlUpsertLink({
      key: 'GLEEM_GOOGLE_MAPS',
      linkType: 'GOOGLE_MAPS',
      branchCode: 'GLEEM',
      labelAr: 'لوكيشن فرع جليم',
      url: site.gleemMapUrl,
      status: 'active',
    });
  }
  if (camp && site.campCaesarMapUrl) {
    await sqlUpsertLink({
      key: 'CAMP_CAESAR_GOOGLE_MAPS',
      linkType: 'GOOGLE_MAPS',
      branchCode: 'CAMP_CAESAR',
      labelAr: 'لوكيشن فرع كامب شيزار',
      url: site.campCaesarMapUrl,
      status: 'active',
    });
  }

  for (const b of branches.filter((x) => x.branchCode === 'GLEEM' || x.branchCode === 'CAMP_CAESAR')) {
    const addr = b.address
      ? b.address
      : b.branchCode === 'GLEEM'
        ? site.gleemAddressWebsiteAr
        : site.campAddressWebsiteAr;
    const addrSource = b.address ? 'erp_mirror' : 'imported';
    const hours =
      b.branchCode === 'GLEEM'
        ? CONCIERGE_FIXED_BRANCH_HOURS.GLEEM.scheduleLabelAr
        : CONCIERGE_FIXED_BRANCH_HOURS.CAMP_CAESAR.scheduleLabelAr;
    await sqlUpsertKnowledge({
      key: `branch.${b.branchCode.toLowerCase()}.info`,
      category: 'BRANCH_INFO',
      branchId: b.branchId,
      branchCode: b.branchCode,
      title: b.shortName || b.branchName,
      subject: b.branchCode === 'GLEEM' ? 'فرع جليم' : 'فرع كامب شيزار',
      answerText: [
        `${b.branchName}${b.shortName ? ` (${b.shortName})` : ''}.`,
        addr ? `العنوان: ${addr}.` : '',
        `مواعيد العمل للعملاء: ${hours}.`,
        `الحالة العامة: ${b.lifecycleStatus}${b.publicBookingEnabled ? ' — الحجز العام متاح حسب الإعداد الحالي' : ''}.`,
      ]
        .filter(Boolean)
        .join(' '),
      aliases:
        b.branchCode === 'GLEEM'
          ? ['جليم', 'فرع جليم', 'gleem', 'فين جليم', 'سابا باشا']
          : ['كامب', 'كامب شيزار', 'فرع كامب', 'camp', 'camp caesar', 'فين كامب'],
      tags: ['branch', addrSource],
      source: addrSource === 'erp_mirror' ? 'erp_mirror' : 'imported',
      status: 'active',
      priority: 40,
    });
  }

  for (const row of conciergeHoursKnowledgeRows()) {
    await sqlUpsertKnowledge({
      key: row.key,
      category: 'OPENING_POLICY',
      branchCode: row.branchCode,
      title: row.title,
      subject: row.subject,
      answerText: row.answerText,
      aliases: row.aliases,
      tags: ['curated', 'fixed_hours', 'owner_approved'],
      source: 'curated',
      status: 'active',
      priority: 25,
    });
  }

  await sqlUpsertKnowledge({
    key: 'brand.cut.identity',
    category: 'GENERAL_BRAND_INFO',
    title: 'CUT Salon',
    subject: 'عن الصالون',
    answerText:
      'CUT Salon صالون حلاقة رجالي في الإسكندرية، بفرعَين حالياً: جليم وكامب شيزار. التجربة مصممة تكون مرتبة وعن طريق الحجز المسبق تقلل الزحمة.',
    aliases: ['قط', 'كت', 'cut', 'الكات', 'الصالون'],
    tags: ['website', 'curated'],
    source: 'curated',
    status: 'active',
    priority: 80,
  });

  await sqlUpsertKnowledge({
    key: 'booking.help.flow',
    category: 'BOOKING_HELP',
    title: 'الحجز أونلاين',
    subject: 'ازاي احجز',
    answerText:
      'تقدر تحجز أونلاين: تختار الفرع والحلاق حسب التدفق الحالي في صفحة الحجز، بعدين الخدمة والميعاد، وبعدين التأكيد. بعد التأكيد بتوصلك رسالة تأكيد.',
    aliases: ['احجز', 'الحجز', 'لينك الحجز', 'احجز منين', 'ازاي احجز', 'موقع الحجز', 'احجز اونلاين'],
    tags: ['curated', 'app_flow'],
    source: 'curated',
    status: 'active',
    priority: 30,
  });

  if (site.waitPolicyAr) {
    await sqlUpsertKnowledge({
      key: 'policy.arrival.wait',
      category: 'POLICY',
      title: 'الانتظار بعد الوصول',
      subject: 'انتظار الموعد',
      answerText: site.waitPolicyAr,
      aliases: ['انتظار', 'هستنى', 'لما اوصل', 'الدور'],
      tags: ['website', 'curated'],
      source: 'curated',
      status: 'active',
      priority: 60,
    });
  } else {
    unknown.push('Arrival wait 1–10 min not found on live homepage HTML');
  }

  if (phoneMatch && site.mobileDisplay) {
    await sqlUpsertKnowledge({
      key: 'contact.whatsapp.official',
      category: 'CONTACT',
      title: 'واتساب',
      subject: 'رقم التواصل',
      answerText:
        'التواصل الرسمي عبر واتساب على الرقم المنشور في الموقع والمتطابق مع بيانات الإنتاج. رقم الفرع التفصيلي لو مختلف بيتأكد من بيانات الفرع الحية.',
      aliases: ['رقم', 'واتساب', 'كلمونا', 'موبايل'],
      tags: ['curated', 'verified_match'],
      source: 'curated',
      status: 'active',
      priority: 50,
    });
  }

  let landlineSeeded = false;
  const erpHasLandline = erpPhones.some((p) =>
    String(p).replace(/\D/g, '').includes(VERIFIED_LANDLINE_DIGITS.slice(-7)),
  );
  if (site.landlineDisplay && erpHasLandline) {
    await sqlUpsertKnowledge({
      key: 'contact.landline.official',
      category: 'CONTACT',
      title: 'الرقم الأرضي',
      subject: 'أرضي',
      answerText: `الرقم الأرضي المتطابق مع الإنتاج والموقع الرسمي: ${site.landlineDisplay}.`,
      aliases: ['ارضي', 'لاندلاين', '03'],
      tags: ['erp_mirror', 'website'],
      source: 'erp_mirror',
      status: 'active',
      priority: 90,
    });
    landlineSeeded = true;
  } else if (site.landlineDisplay && !erpHasLandline) {
    unknown.push('Official site landline not present on ERP branch phones — not seeded as ERP fact');
  }

  const catRes = await pool.request().query(`
    SELECT DISTINCT c.CatID, c.CatName
    FROM dbo.TblCat c
    INNER JOIN dbo.TblPro p ON p.CatID = c.CatID AND ISNULL(p.isDeleted, 0) = 0
  `);
  for (const row of catRes.recordset as Array<{ CatID: number; CatName: string }>) {
    const mapped = categoryAliases(String(row.CatName ?? ''));
    if (!mapped) continue;
    await sqlUpsertKnowledge({
      key: mapped.key,
      category: 'SERVICE_INFO',
      title: mapped.title,
      subject: String(row.CatName),
      answerText: `القسم ده موجود في الخدمات الحالية باسم «${row.CatName}». السعر والمدة بيتأكدوا لحظيًا من الخدمات المتاحة، مش من رقم ثابت هنا.`,
      aliases: mapped.aliases,
      tags: ['erp_mirror', 'no_static_price'],
      source: 'erp_mirror',
      status: 'active',
      priority: 70,
    });
  }

  let erpPkgs: Array<{ NameEn: string; NameAr: string | null; PackagePrice: number }> = [];
  const pkgTable = await pool.request().query(`SELECT OBJECT_ID(N'dbo.TblServicePackage') AS id`);
  if (pkgTable.recordset[0]?.id) {
    const pkgRes = await pool.request().query(`
      SELECT PackageID, NameEn, NameAr, PackagePrice, isDeleted
      FROM dbo.TblServicePackage
      WHERE ISNULL(isDeleted, 0) = 0
    `);
    erpPkgs = pkgRes.recordset as Array<{ NameEn: string; NameAr: string | null; PackagePrice: number }>;
  }
  let groomDecision: BootstrapReport['groomDecision'] = 'none';
  let groomConflict: string | undefined;
  if (erpPkgs.length > 0) {
    const websitePrices = site.groom
      ? [site.groom.essentialEgp, site.groom.signatureEgp, site.groom.completeEgp]
      : [];
    const erpPrices = erpPkgs.map((p) => Number(p.PackagePrice));
    const overlapConflict =
      websitePrices.length > 0 &&
      websitePrices.some((w) => !erpPrices.includes(w)) &&
      erpPrices.some((e) => !websitePrices.includes(e));
    if (overlapConflict && site.groom) {
      groomDecision = 'conflict_skipped';
      groomConflict = `ERP packages ${erpPrices.join(',')} vs website ${websitePrices.join(',')} — not silently merged`;
      await sqlUpsertKnowledge({
        key: 'svc.groom.packages.live',
        category: 'SERVICE_INFO',
        title: 'باكدج العريس',
        subject: 'باقات العريس',
        answerText:
          'باقات العريس موجودة في النظام الحالي. السعر النهائي بيتأكد من العرض الحي عند الحجز. في اختلاف بين أرقام الموقع وأرقام الإنتاج لذلك مش هذكر رقم ثابت.',
        aliases: ['باكدج العريس', 'باقة العريس', 'groom', 'عريس'],
        tags: ['erp_mirror', 'conflict_no_merge'],
        source: 'erp_mirror',
        status: 'active',
        priority: 65,
      });
    } else {
      groomDecision = 'erp_live_only';
      await sqlUpsertKnowledge({
        key: 'svc.groom.packages.live',
        category: 'SERVICE_INFO',
        title: 'باكدج العريس',
        subject: 'باقات العريس',
        answerText:
          'باقات العريس مسجّلة في الخدمات الحالية. السعر النهائي بيتأكد من العرض الحي عند الحجز، مش من رقم ثابت في الرد.',
        aliases: ['باكدج العريس', 'باقة العريس', 'groom', 'عريس'],
        tags: ['erp_mirror', 'no_static_price'],
        source: 'erp_mirror',
        status: 'active',
        priority: 65,
      });
    }
  } else if (site.groom) {
    groomDecision = 'website_curated';
    const g = site.groom;
    await sqlUpsertKnowledge({
      key: 'svc.groom.packages.website',
      category: 'SERVICE_INFO',
      title: 'باكدج العريس (موقع)',
      subject: 'باقات العريس',
      answerText: [
        `${g.essentialLabelAr}: ${g.essentialEgp} جنيه.`,
        `${g.signatureLabelAr}: ${g.signatureEgp} جنيه.`,
        `${g.completeLabelAr}: ${g.completeEgp} جنيه.`,
        `إضافات منشورة: تفاصيل لون +${g.addOnHairDetailColorEgp}، استرخاء +${g.addOnRelaxEgp}، باديكير +${g.addOnPedicureEgp}، بروتين +${g.addOnProteinEgp}.`,
        `تشطيب خارجي يبدأ من ${g.weddingFromEgp} حسب المكان (${g.weddingTiersEgp.join(' / ')}).`,
        'الأرقام من صفحة الأسعار الرسمية وقت المراجعة، ومش بديل لسعر الخدمة اليومية في الحجز.',
      ].join(' '),
      aliases: ['باكدج العريس', 'باقة العريس', 'groom package', 'عريس'],
      tags: ['imported', 'website_prices'],
      source: 'imported',
      status: 'active',
      priority: 75,
    });
  } else {
    unknown.push('Groom package prices not confirmed on live /prices HTML');
  }

  let campOfferSeeded = false;
  if (site.hasCampFirstVisit50 && camp) {
    await sqlUpsertOffer({
      key: 'offer.camp_caesar.first_visit_50',
      titleAr: 'خصم 50% أول زيارة — كامب شيزار',
      descriptionAr: [
        site.campFirstVisitOfferAr,
        'firstVisitOnly=true',
        'discount=50%',
        'branch=CAMP_CAESAR',
        'source=official website https://cutsaloon.com',
        'مفيش تاريخ انتهاء منشور.',
        'الأهلية مش بتتنفّذ تلقائي؛ الخصم يتأكد حسب شروط الزيارة الأولى والفرع.',
      ].join('\n'),
      branchCodes: ['CAMP_CAESAR'],
      serviceIds: [],
      validFrom: null,
      validTo: null,
      status: 'active',
      priority: 20,
    });
    campOfferSeeded = true;
  }

  const empRes = await pool.request().query(`
    SELECT DISTINCT e.EmpID, e.EmpName, e.Job
    FROM dbo.TblEmp e
    INNER JOIN dbo.TblEmpBranchAssignment a ON a.EmpID = e.EmpID
    WHERE ISNULL(e.isActive, 1) = 1
      AND a.IsActive = 1
      AND a.CanReceiveBookings = 1
  `);
  const teamNamesExposed: string[] = [];
  for (const row of empRes.recordset as Array<{ EmpID: number; EmpName: string; Job: string }>) {
    const name = String(row.EmpName ?? '');
    if (isTestOrSmokeEmployeeName(name)) continue;
    if (!isBarberJob(row.Job)) continue;
    const hit = WEBSITE_TEAM_HINTS.find((h) => name.includes(h));
    if (hit) teamNamesExposed.push(name);
  }
  const uniqueNames = [...new Set(teamNamesExposed)];
  if (uniqueNames.length) {
    await sqlUpsertKnowledge({
      key: 'team.public.booking_eligible.matched',
      category: 'FAQ',
      title: 'الحلاقين',
      subject: 'الفريق',
      answerText: `الأسماء اللي تطابق الحجز العام حالياً من الإنتاج: ${uniqueNames.join('، ')}. مفيش توصية خبرة مسجّلة غير كده.`,
      aliases: ['الحلاقين', 'الفريق', 'مين عندكم'],
      tags: ['erp_mirror'],
      source: 'erp_mirror',
      status: 'active',
      priority: 85,
    });
  } else {
    unknown.push('No booking-eligible ERP employees matched website first names');
  }

  await sqlUpsertBrandVoice('default', DEFAULT_BRAND_VOICE);

  for (const ex of VOICE_EXAMPLES) {
    await sqlUpsertVoiceExample({
      scenarioKey: ex.scenarioKey,
      category: ex.category,
      customerMessage: ex.customerMessage,
      preferredResponse: ex.preferredResponse,
      notes: ex.notes,
      priority: 50,
      isActive: true,
    });
  }

  const countsQ = await pool.request().query(`
    SELECT 'Knowledge' AS kind, COUNT(*) AS n FROM dbo.TblSalonKnowledge
    UNION ALL SELECT 'Capability', COUNT(*) FROM dbo.TblSalonCapability
    UNION ALL SELECT 'Link', COUNT(*) FROM dbo.TblSalonExternalLink
    UNION ALL SELECT 'Offer', COUNT(*) FROM dbo.TblSalonOffer
    UNION ALL SELECT 'BrandVoice', COUNT(*) FROM dbo.TblSalonBrandVoice
    UNION ALL SELECT 'Gap', COUNT(*) FROM dbo.TblSalonKnowledgeGap
    UNION ALL SELECT 'VoiceExample', COUNT(*) FROM dbo.TblSalonBrandVoiceExample
    UNION ALL SELECT 'Source', COUNT(*) FROM dbo.TblSalonKnowledgeSource
  `);
  const counts: Record<string, number> = {};
  for (const r of countsQ.recordset as Array<{ kind: string; n: number }>) {
    counts[r.kind] = Number(r.n);
  }

  const dupK = await pool.request().query(`
    SELECT ItemKey, COUNT(*) c FROM dbo.TblSalonKnowledge GROUP BY ItemKey HAVING COUNT(*) > 1
  `);
  const dupL = await pool.request().query(`
    SELECT LinkKey, COUNT(*) c FROM dbo.TblSalonExternalLink GROUP BY LinkKey HAVING COUNT(*) > 1
  `);
  const duplicates = [
    ...(dupK.recordset as Array<{ ItemKey: string }>).map((r) => `knowledge:${r.ItemKey}`),
    ...(dupL.recordset as Array<{ LinkKey: string }>).map((r) => `link:${r.LinkKey}`),
  ];

  const invalidOffers = (
    await pool.request().query(`
      SELECT OfferKey FROM dbo.TblSalonOffer
      WHERE Status = N'active' AND ValidTo IS NOT NULL AND ValidTo < SYSUTCDATETIME()
    `)
  ).recordset.map((r: { OfferKey: string }) => r.OfferKey);

  const brokenLinks = (
    await pool.request().query(`
      SELECT LinkKey FROM dbo.TblSalonExternalLink
      WHERE Status = N'active' AND (Url IS NULL OR LTRIM(RTRIM(Url)) = N'')
    `)
  ).recordset.map((r: { LinkKey: string }) => r.LinkKey);

  invalidateConciergeCache();

  return {
    ok:
      duplicates.length === 0 &&
      invalidOffers.length === 0 &&
      brokenLinks.length === 0 &&
      Number(counts.Capability ?? 0) === 0 &&
      Boolean(gleem && camp && site.gleemMapUrl && site.campCaesarMapUrl),
    database: dbName,
    flagSalonConciergeBrainV1: process.env.SALON_CONCIERGE_BRAIN_V1 ?? 'unset',
    site,
    branches,
    addressConflicts,
    phoneMatch,
    landlineSeeded,
    social: {
      instagram: Boolean(site.instagramUrl),
      facebook: Boolean(site.facebookUrl),
      tiktok: Boolean(site.tiktokUrl),
    },
    campOfferSeeded,
    groomDecision,
    groomConflict,
    teamNamesExposed: uniqueNames,
    capabilitiesSeeded: 0,
    counts,
    duplicates,
    invalidOffers,
    brokenLinks,
    liveRemainLive: [
      'OPEN_NOW → fixed owner-approved hours (Cairo)',
      'HOURS_LIVE → fixed owner-approved schedules',
      'SERVICE_PRICE_LIVE → live ERP catalog',
      'AVAILABILITY_LIVE → live employees',
      'regular service prices not stored as static FAQ',
    ],
    unknown,
  };
}
