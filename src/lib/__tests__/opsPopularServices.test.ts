/**
 * Phase B — Ops popular service resolution + Arabic-safe main classification.
 */
import { describe, expect, it } from 'vitest';
import {
  getOpsPopularSlotDefs,
  isOpsMainService,
  isOpsMainServiceName,
  normalizeOpsServiceName,
  resolveOpsPopularServices,
  resolveOpsPopularSlot,
  type OpsCatalogService,
} from '@/lib/operations/opsPopularServices';

const catalog: OpsCatalogService[] = [
  { ProID: 9, ProName: 'حلاقة شعر', ProNameEn: 'Hair Cut', SPrice: 200, DurationMinutes: 30, CatName: 'قص الشعر', CatID: '19' },
  { ProID: 20, ProName: 'شعر ودقن', ProNameEn: 'Hair & Beard', SPrice: 250, DurationMinutes: 45, CatName: 'خدمات اللحية', CatID: '20' },
  { ProID: 10, ProName: 'دقن', ProNameEn: 'Beard', SPrice: 100, DurationMinutes: 20, CatName: 'خدمات اللحية', CatID: '20' },
  { ProID: 18, ProName: 'صبغة شعر ودقن', ProNameEn: 'Hair & Beard Color', SPrice: 200, DurationMinutes: 20, CatName: 'صبغات', CatID: '17' },
  { ProID: 11, ProName: 'تنظيف بشرة عادي', ProNameEn: 'Basic Skin Care', SPrice: 200, DurationMinutes: 20, CatName: 'عناية البشرة', CatID: '9' },
  { ProID: 99, ProName: 'خدمة بلا سعر', SPrice: 0, DurationMinutes: 10, CatName: 'أخرى' },
];

describe('opsPopularServices', () => {
  it('Case 1 — Arabic Hair resolves into الأكثر طلبًا', () => {
    const popular = resolveOpsPopularServices(catalog);
    const hair = popular.find((p) => p.key === 'hair');
    expect(hair?.service.ProID).toBe(9);
    expect(hair?.service.ProName).toBe('حلاقة شعر');
  });

  it('Case 2 — Hair + Beard resolves correctly', () => {
    const popular = resolveOpsPopularServices(catalog);
    const combo = popular.find((p) => p.key === 'hair_beard');
    expect(combo?.service.ProID).toBe(20);
    expect(combo?.service.ProName).toBe('شعر ودقن');
  });

  it('Case 3 — English-only catalog still resolves via EN aliases', () => {
    const enOnly: OpsCatalogService[] = [
      { ProID: 901, ProName: 'Hair Cut', SPrice: 200, DurationMinutes: 30 },
      { ProID: 902, ProName: 'Hair & Beard', SPrice: 250, DurationMinutes: 45 },
    ];
    const popular = resolveOpsPopularServices(enOnly);
    expect(popular.map((p) => p.key)).toEqual(['hair', 'hair_beard']);
    expect(popular[0]!.service.ProID).toBe(901);
    expect(popular[1]!.service.ProID).toBe(902);
  });

  it('Case 4 — missing configured ID falls back to alias; missing entirely is omitted', () => {
    const withoutIds: OpsCatalogService[] = [
      { ProID: 501, ProName: 'حلاقة شعر', SPrice: 200, DurationMinutes: 30 },
      { ProID: 502, ProName: 'تنظيف بشرة عادي', SPrice: 200, DurationMinutes: 20 },
    ];
    const popular = resolveOpsPopularServices(withoutIds);
    expect(popular.some((p) => p.key === 'hair')).toBe(true);
    expect(popular.some((p) => p.key === 'hair_beard')).toBe(false);
    expect(popular.some((p) => p.key === 'beard')).toBe(false);
  });

  it('Case 5 — no false match for similarly named color service', () => {
    const colorOnly: OpsCatalogService[] = [
      { ProID: 18, ProName: 'صبغة شعر ودقن', ProNameEn: 'Hair & Beard Color', SPrice: 200, DurationMinutes: 20 },
    ];
    const defs = getOpsPopularSlotDefs();
    const hairBeard = defs.find((d) => d.key === 'hair_beard')!;
    expect(resolveOpsPopularSlot(colorOnly, hairBeard)).toBeNull();
    expect(resolveOpsPopularServices(colorOnly)).toEqual([]);
  });

  it('preferred ID wins over alias when both exist', () => {
    const mixed: OpsCatalogService[] = [
      { ProID: 9, ProName: 'خدمة أخرى باسم خاطئ', SPrice: 1, DurationMinutes: 10 },
      { ProID: 777, ProName: 'حلاقة شعر', SPrice: 200, DurationMinutes: 30 },
    ];
    const hair = getOpsPopularSlotDefs().find((d) => d.key === 'hair')!;
    // Preferred ID 9 is present — even if name is wrong, ID wins (ops config authority).
    expect(resolveOpsPopularSlot(mixed, hair)?.ProID).toBe(9);
  });

  it('zero-price services are ignored', () => {
    const popular = resolveOpsPopularServices([
      { ProID: 9, ProName: 'حلاقة شعر', SPrice: 0, DurationMinutes: 30 },
    ]);
    expect(popular).toEqual([]);
  });

  it('normalize treats شعر و دقن as شعر ودقن', () => {
    expect(normalizeOpsServiceName('شعر و دقن')).toBe(normalizeOpsServiceName('شعر ودقن'));
  });

  it('isOpsMainService recognizes AR and EN mains; addons stay false', () => {
    expect(isOpsMainServiceName('حلاقة شعر')).toBe(true);
    expect(isOpsMainServiceName('شعر ودقن')).toBe(true);
    expect(isOpsMainServiceName('Hair Cut')).toBe(true);
    expect(isOpsMainService({ ProID: 11, ProName: 'تنظيف بشرة عادي' })).toBe(false);
    expect(isOpsMainService({ ProID: 18, ProName: 'صبغة شعر ودقن' })).toBe(false);
  });
});
