/** Browser-accessible service image paths under public/services/ */
export const SERVICE_IMAGE_PATHS = [
  '/services/haircut.jpg',
  '/services/hb.jpeg',
  '/services/beard.jpeg',
  '/services/fade.jpeg',
  '/services/advanced.jpeg',
  '/services/thread.jpeg',
  '/services/shaver.jpeg',
  '/services/basic.jpeg',
] as const;

export type ServiceImagePath = (typeof SERVICE_IMAGE_PATHS)[number];

/** Preset images for quick selection in admin UI */
export const SERVICE_IMAGE_PRESETS: { path: ServiceImagePath; label: string }[] = [
  { path: '/services/haircut.jpg', label: 'حلاقة شعر' },
  { path: '/services/hb.jpeg', label: 'شعر ودقن' },
  { path: '/services/beard.jpeg', label: 'تدريج وتحديد الدقن' },
  { path: '/services/fade.jpeg', label: 'حلاقة فيد' },
  { path: '/services/advanced.jpeg', label: 'قصة احترافية' },
  { path: '/services/thread.jpeg', label: 'فتلة وش' },
  { path: '/services/shaver.jpeg', label: 'دقن زيرو' },
  { path: '/services/basic.jpeg', label: 'تنظيف بشرة عادي' },
];

/** Default ImageUrl mapping by ProName (English service name in TblPro) */
export const SERVICE_IMAGE_BY_PRO_NAME: Record<string, ServiceImagePath> = {
  'Hair Cut': '/services/haircut.jpg',
  'Haircut & Beard': '/services/hb.jpeg',
  'Beard Styling & Fade': '/services/beard.jpeg',
  'Fade Cut': '/services/fade.jpeg',
  'Advanced Cut': '/services/advanced.jpeg',
  'Face Threading': '/services/thread.jpeg',
  'Zero Beard Shave': '/services/shaver.jpeg',
  'Basic Skin Care': '/services/basic.jpeg',
};
