/**
 * Live parse of the official CUT Salon website.
 * Never used as ERP price/hours authority.
 */

export const OFFICIAL_WEBSITE_URL = 'https://cutsaloon.com';
export const OFFICIAL_PRICES_URL = 'https://cutsaloon.com/prices';
export const OFFICIAL_BOOKING_URL = 'https://cutsaloon.com/book';

export const VERIFIED_WHATSAPP_E164 = '201012126899';
export const VERIFIED_MOBILE_LOCAL = '01012126899';
export const VERIFIED_LANDLINE_DIGITS = '035861483';

export type OfficialGroomFacts = {
  essentialEgp: number;
  signatureEgp: number;
  completeEgp: number;
  essentialLabelAr: string;
  signatureLabelAr: string;
  completeLabelAr: string;
  addOnHairDetailColorEgp: number;
  addOnRelaxEgp: number;
  addOnPedicureEgp: number;
  addOnProteinEgp: number;
  weddingFromEgp: number;
  weddingTiersEgp: number[];
};

export type OfficialSiteFacts = {
  fetchedAt: string;
  homeUrl: string;
  pricesUrl: string;
  bookingUrl: string;
  hasCampFirstVisit50: boolean;
  campFirstVisitOfferAr: string | null;
  gleemMapUrl: string | null;
  campCaesarMapUrl: string | null;
  gleemAddressWebsiteAr: string | null;
  campAddressWebsiteAr: string | null;
  waitPolicyAr: string | null;
  whatsappUrl: string | null;
  mobileDisplay: string | null;
  landlineDisplay: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  tiktokUrl: string | null;
  groom: OfficialGroomFacts | null;
  premiumMensGrooming: boolean;
};

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstHref(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m?.[1] ?? null;
}

function parseEgp(raw: string): number | null {
  const n = Number(String(raw).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function extractOfficialSiteFacts(homeHtml: string, pricesHtml: string): OfficialSiteFacts {
  const gleemBlock = homeHtml.match(/فرع جليم[\s\S]{0,500}/)?.[0] ?? '';
  const campBlock = homeHtml.match(/كامب شيزار[\s\S]{0,500}/)?.[0] ?? '';

  const gleemMapUrl =
    firstHref(gleemBlock, /href="(https:\/\/share\.google\/[^"]+)"/) ??
    firstHref(homeHtml, /href="(https:\/\/share\.google\/[^"]+)"/);
  const campCaesarMapUrl =
    firstHref(campBlock, /href="(https:\/\/maps\.app\.goo\.gl\/[^"]+)"/) ??
    firstHref(homeHtml, /href="(https:\/\/maps\.app\.goo\.gl\/[^"]+)"/);

  const gleemAddressWebsiteAr =
    homeHtml.match(/فرع جليم[^<]*<\/p>\s*<p[^>]*>([^<]+)/)?.[1]?.trim() ?? null;
  const campAddressWebsiteAr =
    campBlock.match(/كامب شيزار،[^<]+/)?.[0]?.trim() ?? null;

  const hasCampFirstVisit50 =
    /خصم\s*50\s*%/.test(homeHtml) &&
    /زيارتك الأولى/.test(homeHtml) &&
    /كامب شيزار/.test(homeHtml);

  const campFirstVisitOfferAr = hasCampFirstVisit50
    ? 'خصم 50% على كل الخدمات في زيارتك الأولى — فرع كامب شيزار فقط (حسب الإعلان الحالي على الموقع الرسمي).'
    : null;

  const waitMatch = homeHtml.match(
    /عند حضورك في الموعد قد يكون هناك انتظار بسيط من[\s\S]{0,120}1 إلى 10 دقائق[\s\S]{0,80}/,
  );
  const waitPolicyAr = waitMatch
    ? 'عند حضورك في الموعد قد يكون هناك انتظار بسيط من 1 إلى 10 دقائق كحد أقصى حتى يبدأ دورك.'
    : null;

  const wa = homeHtml.match(/https:\/\/wa\.me\/(\d+)/)?.[0] ?? null;
  const mobileDisplay = /0101\s*212\s*6899/.test(homeHtml) ? '0101 212 6899' : null;
  const landlineDisplay = /03\s*5861483/.test(homeHtml) ? '03 5861483' : null;

  const socialRe = (host: string) =>
    homeHtml.match(new RegExp(`https?://(?:www\\.)?${host}/[^\\s"'<>]+`, 'i'))?.[0] ?? null;

  const essentialEgp = parseEgp(pricesHtml.match(/الأساسيات[\s\S]{0,120}?([\d,]+)\s*ج\.م/)?.[1] ?? '');
  const signatureEgp = parseEgp(pricesHtml.match(/GROOM SIGNATURE[\s\S]{0,200}?([\d,]+)\s*ج\.م/)?.[1] ?? '');
  const completeEgp = parseEgp(pricesHtml.match(/([\d,]+)\s*ج\.م[\s\S]{0,40}(?=[\s\S]{0,200}2,100|COMPLETE)/)?.[1] ?? '');
  const completeDirect = parseEgp(pricesHtml.match(/2,100\s*ج\.م/)?.[0] ?? '');
  const essentialDirect = parseEgp(pricesHtml.match(/1,250\s*ج\.م/)?.[0] ?? '');
  const signatureDirect = parseEgp(pricesHtml.match(/1,650\s*ج\.م/)?.[0] ?? '');

  const add150 = pricesHtml.includes('Hair Detail Color') && pricesHtml.includes('150 ج.م');
  const add200 = pricesHtml.includes('Relax Session') && pricesHtml.includes('200 ج.م');
  const add400 = pricesHtml.includes('Pedicure') && pricesHtml.includes('400 ج.م');
  const add1000 = pricesHtml.includes('Protein Treatment') && pricesHtml.includes('1,000 ج.م');
  const wedding = /حسب الموقع:\s*1,500\s*\/\s*1,750\s*\/\s*2,000/.test(pricesHtml);

  let groom: OfficialGroomFacts | null = null;
  const ess = essentialEgp ?? essentialDirect;
  const sig = signatureEgp ?? signatureDirect;
  const com = completeDirect ?? completeEgp;
  if (ess && sig && com && add150 && add200 && add400 && add1000 && wedding) {
    groom = {
      essentialEgp: ess,
      signatureEgp: sig,
      completeEgp: com,
      essentialLabelAr: 'باكدج العريس — الأساسيات',
      signatureLabelAr: 'باكدج العريس — Signature',
      completeLabelAr: 'باكدج العريس — Complete',
      addOnHairDetailColorEgp: 150,
      addOnRelaxEgp: 200,
      addOnPedicureEgp: 400,
      addOnProteinEgp: 1000,
      weddingFromEgp: 1500,
      weddingTiersEgp: [1500, 1750, 2000],
    };
  }

  return {
    fetchedAt: new Date().toISOString(),
    homeUrl: OFFICIAL_WEBSITE_URL,
    pricesUrl: OFFICIAL_PRICES_URL,
    bookingUrl: OFFICIAL_BOOKING_URL,
    hasCampFirstVisit50,
    campFirstVisitOfferAr,
    gleemMapUrl,
    campCaesarMapUrl,
    gleemAddressWebsiteAr,
    campAddressWebsiteAr,
    waitPolicyAr,
    whatsappUrl: wa,
    mobileDisplay,
    landlineDisplay,
    instagramUrl: socialRe('instagram\\.com'),
    facebookUrl: socialRe('facebook\\.com'),
    tiktokUrl: socialRe('tiktok\\.com'),
    groom,
    premiumMensGrooming: /grooming|حلاقة|قصّة|barber|رجال/i.test(stripTags(homeHtml).slice(0, 4000)),
  };
}

export async function fetchOfficialSiteFacts(): Promise<OfficialSiteFacts> {
  const homeRes = await fetch(OFFICIAL_WEBSITE_URL, { redirect: 'follow' });
  const pricesRes = await fetch(OFFICIAL_PRICES_URL, { redirect: 'follow' });
  if (!homeRes.ok) throw new Error(`Official home HTTP ${homeRes.status}`);
  if (!pricesRes.ok) throw new Error(`Official prices HTTP ${pricesRes.status}`);
  const homeHtml = await homeRes.text();
  const pricesHtml = await pricesRes.text();
  return extractOfficialSiteFacts(homeHtml, pricesHtml);
}

export function digitsOnly(phone: string | null | undefined): string {
  return String(phone ?? '').replace(/\D/g, '');
}

export function phonesMatchOfficialMobile(erpPhone: string | null | undefined): boolean {
  const d = digitsOnly(erpPhone);
  return d === VERIFIED_MOBILE_LOCAL || d === VERIFIED_WHATSAPP_E164 || d.endsWith('1012126899');
}
