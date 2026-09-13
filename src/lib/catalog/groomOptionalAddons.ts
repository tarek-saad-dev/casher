/**
 * Groom optional add-ons + home-visit grouping.
 *
 * Grouping uses existing schema only:
 * - dedicated TblCat names for new SKUs
 * - confirmed ProIDs for reused catalog services (14, 1077)
 * - TblServicePackageItem.IsOptional for package links
 *
 * No migration / no frontend name matching required.
 */
export const GROOM_ADDONS_CATEGORY_NAME = 'Groom Add-ons';
export const GROOM_HOME_VISIT_CATEGORY_NAME = 'Groom Home Visit';

/** Confirmed existing catalog services reused as groom add-ons. */
export const FIXED_GROOM_ADDON_PRO_IDS = {
  FOOT_PEDICURE: 14,
  MEDIUM_HAIR_PROTEIN: 1077,
} as const;

export type GroomOptionalGroup = 'groom_addons' | 'home_visit';

export const GROOM_OPTIONAL_GROUP_META: Record<
  GroomOptionalGroup,
  {
    key: GroomOptionalGroup;
    labelEn: string;
    labelAr: string;
    multiSelect: boolean;
    mutuallyExclusive: boolean;
  }
> = {
  groom_addons: {
    key: 'groom_addons',
    labelEn: 'Optional Groom Add-ons',
    labelAr: 'إضافات العريس الاختيارية',
    multiSelect: true,
    mutuallyExclusive: false,
  },
  home_visit: {
    key: 'home_visit',
    labelEn: 'Groom Home Visit',
    labelAr: 'زيارة تجهيز العريس',
    multiSelect: false,
    mutuallyExclusive: true,
  },
};

function normalizeCatName(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0640]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/[ة]/g, 'ه')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isGroomAddonsCategory(catName: string | null | undefined): boolean {
  return normalizeCatName(catName) === normalizeCatName(GROOM_ADDONS_CATEGORY_NAME);
}

export function isGroomHomeVisitCategory(catName: string | null | undefined): boolean {
  return normalizeCatName(catName) === normalizeCatName(GROOM_HOME_VISIT_CATEGORY_NAME);
}

export function isFixedGroomAddonProId(proId: number): boolean {
  return (
    proId === FIXED_GROOM_ADDON_PRO_IDS.FOOT_PEDICURE ||
    proId === FIXED_GROOM_ADDON_PRO_IDS.MEDIUM_HAIR_PROTEIN
  );
}

/** Resolve optional group from ProID + category (backend metadata, not UI name matching). */
export function resolveGroomOptionalGroup(input: {
  proId: number;
  catName?: string | null;
}): GroomOptionalGroup | null {
  if (isGroomHomeVisitCategory(input.catName)) return 'home_visit';
  if (isGroomAddonsCategory(input.catName)) return 'groom_addons';
  if (isFixedGroomAddonProId(input.proId)) return 'groom_addons';
  return null;
}

/** True when the ProID set contains more than one home-visit tier. */
export function hasConflictingHomeVisitProIds(
  proIds: number[],
  homeVisitProIds: Iterable<number>,
): boolean {
  const home = new Set(homeVisitProIds);
  let count = 0;
  for (const id of proIds) {
    if (home.has(id)) count += 1;
    if (count > 1) return true;
  }
  return false;
}

/**
 * When adding a home-visit ProID, drop any other home-visit lines from the cart.
 * Non-home-visit carts are returned unchanged.
 */
export function applyHomeVisitExclusivity<T extends { ProID: number }>(
  items: T[],
  incomingProId: number,
  homeVisitProIds: Iterable<number>,
): T[] {
  const home = new Set(homeVisitProIds);
  if (!home.has(incomingProId)) return items;
  return items.filter((item) => !home.has(item.ProID) || item.ProID === incomingProId);
}
