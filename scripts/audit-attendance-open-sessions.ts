/**
 * Read-only inventory of OPEN attendance sessions (CheckIn set, CheckOut null).
 * Prints counts via inventoryOpenAttendanceSessions. Never mutates.
 *
 * Soft-fails (exit 0 with message) when DB is unavailable.
 *
 * Usage: npx tsx scripts/audit-attendance-open-sessions.ts [YYYY-MM-DD]
 */

async function main() {
  const candidateWorkDate = process.argv[2];

  try {
    const { getPool, closePool } = await import('../src/lib/db');
    const { inventoryOpenAttendanceSessions } = await import(
      '../src/modules/attendance/application/openSessionInventory'
    );
    const { getCairoBusinessDate } = await import('../src/lib/businessDate');

    const db = await getPool();
    const candidate = candidateWorkDate ?? getCairoBusinessDate();
    const inv = await inventoryOpenAttendanceSessions(db, {
      candidateWorkDate: candidate,
      sampleLimit: 20,
    });

    console.log('=== Attendance OPEN session inventory (read-only) ===');
    console.log(`candidateWorkDate: ${candidate}`);
    console.log(`totalOpen: ${inv.totalOpen}`);
    console.log(`employeesWithMultipleOpen: ${inv.employeesWithMultipleOpen}`);
    console.log(`sameDateCrossBranchOpen groups: ${inv.sameDateCrossBranchOpen.length}`);
    console.log(`historical/stale sample size: ${inv.historicalOpenSample.length}`);
    console.log(`byEmpBranchDate groups: ${inv.byEmpBranchDate.length}`);

    if (inv.sameDateCrossBranchOpen.length > 0) {
      console.log('\nSame-date cross-branch OPEN (active conflicts):');
      for (const g of inv.sameDateCrossBranchOpen.slice(0, 20)) {
        console.log(
          `  emp=${g.empId} workDate=${g.workDate} branches=[${g.branchIds.join(',')}] ids=[${g.ids.join(',')}]`,
        );
      }
    }

    if (inv.historicalOpenSample.length > 0) {
      console.log('\nStale / historical OPEN sample:');
      for (const s of inv.historicalOpenSample.slice(0, 10)) {
        console.log(
          `  id=${s.attendanceId} emp=${s.employeeId} branch=${s.branchId} workDate=${s.workDate} checkIn=${s.checkInTime}`,
        );
      }
    }

    try {
      await closePool();
    } catch {
      /* ignore */
    }
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[audit-attendance-open-sessions] soft-fail (no DB or query error): ${message}`,
    );
    process.exit(0);
  }
}

void main();
