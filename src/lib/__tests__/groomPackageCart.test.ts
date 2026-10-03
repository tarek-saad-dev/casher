/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  buildPackageCartItems,
  buildPackageAwarePrintLines,
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
});
