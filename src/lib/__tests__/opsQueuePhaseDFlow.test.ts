/**
 * Phase D — Queue UX orchestration / catalog reuse tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fetchOpsQueueServicesFallback,
  mapBootstrapServiceToOpsPicker,
  resolveOpsQueueCatalogDecision,
  servicesFromBootstrapBranch,
} from '@/lib/operations/opsQueueCatalog';
import type { V2PublicBootstrapResponse } from '@/lib/booking/v2Frontend/publicSafeDtos';

const root = process.cwd();
function read(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

function fakeBootstrap(servicesByBranch: Record<string, ReturnType<typeof mapBootstrapServiceToOpsPicker> extends never ? never : Array<{
  serviceId: number;
  nameAr: string;
  nameEn: string;
  name: string;
  price: number;
  durationMinutes: number;
  imageUrl: null;
  photoUrl: null;
  categoryId: string;
  categoryNameAr: string;
  categoryNameEn: string;
  sortOrder: number;
  bookable: true;
}>>): V2PublicBootstrapResponse {
  return {
    ok: true,
    contract: 'booking-v2-frontend' as V2PublicBootstrapResponse['contract'],
    capability: {
      version: 'booking-v2-frontend' as V2PublicBootstrapResponse['capability']['version'],
      supportsMatrix: true,
      supportsLocalSlotGeneration: true,
      overnightTimelineHours: 48,
      availabilityQuantumMinutes: 5,
    },
    revision: 'r1',
    generatedAt: new Date().toISOString(),
    timezone: 'Africa/Cairo',
    branches: [],
    employees: [],
    employeeBranchMappings: [],
    servicesByBranch,
    settingsByBranch: {},
    media: [],
  };
}

describe('Phase D — ops queue catalog', () => {
  it('4 — warm bootstrap avoids /api/services decision', () => {
    const svc = {
      serviceId: 9,
      nameAr: 'حلاقة شعر',
      nameEn: 'Haircut',
      name: 'حلاقة شعر',
      price: 200,
      durationMinutes: 30,
      imageUrl: null,
      photoUrl: null,
      categoryId: '19',
      categoryNameAr: 'قص',
      categoryNameEn: 'Cut',
      sortOrder: 1,
      bookable: true as const,
    };
    const boot = fakeBootstrap({ GLEEM: [svc] });
    const mapped = servicesFromBootstrapBranch(boot, 'GLEEM');
    expect(mapped).toHaveLength(1);
    expect(mapped[0].ProID).toBe(9);
    expect(
      resolveOpsQueueCatalogDecision({
        branchCode: 'GLEEM',
        bootstrap: boot,
        bootstrapStatus: 'ready',
        bootstrapServicesCount: mapped.length,
      }).action,
    ).toBe('use_bootstrap');
  });

  it('4b — bootstrap error/empty falls back to API', () => {
    expect(
      resolveOpsQueueCatalogDecision({
        branchCode: 'GLEEM',
        bootstrap: null,
        bootstrapStatus: 'error',
        bootstrapServicesCount: 0,
      }).action,
    ).toBe('fetch_api');
    expect(
      resolveOpsQueueCatalogDecision({
        branchCode: 'GLEEM',
        bootstrap: fakeBootstrap({}),
        bootstrapStatus: 'ready',
        bootstrapServicesCount: 0,
      }).action,
    ).toBe('fetch_api');
  });

  it('4c — wait while bootstrap pending', () => {
    expect(
      resolveOpsQueueCatalogDecision({
        branchCode: 'GLEEM',
        bootstrap: null,
        bootstrapStatus: 'loading',
        bootstrapServicesCount: 0,
      }).action,
    ).toBe('wait');
  });

  it('fallback fetch hits /api/services once', async () => {
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({
        services: [{ ProID: 9, ProName: 'حلاقة شعر', SPrice: 200, DurationMinutes: 30 }],
      }),
    })) as unknown as typeof fetch;
    const list = await fetchOpsQueueServicesFallback(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/api/services');
    expect(list[0].ProID).toBe(9);
  });
});

describe('Phase D — queue UX orchestration (source)', () => {
  it('1 — locked barber lane: 2 steps, no barber re-pick, plan+create preserved', () => {
    const src = read('src/components/operations/BarberQueueWorkspaceModal.tsx');
    expect(src).toContain("label: 'الخدمات'");
    expect(src).toContain("label: 'التأكيد'");
    expect(src).toContain('useOpsQueueCatalog');
    expect(src).toContain('OpsServicePicker');
    expect(src).toContain('/api/operations/queue/plan-for-barber');
    expect(src).toContain('/api/operations/queue/create');
    expect(src).toContain("customer: { name: 'عميل مباشر' }");
    expect(src).toContain('createPendingRef');
    expect(src).toContain('إضافة للدور');
    expect(src).not.toContain("label: 'الموعد'");
    expect(src).not.toContain("label: 'تأكيد وطباعة'");
    // Barber locked from props — no barber list selection UI
    expect(src).not.toMatch(/barbers\.map/);
  });

  it('2 — general queue: Services → Barber → Confirm', () => {
    const src = read('src/components/operations/SimpleCreateQueueDrawer.tsx');
    expect(src).toContain("label: 'الخدمات'");
    expect(src).toContain("label: 'الحلاق'");
    expect(src).toContain("label: 'التأكيد'");
    expect(src).toContain('OpsServicePicker');
    expect(src).toContain('useOpsQueueCatalog');
    expect(src).toMatch(/step === 1[\s\S]*OpsServicePicker/);
    expect(src).toContain('/api/operations/queue/simulate');
    expect(src).toContain('/api/operations/queue/create');
    expect(src).toContain("source: 'walk_in'");
    expect(src).toContain('عميل مباشر');
    expect(src).toContain('إضافة بيانات العميل');
  });

  it('3 — popular/service picker shared with Booking (no duplicate Phase B logic)', () => {
    const picker = read('src/components/operations/OpsServicePicker.tsx');
    expect(picker).toContain('BookingServiceSelect as OpsServicePicker');
    for (const file of [
      'src/components/operations/BarberQueueWorkspaceModal.tsx',
      'src/components/operations/SimpleCreateQueueDrawer.tsx',
      'src/components/operations/FindNearestQueueDrawer.tsx',
    ]) {
      const src = read(file);
      expect(src).toContain('OpsServicePicker');
      expect(src).not.toContain('PRIMARY_SLOTS');
    }
  });

  it('5 — walk-in default; customer optional on general queue', () => {
    const simple = read('src/components/operations/SimpleCreateQueueDrawer.tsx');
    expect(simple).toContain('عميل مباشر افتراضيًا');
    expect(simple).toContain('showCustomerFields');
    expect(simple).toMatch(/name: customerName\.trim\(\) \|\| \(customerId \? undefined : 'عميل مباشر'\)/);
  });

  it('7/8 — plan/simulate/create endpoints and single-submit guards', () => {
    const lane = read('src/components/operations/BarberQueueWorkspaceModal.tsx');
    const simple = read('src/components/operations/SimpleCreateQueueDrawer.tsx');
    const nearest = read('src/components/operations/FindNearestQueueDrawer.tsx');
    expect(lane).toContain('createPendingRef');
    expect(simple).toContain('createPendingRef');
    expect(nearest).toContain('createPendingRef');
    expect(nearest).toContain('/api/queue/estimate');
    expect(nearest).toContain("method: 'POST'");
    expect(nearest).toContain('/api/queue');
  });

  it('9 — close/reopen resets', () => {
    const lane = read('src/components/operations/BarberQueueWorkspaceModal.tsx');
    const simple = read('src/components/operations/SimpleCreateQueueDrawer.tsx');
    expect(lane).toContain('reset');
    expect(lane).toMatch(/if \(!open\)[\s\S]*reset\(\)/);
    expect(simple).toMatch(/if \(!isOpen\)[\s\S]*setStep\(1\)/);
  });

  it('10 — print path still wired', () => {
    const lane = read('src/components/operations/BarberQueueWorkspaceModal.tsx');
    const simple = read('src/components/operations/SimpleCreateQueueDrawer.tsx');
    expect(lane).toContain('PrintQueueTicketModal');
    expect(lane).toContain('setShowPrintModal(true)');
    expect(simple).toContain('PrintQueueTicketModal');
    expect(simple).toContain('setShowPrintModal(true)');
  });

  it('active ops page still wires all four queue surfaces', () => {
    const page = read('src/app/operations/OperationsPageClient.tsx');
    expect(page).toContain('BarberQueueWorkspaceModal');
    expect(page).toContain('SimpleCreateQueueDrawer');
    expect(page).toContain('FindNearestQueueDrawer');
    expect(page).toContain('/api/operations/queue/quick');
  });

  it('CreateQueueDrawer remains unused orphan (not deleted)', () => {
    const page = read('src/app/operations/OperationsPageClient.tsx');
    expect(page).not.toContain("operations/CreateQueueDrawer");
    const orphan = read('src/components/operations/CreateQueueDrawer.tsx');
    expect(orphan).toContain('export function CreateQueueDrawer');
  });
});
