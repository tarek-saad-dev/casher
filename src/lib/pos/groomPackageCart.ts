/**
 * Client-safe groom package cart helpers for POS.
 * Pricing/validation stay on the server (resolveGroomPackageBooking).
 */

import type { Barber, CartItem, GroomPackageCartMeta } from '@/lib/types';

export type ResolvedPackageLine = {
  serviceId: number;
  nameEn: string;
  nameAr: string;
  price: number;
  durationMinutes: number;
};

export type ResolvedPackageForCart = {
  packageId: number;
  nameEn: string;
  nameAr: string;
  packagePrice: number;
  packageDurationMinutes: number;
  totalDurationMinutes: number;
  requiredServiceIds: number[];
  addonProIds: number[];
  services: ResolvedPackageLine[];
  metadataNote?: string;
};

export type CartDisplayRow =
  | {
      kind: 'package';
      groupKey: string;
      packageId: number;
      packageName: string;
      packageNameAr?: string;
      includedCount: number;
      price: number;
      anchor: CartItem;
      included: CartItem[];
      addons: CartItem[];
      allIds: string[];
    }
  | {
      kind: 'standalone';
      item: CartItem;
    };

export function newPackageGroupKey(packageId: number): string {
  return `groom-pkg-${packageId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Expand a server-resolved package into cart lines (same pricing as booking). */
export function buildPackageCartItems(args: {
  resolved: ResolvedPackageForCart;
  barber: Barber;
  groupKey?: string;
  counter?: number;
}): CartItem[] {
  const groupKey = args.groupKey ?? newPackageGroupKey(args.resolved.packageId);
  const counter = args.counter ?? Date.now();
  const requiredSet = new Set(args.resolved.requiredServiceIds);
  const includedCount = args.resolved.requiredServiceIds.length;
  const items: CartItem[] = [];

  args.resolved.services.forEach((line, idx) => {
    const isRequired = requiredSet.has(line.serviceId);
    const isAnchor = isRequired && line.price > 0;
    const role: GroomPackageCartMeta['role'] = !isRequired
      ? 'addon'
      : isAnchor
        ? 'anchor'
        : 'included';

    const displayName =
      role === 'anchor'
        ? args.resolved.nameAr || args.resolved.nameEn
        : line.nameAr || line.nameEn;

    const meta: GroomPackageCartMeta = {
      packageId: args.resolved.packageId,
      packageName: args.resolved.nameEn,
      packageNameAr: args.resolved.nameAr,
      role,
      groupKey,
      includedCount,
      packageDurationMinutes: args.resolved.packageDurationMinutes,
      totalDurationMinutes: args.resolved.totalDurationMinutes,
      metadataNote: args.resolved.metadataNote,
    };

    items.push({
      id: `pkg-${args.resolved.packageId}-${line.serviceId}-${args.barber.EmpID}-${counter + idx}`,
      ProID: line.serviceId,
      ProName: displayName,
      EmpID: args.barber.EmpID,
      EmpName: args.barber.EmpName,
      SPrice: line.price,
      Bonus: 0,
      Qty: 1,
      Dis: 0,
      DisVal: 0,
      SPriceAfterDis: line.price,
      packageMeta: meta,
    });
  });

  return items;
}

/** Standalone cart lines whose ProID is a required package include. */
export function findOverlappingRequiredCartItems(
  cart: CartItem[],
  requiredServiceIds: number[],
): CartItem[] {
  const required = new Set(requiredServiceIds);
  return cart.filter(
    (item) => !item.packageMeta && required.has(item.ProID),
  );
}

/**
 * Optional services already in the cart that are valid package addons —
 * reuse as selected addons instead of duplicating.
 */
export function findReusableAddonProIds(
  cart: CartItem[],
  optionalServiceIds: number[],
): number[] {
  const optional = new Set(optionalServiceIds);
  const found: number[] = [];
  for (const item of cart) {
    if (item.packageMeta) continue;
    if (!optional.has(item.ProID)) continue;
    if (!found.includes(item.ProID)) found.push(item.ProID);
  }
  return found;
}

export function removeCartItemsByProIds(
  cart: CartItem[],
  proIds: number[],
): CartItem[] {
  const drop = new Set(proIds);
  return cart.filter((item) => !drop.has(item.ProID) || !!item.packageMeta);
}

export function removePackageGroup(
  cart: CartItem[],
  groupKey: string,
): CartItem[] {
  return cart.filter((item) => item.packageMeta?.groupKey !== groupKey);
}

/** Group cart for cashier display: one commercial package unit + extras. */
export function groupCartForDisplay(items: CartItem[]): CartDisplayRow[] {
  const rows: CartDisplayRow[] = [];
  const seenGroups = new Set<string>();

  for (const item of items) {
    const meta = item.packageMeta;
    if (!meta) {
      rows.push({ kind: 'standalone', item });
      continue;
    }
    if (seenGroups.has(meta.groupKey)) continue;
    seenGroups.add(meta.groupKey);

    const groupItems = items.filter((i) => i.packageMeta?.groupKey === meta.groupKey);
    const anchor =
      groupItems.find((i) => i.packageMeta?.role === 'anchor') ?? groupItems[0]!;
    const included = groupItems.filter((i) => i.packageMeta?.role === 'included');
    const addons = groupItems.filter((i) => i.packageMeta?.role === 'addon');

    rows.push({
      kind: 'package',
      groupKey: meta.groupKey,
      packageId: meta.packageId,
      packageName: meta.packageName,
      packageNameAr: meta.packageNameAr,
      includedCount: meta.includedCount,
      price: anchor.SPriceAfterDis,
      anchor,
      included,
      addons,
      allIds: groupItems.map((i) => i.id),
    });
  }

  return rows;
}

/** Receipt / print rows: package once + addons; hide zero-price included lines. */
export function buildPackageAwarePrintLines<T extends {
  ProID: number;
  ProName: string;
  SPrice: number;
  SPriceAfterDis?: number | null;
  SValue?: number | null;
  Qty?: number;
  DisVal?: number;
  EmpName?: string | null;
}>(
  items: T[],
  packageMeta: {
    packageId: number;
    packagePrice: number;
    requiredServiceIds: number[];
    addonProIds: number[];
    packageName?: string;
  } | null,
): Array<{
  label: string;
  sublabel?: string;
  amount: number;
  empName?: string | null;
  hide?: boolean;
}> {
  if (!packageMeta || !packageMeta.requiredServiceIds.length) {
    return items.map((item) => ({
      label: item.ProName,
      amount:
        item.SPriceAfterDis != null && Number.isFinite(Number(item.SPriceAfterDis))
          ? Number(item.SPriceAfterDis)
          : Number(item.SPrice) * (Number(item.Qty) > 0 ? Number(item.Qty) : 1),
      empName: item.EmpName,
    }));
  }

  const required = new Set(packageMeta.requiredServiceIds);
  const addons = new Set(packageMeta.addonProIds);
  const lines: Array<{
    label: string;
    sublabel?: string;
    amount: number;
    empName?: string | null;
  }> = [];

  let packageShown = false;
  for (const item of items) {
    const net =
      item.SPriceAfterDis != null && Number.isFinite(Number(item.SPriceAfterDis))
        ? Number(item.SPriceAfterDis)
        : Number(item.SPrice) * (Number(item.Qty) > 0 ? Number(item.Qty) : 1);

    if (required.has(item.ProID)) {
      if (!packageShown && net > 0) {
        packageShown = true;
        lines.push({
          label: packageMeta.packageName || item.ProName,
          sublabel: `Includes ${packageMeta.requiredServiceIds.length} services`,
          amount: packageMeta.packagePrice > 0 ? packageMeta.packagePrice : net,
          empName: item.EmpName,
        });
      }
      continue;
    }

    if (addons.has(item.ProID) || net > 0) {
      lines.push({
        label: item.ProName,
        amount: net,
        empName: item.EmpName,
      });
    }
  }

  if (!packageShown) {
    lines.unshift({
      label: packageMeta.packageName || 'Groom Package',
      sublabel: `Includes ${packageMeta.requiredServiceIds.length} services`,
      amount: packageMeta.packagePrice,
    });
  }

  return lines;
}

export function extractGroomPackageNoteFromText(
  notes: string | null | undefined,
): string | null {
  if (!notes) return null;
  const m = notes.match(/\[groomPackage\][^\n\r]*/);
  return m ? m[0] : null;
}
