/**
 * Boundary fixture: a shared domain must not import another shared domain.
 * Not imported by production code. Scanned only by the boundary test.
 */
import type { CatalogPort } from '@/shared/catalog/public';

export const CROSS_DOMAIN_FIXTURE: CatalogPort | null = null;
