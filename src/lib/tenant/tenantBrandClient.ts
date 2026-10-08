import { useMemo, useSyncExternalStore } from 'react';
import {
  toPrintBrand,
  toPrintBrandHtml,
  type PrintBrand,
  type TenantBrandProfile,
} from '@/platform/branding/brandProfile';

/**
 * Current tenant brand for client-side print builders (receipts, tickets, exported PDFs) that run
 * outside React. Set by TenantShellProvider from /api/tenant/context; null until loaded.
 */
let currentBrand: TenantBrandProfile | null = null;
const listeners = new Set<() => void>();

export function setClientTenantBrand(brand: TenantBrandProfile | null): void {
  currentBrand = brand;
  listeners.forEach((l) => l());
}

export function getClientTenantBrand(): TenantBrandProfile | null {
  return currentBrand;
}

export function subscribeClientTenantBrand(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPrintBrand(): PrintBrand {
  return toPrintBrand(currentBrand);
}

export function getPrintBrandHtml(): PrintBrand {
  return toPrintBrandHtml(currentBrand);
}

/** React view of the current print brand (re-renders when the tenant brand loads / changes). */
export function usePrintBrand(): PrintBrand {
  const brand = useSyncExternalStore(subscribeClientTenantBrand, getClientTenantBrand, () => null);
  return useMemo(() => toPrintBrand(brand), [brand]);
}
