/**
 * Read-only live catalog probe via library (no HTTP server required).
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const o = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const { resolvePublicBookingBranchContext } = await import(
    '../../src/lib/booking/publicBookingBranchContext'
  );
  const { getPublicBookingServicesCatalog, invalidatePublicBookingServicesCache } = await import(
    '../../src/lib/booking/publicBookingServices'
  );
  const { PublicBookingBranchContextError } = await import(
    '../../src/lib/booking/publicBookingBranchContext'
  );

  invalidatePublicBookingServicesCache();

  const t0 = Date.now();
  const ctx = await resolvePublicBookingBranchContext({
    branchCode: 'GLEEM',
    purpose: 'public_booking',
  });
  const cold = await getPublicBookingServicesCatalog(ctx);
  const coldMs = Date.now() - t0;

  const t1 = Date.now();
  await getPublicBookingServicesCatalog(ctx);
  const warmMs = Date.now() - t1;

  const ids = cold.services.map((s) => s.serviceId);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  const json = JSON.stringify(cold);

  let ccError: { code?: string; httpStatus?: number } | null = null;
  try {
    await resolvePublicBookingBranchContext({
      branchCode: 'CAMP_CAESAR',
      purpose: 'public_booking',
    });
  } catch (e) {
    if (e instanceof PublicBookingBranchContextError) {
      ccError = { code: e.code, httpStatus: e.httpStatus };
    } else {
      throw e;
    }
  }

  let missingError: { code?: string } | null = null;
  try {
    await resolvePublicBookingBranchContext({ branchCode: null, purpose: 'public_booking' });
  } catch (e) {
    if (e instanceof PublicBookingBranchContextError) {
      missingError = { code: e.code };
    }
  }

  const out = {
    gleem: {
      status: 200,
      coldMs,
      warmMs,
      bytes: Buffer.byteLength(json, 'utf8'),
      categoryCount: cold.meta.categoryCount,
      serviceCount: cold.meta.serviceCount,
      duplicateIds: dupes,
      invalidDurationCount: cold.services.filter(
        (s) => !Number.isInteger(s.durationMinutes) || s.durationMinutes <= 0,
      ).length,
      invalidPriceCount: cold.services.filter(
        (s) => typeof s.price !== 'number' || !Number.isFinite(s.price) || s.price < 0,
      ).length,
      productsLeaked: json.match(/"ProType"\s*:\s*"pro"/) ? true : false,
      deletedLeaked: json.includes('"isDeleted"'),
      pricingScope: cold.pricingScope,
      sampleCategories: cold.categories.map((c) => ({
        id: c.categoryId,
        nameEn: c.nameEn,
        n: c.services.length,
      })),
    },
    campCaesar: ccError,
    missingBranch: missingError,
  };

  const outPath = path.join(__dirname, '_booking-phase2-live-lib-probe.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
