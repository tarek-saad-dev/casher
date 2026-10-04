/**
 * Read-only check of package presentation on real data:
 * receipts for invoices carrying [groomPackage] metadata and /operations cards
 * for active package bookings.
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

const invArg = process.argv.find((a) => a.startsWith('--inv='));

async function main() {
  const { getPool, setDbTarget, sql } = await import('../src/lib/db');
  await setDbTarget('cloud');
  const db = await getPool();
  const { parseGroomPackageMetadataNote } = await import('../src/lib/booking/groomPackageBooking');
  const { loadPackageDisplayInfo } = await import('../src/lib/catalog/packageDisplayInfo');
  const { buildPackageReceipt } = await import('../src/lib/pos/groomPackageCart');

  const invs = await db.request().query(`
    SELECT TOP 10 h.invID, h.SubTotal, h.GrandTotal, h.Notes, h.Notes2, h.BranchID
    FROM dbo.TblinvServHead h
    WHERE h.invType = N'مبيعات' AND h.Notes2 LIKE N'%[[]groomPackage]%'
      ${invArg ? `AND h.invID = ${Number(invArg.slice(6))}` : ''}
    ORDER BY h.invID DESC
  `);
  for (const h of invs.recordset) {
    const note = parseGroomPackageMetadataNote([h.Notes, h.Notes2].filter(Boolean).join(' '))!;
    const details = await db.request().input('id', sql.Int, h.invID).query(`
      SELECT d.ProID, p.ProName, d.SPrice, d.SPriceAfterDis, d.Qty, d.DisVal, e.EmpName
      FROM dbo.TblinvServDetail d
      LEFT JOIN dbo.TblPro p ON p.ProID = d.ProID
      LEFT JOIN dbo.TblEmp e ON e.EmpID = d.EmpID
      WHERE d.invID = @id AND d.invType = N'مبيعات'
    `);
    const info = (await loadPackageDisplayInfo([note.packageId])).get(note.packageId)!;
    const receipt = buildPackageReceipt(
      details.recordset.map((d) => ({ ...d, ProID: Number(d.ProID), SPrice: Number(d.SPrice) })),
      {
        packageId: note.packageId,
        packagePrice: note.packagePrice,
        requiredServiceIds: note.requiredServiceIds,
        addonProIds: note.addonProIds,
        display: { nameAr: info.nameAr, originalPrice: info.originalPrice, items: info.items },
      },
    );
    const detailSum = details.recordset.reduce((s, d) => s + Number(d.SPriceAfterDis), 0);
    console.log(`\n=== invoice #${h.invID} branch=${h.BranchID} package=${note.packageId} (${info.nameAr})`);
    console.log(`DB: SubTotal=${h.SubTotal} GrandTotal=${h.GrandTotal} detailLines=${details.recordset.map((d) => `${d.ProID}:${d.SPriceAfterDis}`).join(' ')} sum=${detailSum}`);
    for (const l of receipt.lines) {
      const shown = l.shownAmount === undefined ? l.amount : l.shownAmount;
      console.log(`  ${l.variant === 'package_item' ? '   ' : '#  '}${l.label.padEnd(28)} ${shown ?? ''}`);
    }
    if (receipt.packageDiscount > 0) {
      console.log(`  المجموع قبل الخصم: ${Number(h.SubTotal) + receipt.packageDiscount}`);
      console.log(`  خصم الباكدج: -${receipt.packageDiscount}`);
    } else {
      console.log(`  المجموع الفرعي: ${h.SubTotal}`);
    }
    console.log(`  الإجمالي: ${h.GrandTotal}`);
  }

  const bookings = await db.request().query(`
    SELECT TOP 10 b.BookingID, b.BranchID, b.BookingDate, b.Status, b.Notes
    FROM dbo.Bookings b
    WHERE b.Notes LIKE N'%[[]groomPackage]%'
    ORDER BY b.BookingID DESC
  `);
  console.log('\n=== package bookings (latest)');
  for (const b of bookings.recordset) {
    const note = parseGroomPackageMetadataNote(String(b.Notes));
    console.log(
      `  #${b.BookingID} branch=${b.BranchID} date=${new Date(b.BookingDate).toISOString().slice(0, 10)} status=${b.Status} package=${note?.packageId}`,
    );
  }
  const { loadFlowBoardForBranch } = await import('../src/lib/operations/loadFlowBoardForBranch');
  const seen = new Set<string>();
  for (const b of bookings.recordset) {
    if (!['confirmed', 'arrived', 'in_progress', 'queued', 'in_service'].includes(b.Status)) continue;
    const dateStr = new Date(b.BookingDate).toISOString().slice(0, 10);
    const key = `${b.BranchID}|${dateStr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const board = await loadFlowBoardForBranch({ branchId: b.BranchID, dateStr, presenceMode: 'all' });
    console.log(`\n=== /operations board branch=${b.BranchID} date=${dateStr}`);
    for (const barber of board.barbers) {
      for (const item of barber.timeline) {
        if (item.type !== 'booking') continue;
        const detail = item.packageName
          ? `${item.packageName} | ${item.serviceNames?.length ?? 0} خدمات • ${item.durationMinutes} دقيقة`
          : (item.serviceNames ?? []).join(' + ');
        console.log(`  BK-${item.sourceId} ${barber.empName}: ${detail}`);
      }
    }
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
