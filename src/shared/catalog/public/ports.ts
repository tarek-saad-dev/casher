import type { ActorContext } from '@/platform/public';

export type CatalogItemKind = 'service' | 'product';

export interface ItemSnapshot {
  catalogItemId: number;
  name: string;
  kind: CatalogItemKind;
  basePrice: number;
  durationMinutes: number | null;
  sourceVersion: string;
}

export interface CatalogPort {
  getItem(actor: ActorContext, catalogItemId: number): Promise<ItemSnapshot | null>;
  listSellable(
    actor: ActorContext,
    filter: { locationId: number; kind?: CatalogItemKind },
  ): Promise<ItemSnapshot[]>;
}
