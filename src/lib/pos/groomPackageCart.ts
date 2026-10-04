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

/** Package catalog data used only to present a package on receipts. */
export type PackageReceiptDisplay = {
  nameAr: string;
  originalPrice: number | null;
  /** Required (non-optional) items in package order with current list prices. */
  items: Array<{ proId: number; label: string; listPrice: number }>;
};

export type PackagePrintLine = {
  label: string;
  sublabel?: string;
  /** Net invoice amount (sums to the invoice total). */
  amount: number;
  /** Amount to print when it differs from `amount`; null prints no price. */
  shownAmount?: number | null;
  variant?: 'package_header' | 'package_item';
  empName?: string | null;
  hide?: boolean;
};

type PrintableInvoiceItem = {
  ProID: number;
  ProName: string;
  SPrice: number;
  SPriceAfterDis?: number | null;
  SValue?: number | null;
  Qty?: number;
  DisVal?: number;
  EmpName?: string | null;
};

type PrintPackageMeta = {
  packageId: number;
  packagePrice: number;
  requiredServiceIds: number[];
  addonProIds: number[];
  packageName?: string;
  display?: PackageReceiptDisplay | null;
};

/**
 * Itemized package pricing for receipts: list prices per included service,
 * total before discount = OriginalPrice, discount = OriginalPrice - PackagePrice.
 * Only when OriginalPrice > PackagePrice and the list prices add up to it, so the
 * printed math always matches; otherwise the package prints as one priced line.
 */
export function resolvePackageReceiptPricing(
  display: PackageReceiptDisplay | null | undefined,
  packagePrice: number,
  requiredServiceIds: number[],
): { items: PackageReceiptDisplay['items']; originalTotal: number; discount: number } | null {
  if (!display || display.originalPrice == null || !(packagePrice > 0)) return null;
  const originalTotal = Number(display.originalPrice);
  if (!(originalTotal > packagePrice)) return null;
  const required = new Set(requiredServiceIds);
  const items = display.items.filter((it) => required.has(it.proId));
  if (items.length !== required.size) return null;
  const listSum = items.reduce((s, it) => s + it.listPrice, 0);
  if (Math.abs(listSum - originalTotal) > 0.005) return null;
  return { items, originalTotal, discount: originalTotal - packagePrice };
}

/** Receipt / print rows: package once + addons; hide zero-price included lines. */
export function buildPackageAwarePrintLines<T extends PrintableInvoiceItem>(
  items: T[],
  packageMeta: PrintPackageMeta | null,
): PackagePrintLine[] {
  return buildPackageReceipt(items, packageMeta).lines;
}

/** Receipt rows plus the package discount to print in the totals box. */
export function buildPackageReceipt<T extends PrintableInvoiceItem>(
  items: T[],
  packageMeta: PrintPackageMeta | null,
): { lines: PackagePrintLine[]; packageDiscount: number } {
  if (!packageMeta || !packageMeta.requiredServiceIds.length) {
    return { lines: buildPlainPrintLines(items, packageMeta), packageDiscount: 0 };
  }
  const display = packageMeta.display;
  if (!display) {
    return { lines: buildPlainPrintLines(items, packageMeta), packageDiscount: 0 };
  }

  const pricing = resolvePackageReceiptPricing(
    display,
    packageMeta.packagePrice,
    packageMeta.requiredServiceIds,
  );
  const required = new Set(packageMeta.requiredServiceIds);
  const addons = new Set(packageMeta.addonProIds);
  const netOf = (item: T) =>
    item.SPriceAfterDis != null && Number.isFinite(Number(item.SPriceAfterDis))
      ? Number(item.SPriceAfterDis)
      : Number(item.SPrice) * (Number(item.Qty) > 0 ? Number(item.Qty) : 1);

  const anchor = items.find((it) => required.has(it.ProID) && netOf(it) > 0);
  const includedRows: PackagePrintLine[] = pricing
    ? pricing.items.map((it) => ({
        label: it.label,
        amount: 0,
        shownAmount: it.listPrice,
        variant: 'package_item' as const,
      }))
    : packageMeta.requiredServiceIds.map((id) => {
        const fromCatalog = display.items.find((it) => it.proId === id);
        const fromInvoice = items.find((it) => it.ProID === id);
        return {
          label: fromCatalog?.label ?? fromInvoice?.ProName ?? `#${id}`,
          amount: 0,
          shownAmount: null,
          variant: 'package_item' as const,
        };
      });

  const lines: PackagePrintLine[] = [
    {
      label: display.nameAr || packageMeta.packageName || 'Package',
      amount: packageMeta.packagePrice > 0 ? packageMeta.packagePrice : anchor ? netOf(anchor) : 0,
      shownAmount: pricing ? null : undefined,
      variant: 'package_header',
      empName: anchor?.EmpName,
    },
    ...includedRows,
  ];

  for (const item of items) {
    if (required.has(item.ProID)) continue;
    const net = netOf(item);
    if (addons.has(item.ProID) || net > 0) {
      lines.push({ label: item.ProName, amount: net, empName: item.EmpName });
    }
  }

  return { lines, packageDiscount: pricing?.discount ?? 0 };
}

function buildPlainPrintLines<T extends PrintableInvoiceItem>(
  items: T[],
  packageMeta: PrintPackageMeta | null,
): PackagePrintLine[] {
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
      label: packageMeta.packageName || 'Package',
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
