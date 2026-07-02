/**
 * Salon service search aliases — single maintainable source of synonym groups.
 * Each group maps a concept key to normalized alias terms (Arabic + English).
 */
export const SERVICE_SEARCH_ALIASES = {
  beard: [
    'دقن',
    'لحية',
    'ذقن',
    'beard',
    'beard styling',
  ],
  haircut: [
    'حلاقة',
    'حلاقة شعر',
    'حلاقه',
    'حلاقه شعر',
    'قص شعر',
    'شعر',
    'haircut',
    'hair cut',
    'هير كت',
    'هيركت',
  ],
  fade: [
    'فيد',
    'تدريج',
    'fade',
    'fade cut',
  ],
  skincare: [
    'بشرة',
    'بشره',
    'تنظيف بشرة',
    'تنظيف بشره',
    'تنضيف بشرة',
    'تنضيف بشره',
    'skincare',
    'skin care',
    'skin',
    'سكين كير',
    'سكين',
  ],
  mask: [
    'ماسك',
    'ماسك وجه',
    'face mask',
    'mask',
  ],
  wax: [
    'واكس',
    'شمع',
    'wax',
  ],
  hairColor: [
    'صبغة',
    'صبغ',
    'صبغ شعر',
    'لون شعر',
    'hair color',
    'haircolor',
    'color',
  ],
} as const satisfies Record<string, readonly string[]>;

export type ServiceSearchConcept = keyof typeof SERVICE_SEARCH_ALIASES;

export const SERVICE_SEARCH_ALIAS_GROUPS: ReadonlyArray<{
  concept: ServiceSearchConcept;
  terms: readonly string[];
}> = Object.entries(SERVICE_SEARCH_ALIASES).map(([concept, terms]) => ({
  concept: concept as ServiceSearchConcept,
  terms,
}));
