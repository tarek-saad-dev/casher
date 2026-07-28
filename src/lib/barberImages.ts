/** Browser-accessible barber photo paths under public/ */

export const BARBER_IMAGE_PATHS = [
  '/barber-bassem.jpg',
  '/barber-ziad.jpg',
  '/barber-mohamed.jpg',
  '/barber-kareem.jpg',
  '/barber-yousef.jpg',
] as const;

export type BarberImagePath = (typeof BARBER_IMAGE_PATHS)[number];

/** Preset images for admin / seed selection */
export const BARBER_IMAGE_PRESETS: { path: BarberImagePath; label: string }[] = [
  { path: '/barber-bassem.jpg', label: 'بلسم / باسم' },
  { path: '/barber-ziad.jpg', label: 'زياد' },
  { path: '/barber-mohamed.jpg', label: 'محمد' },
  { path: '/barber-kareem.jpg', label: 'كريم' },
  { path: '/barber-yousef.jpg', label: 'يوسف' },
];

/**
 * Default ImageUrl mapping by EmpName (Arabic spellings used in POS / DB).
 * Only employees with a real photo under public/ are listed.
 */
export const BARBER_IMAGE_BY_EMP_NAME: Record<string, BarberImagePath> = {
  بلسم: '/barber-bassem.jpg',
  بسم: '/barber-bassem.jpg',
  باسم: '/barber-bassem.jpg',
  زيد: '/barber-ziad.jpg',
  زياد: '/barber-ziad.jpg',
  محمد: '/barber-mohamed.jpg',
  كريم: '/barber-kareem.jpg',
  يوسف: '/barber-yousef.jpg',
};

/** Employees that intentionally have no photo (initials placeholder in POS). */
export const BARBER_NO_PHOTO_NAMES = new Set([
  'ذياد',
  'ذياد المساعد',
  'أحمد الصنايعي',
  'أحمد المساعد',
  'عمر',
  'احمد',
  'أحمد',
]);

export function getBarberImagePathByName(
  name: string | null | undefined,
): BarberImagePath | null {
  const key = String(name ?? '').trim();
  if (!key) return null;
  if (BARBER_NO_PHOTO_NAMES.has(key)) return null;
  return BARBER_IMAGE_BY_EMP_NAME[key] ?? null;
}
