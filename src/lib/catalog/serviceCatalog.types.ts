/** Catalog API — services nested under categories (bilingual). */

export type ServiceCatalogTypeFilter = 'serv' | 'pro' | 'all';

export interface ServiceCatalogQuery {
  /** Default true — soft-deleted services excluded */
  activeOnly?: boolean;
  /** Default 'serv' — salon services only (excludes product categories) */
  type?: ServiceCatalogTypeFilter;
  /** Filter to one category */
  categoryId?: number | null;
  /** Match nameEn / nameAr (case-insensitive contains) */
  search?: string | null;
  /** Default false — omit categories with zero matching services */
  includeEmpty?: boolean;
}

export interface ServiceCatalogItem {
  id: number;
  nameEn: string;
  nameAr: string | null;
  price: number;
  bonus: number;
  durationMinutes: number | null;
  imageUrl: string | null;
  isActive: boolean;
  salesCount: number;
  categoryId: number | null;
}

export interface ServiceCatalogCategory {
  id: number | null;
  name: string;
  type: string | null;
  serviceCount: number;
  services: ServiceCatalogItem[];
}

export interface ServiceCatalogMeta {
  categoryCount: number;
  serviceCount: number;
  filters: {
    activeOnly: boolean;
    type: ServiceCatalogTypeFilter;
    categoryId: number | null;
    search: string | null;
    includeEmpty: boolean;
  };
  generatedAt: string;
}

export interface ServiceCatalogResponse {
  ok: true;
  meta: ServiceCatalogMeta;
  categories: ServiceCatalogCategory[];
}

/** Raw row from SQL join before grouping */
export interface ServiceCatalogRow {
  ProID: number;
  ProName: string;
  ProNameAr: string | null;
  SPrice1: number;
  Bonus: number;
  DurationMinutes: number | null;
  ImageUrl: string | null;
  isDeleted: boolean | number | null;
  SalesCount: number;
  CatID: number | null;
  CatName: string | null;
  CatType: string | null;
}
