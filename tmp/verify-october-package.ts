/**
 * Post-seed verification for the October package + POS package resolver.
 * Usage: npx tsx tmp/verify-october-package.ts
 */
import { readFileSync } from 'fs';
import path from 'path';
import Module from 'module';

const mod = Module as any;
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

for (const envPath of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(path.join(process.cwd(), envPath), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    /* ignore */
  }
}
delete process.env.HAWAI_DB_CLASS;

async function main() {
  const { getPool, setDbTarget } = await import('../src/lib/db');
  await setDbTarget('cloud');
  const db = await getPool();
  const { getPublicPackagesCatalog } = await import('../src/lib/catalog/publicPackagesCatalog');
  const { resolveGroomPackageBooking } = await import('../src/lib/booking/groomPackageBooking');
  const { buildPackageCartItems } = await import('../src/lib/pos/groomPackageCart');
  const { computeInvoiceItemsTotals } = await import('../src/lib/sales/service-line-totals');
  const { resolvePublicBookingBranchContext } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const { getPublicBookingServicesCatalog } = await import('../src/lib/booking/publicBookingServices');

  let fail = 0;
  const check = (ok: boolean, msg: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
    if (!ok) fail += 1;
  };

  // What GET /api/pos/packages returns
  const cat = await getPublicPackagesCatalog();
  const oct = cat.packages.find((p) => p.nameEn === 'October Package');
  check(!!oct, 'POS catalog contains October Package');
  check(oct?.price === 333, `October price=333 (got ${oct?.price})`);
  check(oct?.kind === 'regular', 'October kind=regular');
  check(
    JSON.stringify(oct?.includes.map((i) => i.serviceId)) === JSON.stringify([9, 10, 22, 29]),
    `October includes 9,10,22,29 (got ${oct?.includes.map((i) => i.serviceId)})`,
  );
  check(
    cat.packages.filter((p) => p.nameEn === 'October Package').length === 1,
    'no duplicate October package',
  );
  console.log(
    `  POS catalog: ${cat.packages.map((p) => `${p.packageId}:${p.nameEn}=${p.price}(${p.kind})`).join(' | ')}`,
  );

  // What POST /api/pos/packages/resolve returns
  const r = await resolveGroomPackageBooking({ packageId: oct!.packageId, allowedKinds: ['regular', 'groom'] });
  check(r.totalPrice === 333, `resolve totalPrice=333 (got ${r.totalPrice})`);
  check(
    JSON.stringify(r.services.map((s) => [s.serviceId, s.price])) ===
      JSON.stringify([[9, 333], [10, 0], [22, 0], [29, 0]]),
    `resolve lines ${JSON.stringify(r.services.map((s) => [s.serviceId, s.price]))}`,
  );

  // Cart → invoice totals (same helpers POS uses)
  const items = buildPackageCartItems({
    resolved: r,
    barber: { EmpID: 1, EmpName: 'verify' },
  });
  const totals = computeInvoiceItemsTotals(
    items.map((i) => ({ sPrice: i.SPrice, qty: i.Qty, discountValue: i.DisVal, bonus: i.Bonus })),
  );
  check(totals.grandTotal === 333, `cart GrandTotal=333 (got ${totals.grandTotal})`);
  check(totals.totalBonus === 0, 'cart TotalBonus=0');

  // Booking path unchanged: groom-only
  await resolveGroomPackageBooking({ packageId: oct!.packageId }).then(
    () => check(false, 'booking path rejects regular package'),
    (e) => check(e?.code === 'PACKAGE_NOT_GROOM', `booking path rejects regular package (${e?.code})`),
  );

  // Groom regression (POS + booking)
  for (const p of cat.groom) {
    const viaPos = await resolveGroomPackageBooking({ packageId: p.packageId, allowedKinds: ['regular', 'groom'] });
    const viaBooking = await resolveGroomPackageBooking({ packageId: p.packageId });
    check(
      viaPos.totalPrice === p.price && viaBooking.totalPrice === p.price,
      `groom ${p.nameEn} resolves at ${p.price} via POS and booking`,
    );
  }

  // Service prices untouched
  const pros = await db.request().query(`SELECT ProID, SPrice1 FROM dbo.TblPro WHERE ProID IN (9,10,22,29) ORDER BY ProID`);
  check(
    JSON.stringify(pros.recordset.map((x: any) => Number(x.SPrice1))) === JSON.stringify([200, 100, 120, 300]),
    `TblPro prices unchanged ${pros.recordset.map((x: any) => `${x.ProID}=${x.SPrice1}`).join(',')}`,
  );

  // Branch availability
  for (const code of ['GLEEM', 'CAMP_CAESAR']) {
    const ctx = await resolvePublicBookingBranchContext({ branchCode: code, purpose: 'public_booking' });
    const svc = await getPublicBookingServicesCatalog(ctx);
    const set = new Set(svc.services.map((s) => s.serviceId));
    const missing = [9, 10, 22, 29].filter((id) => !set.has(id));
    check(missing.length === 0, `${code}: 9,10,22,29 available${missing.length ? ` missing=${missing}` : ''}`);
  }

  // Existing package invoices: header total == sum of detail nets (no double counting)
  const inv = await db.request().query(`
    SELECT TOP 10 h.invID, h.GrandTotal, h.TotalBonus,
      (SELECT SUM(d.SPriceAfterDis) FROM dbo.TblinvServDetail d WHERE d.invID = h.invID) AS DetailNet,
      (SELECT COUNT(*) FROM dbo.TblinvServDetail d WHERE d.invID = h.invID AND d.SPriceAfterDis = 0) AS ZeroLines,
      LEFT(h.Notes2, 120) AS Notes2
    FROM dbo.TblinvServHead h
    WHERE h.Notes2 LIKE N'%[[]groomPackage]%'
    ORDER BY h.invID DESC
  `);
  console.log(`  existing package invoices: ${inv.recordset.length}`);
  for (const row of inv.recordset as any[]) {
    console.log(`   inv ${row.invID} GrandTotal=${row.GrandTotal} DetailNet=${row.DetailNet} zeroLines=${row.ZeroLines} | ${row.Notes2}`);
  }

  console.log(`\nOVERALL: ${fail === 0 ? 'PASS' : 'FAIL'} (failures=${fail})`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
