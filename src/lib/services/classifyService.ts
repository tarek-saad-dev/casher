export type ServiceCategory = 'hair' | 'hair_beard' | 'beard' | 'other';

export type BarberServiceCategory = 'hair' | 'hair_beard' | 'beard';

export function isBarberServiceCategory(category: ServiceCategory): category is BarberServiceCategory {
  return category === 'hair' || category === 'hair_beard' || category === 'beard';
}

export interface ClassifiableService {
  proId?: number | null;
  serviceName?: string | null;
  serviceNameAr?: string | null;
}

/**
 * Stable ProID mapping from TblPro audit (SimpleCreateQueueDrawer + barber seed).
 * Prefer ProID; use normalized names only as fallback for unknown IDs.
 */
const HAIR_ONLY_PRO_IDS = new Set<number>([
  1, // Hair Cut
  4, // Fade Cut
  5, // Advanced Cut
]);

const HAIR_BEARD_PRO_IDS = new Set<number>([
  3, // Haircut & Beard
]);

const BEARD_ONLY_PRO_IDS = new Set<number>([
  2, // Beard Styling & Fade
]);

/** English ProName values for haircut-only services */
const HAIR_ONLY_NAMES = new Set<string>([
  'hair cut',
  'fade cut',
  'advanced cut',
]);

/** English ProName values for combined hair + beard services */
const HAIR_BEARD_NAMES = new Set<string>([
  'haircut & beard',
  'hair & beard color',
]);

/** Arabic ProNameAr values for haircut-only services */
const HAIR_ONLY_NAMES_AR = new Set<string>([
  'حلاقة شعر',
  'حلاقة فيد',
  'قصة احترافية',
]);

/** Arabic ProNameAr values for combined hair + beard services */
const HAIR_BEARD_NAMES_AR = new Set<string>([
  'شعر ودقن',
  'صبغة شعر ودقن',
]);

/** English ProName values for beard-only services */
const BEARD_ONLY_NAMES = new Set<string>([
  'beard styling & fade',
  'zero beard shave',
  'beard bleaching',
]);

/** Arabic ProNameAr values for beard-only services */
const BEARD_ONLY_NAMES_AR = new Set<string>([
  'تدريج وتحديد الدقن',
  'دقن زيرو',
  'تشقير دقن',
]);

function normalizeServiceName(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArabicName(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function classifyService(service: ClassifiableService): ServiceCategory {
  const proId = service.proId ?? null;

  if (proId != null) {
    if (HAIR_ONLY_PRO_IDS.has(proId)) return 'hair';
    if (HAIR_BEARD_PRO_IDS.has(proId)) return 'hair_beard';
    if (BEARD_ONLY_PRO_IDS.has(proId)) return 'beard';
  }

  const english = normalizeServiceName(service.serviceName);
  if (english) {
    if (HAIR_ONLY_NAMES.has(english)) return 'hair';
    if (HAIR_BEARD_NAMES.has(english)) return 'hair_beard';
    if (BEARD_ONLY_NAMES.has(english)) return 'beard';
  }

  const arabic = normalizeArabicName(service.serviceNameAr);
  if (arabic) {
    if (HAIR_ONLY_NAMES_AR.has(arabic)) return 'hair';
    if (HAIR_BEARD_NAMES_AR.has(arabic)) return 'hair_beard';
    if (BEARD_ONLY_NAMES_AR.has(arabic)) return 'beard';
  }

  return 'other';
}
