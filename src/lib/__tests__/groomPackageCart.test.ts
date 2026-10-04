/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  buildPackageCartItems,
  buildPackageAwarePrintLines,
  buildPackageReceipt,
  findOverlappingRequiredCartItems,
  findReusableAddonProIds,
  groupCartForDisplay,
} from '@/lib/pos/groomPackageCart';
import { computeInvoiceItemsTotals } from '@/lib/sales/service-line-totals';
import type { CartItem } from '@/lib/types';

const barber = { EmpID: 7, EmpName: 'Test Barber' } as const;

function resolvedSignature(addons: number[] = []) {
  const required = [1049, 10, 22, 32, 1080, 1081, 1082, 12];
  const services = [
    ...required.map((id, idx) => ({
      serviceId: id,
      nameEn: `Svc ${id}`,
      nameAr: `خدمة ${id}`,
      price: idx === 0 ? 1500 : 0,
      durationMinutes: 10,
    })),
    ...addons.map((id) => ({
      serviceId: id,
      nameEn: `Addon ${id}`,
      nameAr: `إضافة ${id}`,
      price: id === 1086 ? 500 : id === 1083 ? 150 : 200,
      durationMinutes: id === 1086 ? 90 : 0,
    })),
  ];
  return {
    packageId: 2,
    nameEn: 'Signature Groom',
    nameAr: 'سيجنتشر',
    packagePrice: 1500,
    packageDurationMinutes: 110,
    totalDurationMinutes: 110 + (addons.includes(1086) ? 90 : 0),
    requiredServiceIds: required,
    addonProIds: addons,
    services,
    metadataNote:
      `[groomPackage] packageId=2;packagePrice=1500;addons=${addons.join(',') || '-'};` +
      `required=${required.join(',')};total=${1500 + (addons.includes(1086) ? 500 : 0) + (addons.includes(1083) ? 150 : 0)}`,
  };
}

describe('regular package (October) in POS cart', () => {
  const resolvedOctober = {
    packageId: 7,
    nameEn: 'October Package',
    nameAr: 'باكدج أكتوبر',
    packagePrice: 333,
    packageDurationMinutes: 85,
    totalDurationMinutes: 85,
    requiredServiceIds: [9, 10, 22, 29],
    addonProIds: [],
    services: [9, 10, 22, 29].map((id, idx) => ({
      serviceId: id,
      nameEn: `Svc ${id}`,
      nameAr: `خدمة ${id}`,
      price: idx === 0 ? 333 : 0,
      durationMinutes: 10,
    })),
    metadataNote: '[groomPackage] packageId=7;packagePrice=333;addons=-;required=9,10,22,29;total=333',
  };

  it('invoice grand total is the package price with one line per included service', () => {
    const items = buildPackageCartItems({ resolved: resolvedOctober, barber: barber as never });
    expect(items.map((i) => i.ProID)).toEqual([9, 10, 22, 29]);
    expect(items.map((i) => i.SPrice)).toEqual([333, 0, 0, 0]);
    expect(items.every((i) => i.Bonus === 0 && i.EmpID === barber.EmpID)).toBe(true);
    const totals = computeInvoiceItemsTotals(
      items.map((i) => ({ sPrice: i.SPrice, qty: i.Qty, discountValue: i.DisVal, bonus: i.Bonus })),
    );
    expect(totals.grandTotal).toBe(333);
    expect(totals.totalBonus).toBe(0);
  });

  it('cart and receipt show the package once at 333', () => {
    const items = buildPackageCartItems({ resolved: resolvedOctober, barber: barber as never });
    const rows = groupCartForDisplay(items);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'package', price: 333, includedCount: 4 });
    const lines = buildPackageAwarePrintLines(items, {
      packageId: 7,
      packagePrice: 333,
      requiredServiceIds: [9, 10, 22, 29],
      addonProIds: [],
      packageName: 'باكدج أكتوبر',
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ label: 'باكدج أكتوبر', amount: 333 });
  });

  const octoberDisplay = {
    nameAr: 'باكدج أكتوبر',
    originalPrice: 720,
    items: [
      { proId: 9, label: 'Hair Cut', listPrice: 200 },
      { proId: 10, label: 'Beard Styling & Fade', listPrice: 100 },
      { proId: 22, label: 'Hair Oil Treatment', listPrice: 120 },
      { proId: 29, label: 'Classic Skin Care', listPrice: 300 },
    ],
  };
  const octoberMeta = {
    packageId: 7,
    packagePrice: 333,
    requiredServiceIds: [9, 10, 22, 29],
    addonProIds: [],
  };

  it('receipt itemizes list prices and prints discount = OriginalPrice - PackagePrice', () => {
    const items = buildPackageCartItems({ resolved: resolvedOctober, barber: barber as never });
    const { lines, packageDiscount } = buildPackageReceipt(items, {
      ...octoberMeta,
      display: octoberDisplay,
    });
    expect(packageDiscount).toBe(387);
    expect(lines.map((l) => [l.label, l.variant, l.shownAmount])).toEqual([
      ['باكدج أكتوبر', 'package_header', null],
      ['Hair Cut', 'package_item', 200],
      ['Beard Styling & Fade', 'package_item', 100],
      ['Hair Oil Treatment', 'package_item', 120],
      ['Classic Skin Care', 'package_item', 300],
    ]);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(333);
    expect(lines[0].empName).toBe(barber.EmpName);
  });

  it('receipt keeps extra non-package lines priced and in the total', () => {
    const items = [
      ...buildPackageCartItems({ resolved: resolvedOctober, barber: barber as never }),
      { ProID: 50, ProName: 'Extra', SPrice: 80, SPriceAfterDis: 80, EmpName: 'B' },
    ];
    const { lines, packageDiscount } = buildPackageReceipt(items, {
      ...octoberMeta,
      display: octoberDisplay,
    });
    expect(packageDiscount).toBe(387);
    expect(lines.at(-1)).toMatchObject({ label: 'Extra', amount: 80 });
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(413);
  });

  it('no discount row when list prices do not add up to OriginalPrice', () => {
    const items = buildPackageCartItems({ resolved: resolvedOctober, barber: barber as never });
    const { lines, packageDiscount } = buildPackageReceipt(items, {
      ...octoberMeta,
      display: {
        ...octoberDisplay,
        items: octoberDisplay.items.map((it) => (it.proId === 9 ? { ...it, listPrice: 250 } : it)),
      },
    });
    expect(packageDiscount).toBe(0);
    expect(lines[0]).toMatchObject({ label: 'باكدج أكتوبر', amount: 333 });
    expect(lines[0].shownAmount).toBeUndefined();
    expect(lines.slice(1).every((l) => l.variant === 'package_item' && l.shownAmount === null)).toBe(true);
  });
});

describe('groomPackageCart', () => {
  it('builds package lines with commercial price on anchor only', () => {
    const items = buildPackageCartItems({
      resolved: resolvedSignature([1086]),
      barber: barber as never,
    });
    expect(items).toHaveLength(9);
    expect(items.filter((i) => i.packageMeta?.role === 'anchor')).toHaveLength(1);
    expect(items.filter((i) => i.packageMeta?.role === 'included')).toHaveLength(7);
    expect(items.filter((i) => i.packageMeta?.role === 'addon')).toHaveLength(1);
    const total = items.reduce((s, i) => s + i.SPriceAfterDis, 0);
    expect(total).toBe(2000);
  });

  it('groups cart display without showing included zero lines', () => {
    const items = buildPackageCartItems({
      resolved: resolvedSignature([1083]),
      barber: barber as never,
    });
    const rows = groupCartForDisplay(items);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('package');
    if (rows[0]?.kind === 'package') {
      expect(rows[0].price).toBe(1500);
      expect(rows[0].addons).toHaveLength(1);
      expect(rows[0].included).toHaveLength(7);
    }
  });

  it('detects overlapping standalone required services', () => {
    const cart: CartItem[] = [
      {
        id: '1',
        ProID: 1049,
        ProName: 'Advanced Cut',
        EmpID: 7,
        EmpName: 'B',
        SPrice: 250,
        Bonus: 0,
        Qty: 1,
        Dis: 0,
        DisVal: 0,
        SPriceAfterDis: 250,
      },
    ];
    const overlaps = findOverlappingRequiredCartItems(cart, [1049, 10]);
    expect(overlaps).toHaveLength(1);
  });

  it('reuses standalone optionals as package addons', () => {
    const cart: CartItem[] = [
      {
        id: '1',
        ProID: 1083,
        ProName: 'Color',
        EmpID: 7,
        EmpName: 'B',
        SPrice: 150,
        Bonus: 0,
        Qty: 1,
        Dis: 0,
        DisVal: 0,
        SPriceAfterDis: 150,
      },
    ];
    expect(findReusableAddonProIds(cart, [1083, 1084])).toEqual([1083]);
  });

  it('print lines hide zero-priced includes', () => {
    const items = buildPackageCartItems({
      resolved: resolvedSignature([1086]),
      barber: barber as never,
    });
    const lines = buildPackageAwarePrintLines(
      items.map((i) => ({
        ProID: i.ProID,
        ProName: i.ProName,
        SPrice: i.SPrice,
        SPriceAfterDis: i.SPriceAfterDis,
        EmpName: i.EmpName,
      })),
      {
        packageId: 2,
        packagePrice: 1500,
        requiredServiceIds: [1049, 10, 22, 32, 1080, 1081, 1082, 12],
        addonProIds: [1086],
        packageName: 'Signature Groom',
      },
    );
    expect(lines.map((l) => l.label)).toEqual([
      'Signature Groom',
      'إضافة 1086',
    ]);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(2000);
  });

  it('groom package without OriginalPrice prints one priced line and lists included services', () => {
    const items = buildPackageCartItems({
      resolved: resolvedSignature([1086]),
      barber: barber as never,
    });
    const required = [1049, 10, 22, 32, 1080, 1081, 1082, 12];
    const { lines, packageDiscount } = buildPackageReceipt(items, {
      packageId: 2,
      packagePrice: 1500,
      requiredServiceIds: required,
      addonProIds: [1086],
      display: {
        nameAr: 'باكدج العريس سيجنتشر',
        originalPrice: null,
        items: required.map((id) => ({ proId: id, label: `Svc ${id}`, listPrice: 100 })),
      },
    });
    expect(packageDiscount).toBe(0);
    expect(lines[0]).toMatchObject({ label: 'باكدج العريس سيجنتشر', amount: 1500, variant: 'package_header' });
    expect(lines[0].shownAmount).toBeUndefined();
    expect(lines.filter((l) => l.variant === 'package_item')).toHaveLength(8);
    expect(lines.filter((l) => l.variant === 'package_item').every((l) => l.shownAmount === null)).toBe(true);
    expect(lines.at(-1)).toMatchObject({ label: 'إضافة 1086', amount: 500 });
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(2000);
  });
});
