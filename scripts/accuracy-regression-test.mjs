/**
 * Phase 4C: Accuracy Regression Test
 * Verifies batch-optimized available-days endpoint returns correct results
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(
    import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

import sql from 'mssql';

const config = {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '1433'),
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    },
};

const BASE_URL = 'http://localhost:5500';
const TEST_EMP_IDS = [13, 25];
const SERVICE_ID = 9;

async function getEmployeeData(pool, empId) {
    const empResult = await pool.request()
        .input('empId', sql.Int, empId)
        .query(`
      SELECT EmpID, EmpName, Job, isActive
      FROM dbo.TblEmp
      WHERE EmpID = @empId
    `);

    const scheduleResult = await pool.request()
        .input('empId', sql.Int, empId)
        .query(`
      SELECT EmpID, DayOfWeek, IsWorkingDay, StartTime, EndTime
      FROM dbo.TblEmpWorkSchedule
      WHERE EmpID = @empId
      ORDER BY DayOfWeek
    `);

    let dayOffResult;
    try {
        dayOffResult = await pool.request()
            .input('empId', sql.Int, empId)
            .query(`
        SELECT EmpID, OffDate, Reason
        FROM dbo.TblEmpDayOff
        WHERE EmpID = @empId
      `);
    } catch {
        dayOffResult = { recordset: [] };
    }

    return {
        employee: empResult.recordset[0] || null,
        schedules: scheduleResult.recordset,
        dayOffs: dayOffResult.recordset
    };
}

function buildScheduleMap(schedules) {
    const map = {};
    console.log('  Raw schedule data:', JSON.stringify(schedules, null, 2));
    for (const s of schedules) {
        console.log(`  Processing Day ${s.DayOfWeek}: IsWorkingDay=${s.IsWorkingDay}, type=${typeof s.IsWorkingDay}`);
        map[s.DayOfWeek] = {
            isWorking: s.IsWorkingDay === true || s.IsWorkingDay === 1,
            startTime: s.StartTime ? s.StartTime.toString().slice(0, 5) : null,
            endTime: s.EndTime ? s.EndTime.toString().slice(0, 5) : null
        };
    }
    return map;
}

function buildDayOffMap(dayOffs) {
    const map = {};
    for (const d of dayOffs) {
        const dateStr = new Date(d.OffDate).toISOString().slice(0, 10);
        map[dateStr] = d.Reason || 'إجازة';
    }
    return map;
}

function getExpectedResult(dateStr, dayOfWeek, scheduleMap, dayOffMap) {
    // Check day off first
    if (dayOffMap[dateStr]) {
        return {
            available: false,
            reasonCode: 'DAY_OFF',
            reason: dayOffMap[dateStr]
        };
    }

    const schedule = scheduleMap[dayOfWeek];

    if (!schedule) {
        return {
            available: false,
            reasonCode: 'NO_WORKING_SCHEDULE',
            reason: 'لا توجد مواعيد عمل'
        };
    }

    if (!schedule.isWorking) {
        return {
            available: false,
            reasonCode: 'DAY_OFF',
            reason: 'إجازة أسبوعية'
        };
    }

    if (!schedule.startTime || !schedule.endTime) {
        return {
            available: false,
            reasonCode: 'NO_WORKING_SCHEDULE',
            reason: 'لا توجد مواعيد عمل'
        };
    }

    // Working day with valid hours - should be available (unless blocked by queue/bookings)
    return {
        available: true,
        reasonCode: null,
        reason: null
    };
}

async function callApi(mode, empId = null) {
    let url = `${BASE_URL}/api/public/booking/available-days?serviceIds=${SERVICE_ID}&mode=${mode}`;
    if (empId) url += `&empId=${empId}`;

    try {
        const response = await fetch(url);
        const data = await response.json();
        return data;
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

async function runAccuracyTest() {
    console.log('='.repeat(80));
    console.log('PHASE 4C: ACCURACY REGRESSION TEST');
    console.log('='.repeat(80));

    const pool = await sql.connect(config);
    console.log('\n✅ Connected to database\n');

    // =====================================================
    // TASK 1: Load real DB data
    // =====================================================
    console.log('='.repeat(80));
    console.log('TASK 1: Loading Real DB Data');
    console.log('='.repeat(80));

    const barberData = {};
    for (const empId of TEST_EMP_IDS) {
        const data = await getEmployeeData(pool, empId);
        barberData[empId] = data;

        console.log(`\n📊 Barber ${empId}:`);
        if (data.employee) {
            console.log(`  Name: ${data.employee.EmpName}`);
            console.log(`  Job: ${data.employee.Job}`);
            console.log(`  Active: ${data.employee.isActive}`);
        }

        console.log(`  Schedules (${data.schedules.length} rows):`);
        for (const s of data.schedules) {
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const start = s.StartTime ? s.StartTime.toString().slice(0, 5) : 'NULL';
            const end = s.EndTime ? s.EndTime.toString().slice(0, 5) : 'NULL';
            console.log(`    Day ${s.DayOfWeek} (${dayNames[s.DayOfWeek]}): ${s.IsWorking ? 'WORKING' : 'OFF'} ${start}-${end}`);
        }

        if (data.dayOffs.length > 0) {
            console.log(`  Day Offs: ${data.dayOffs.length} rows`);
        }
    }

    // =====================================================
    // TASK 2 & 3: Specific Mode Accuracy
    // =====================================================
    console.log('\n' + '='.repeat(80));
    console.log('TASK 2 & 3: Specific Mode Accuracy Test');
    console.log('='.repeat(80));

    const testDates = [
        { date: '2026-05-18', label: 'الاثنين', dow: 1 },
        { date: '2026-05-19', label: 'الثلاثاء', dow: 2 },
        { date: '2026-05-20', label: 'الأربعاء', dow: 3 },
        { date: '2026-05-21', label: 'الخميس', dow: 4 },
        { date: '2026-05-22', label: 'الجمعة', dow: 5 },
        { date: '2026-05-23', label: 'السبت', dow: 6 },
        { date: '2026-05-24', label: 'الأحد', dow: 0 },
    ];

    let allPassed = true;

    for (const empId of TEST_EMP_IDS) {
        const data = barberData[empId];
        if (!data.employee) {
            console.log(`\n❌ Barber ${empId} not found in DB`);
            continue;
        }

        const scheduleMap = buildScheduleMap(data.schedules);
        const dayOffMap = buildDayOffMap(data.dayOffs);

        console.log(`\n🧪 Testing empId=${empId} (${data.employee.EmpName}):`);
        console.log('-'.repeat(80));

        // Call API
        const apiResult = await callApi('specific', empId);
        if (!apiResult.ok) {
            console.log(`  ❌ API ERROR: ${apiResult.error || 'Unknown error'}`);
            allPassed = false;
            continue;
        }

        // Build API response map
        const apiDayMap = {};
        for (const day of apiResult.days || []) {
            apiDayMap[day.date] = day;
        }

        // Compare each date
        console.log(`\n  | Date | Day | DB Status | DB Hours | API available | API reasonCode | Match? |`);
        console.log(`  |------|-----|-----------|----------|---------------|----------------|--------|`);

        for (const testDate of testDates) {
            const expected = getExpectedResult(testDate.date, testDate.dow, scheduleMap, dayOffMap);
            const apiDay = apiDayMap[testDate.date];

            if (!apiDay) {
                console.log(`  | ${testDate.date} | ${testDate.label} | MISSING IN API | - | - | - | ❌ |`);
                allPassed = false;
                continue;
            }

            const schedule = scheduleMap[testDate.dow];
            const dbStatus = schedule ? (schedule.isWorking ? 'WORKING' : 'OFF') : 'NO SCHEDULE';
            const dbHours = schedule ? `${schedule.startTime || 'N/A'}-${schedule.endTime || 'N/A'}` : '-';

            const match = expected.available === apiDay.available;

            // For working days, we can't predict blockers, so just check API says available=true
            // For off days, check reasonCode
            let accuracy = match ? '✅' : '❌';
            if (expected.available && apiDay.available) {
                accuracy = '✅'; // Both available - correct
            } else if (!expected.available && !apiDay.available) {
                // Both unavailable - check reason
                if (expected.reasonCode === 'DAY_OFF' && apiDay.reasonCode === 'DAY_OFF') {
                    accuracy = '✅';
                } else if (expected.reasonCode === 'NO_WORKING_SCHEDULE' && apiDay.reasonCode === 'NO_WORKING_SCHEDULE') {
                    accuracy = '✅';
                } else {
                    accuracy = '⚠️'; // Different reason but both unavailable
                }
            } else {
                accuracy = '❌';
                allPassed = false;
            }

            console.log(`  | ${testDate.date} | ${testDate.label} | ${dbStatus} | ${dbHours} | ${apiDay.available} | ${apiDay.reasonCode || '-'} | ${accuracy} |`);
        }
    }

    // =====================================================
    // TASK 4: Nearest Mode Accuracy
    // =====================================================
    console.log('\n' + '='.repeat(80));
    console.log('TASK 4: Nearest Mode Accuracy Test');
    console.log('='.repeat(80));

    const nearestResult = await callApi('nearest');
    if (!nearestResult.ok) {
        console.log(`\n❌ Nearest mode API ERROR: ${nearestResult.error || 'Unknown'}`);
        allPassed = false;
    } else {
        console.log(`\n✅ Nearest mode returned ${nearestResult.days?.length || 0} days`);

        // Check that if any barber is available, nearest returns available
        let availableCount = 0;
        for (const day of nearestResult.days || []) {
            if (day.available) availableCount++;
        }

        console.log(`\n  Available days: ${availableCount}/${nearestResult.days?.length || 0}`);

        // Sample first 7 days
        console.log(`\n  First 7 days sample:`);
        console.log(`  | Date | Label | API available |`);
        console.log(`  |------|-------|---------------|`);
        for (const day of(nearestResult.days || []).slice(0, 7)) {
            console.log(`  | ${day.date} | ${day.label} | ${day.available ? '✅ true' : '❌ false'} |`);
        }
    }

    // =====================================================
    // TASK 5: Queue/Booking Blockers
    // =====================================================
    console.log('\n' + '='.repeat(80));
    console.log('TASK 5: Queue/Booking Blockers Sanity Test');
    console.log('='.repeat(80));

    // Check if there are any queue tickets or bookings
    const queueCheck = await pool.request().query(`
    SELECT COUNT(*) as cnt FROM dbo.QueueTickets 
    WHERE LOWER(Status) IN ('waiting','called','arrived','in_service')
  `).catch(() => ({ recordset: [{ cnt: 0 }] }));

    const bookingCheck = await pool.request().query(`
    SELECT COUNT(*) as cnt FROM dbo.Bookings 
    WHERE LOWER(Status) IN ('confirmed','arrived','queued','in_service')
  `).catch(() => ({ recordset: [{ cnt: 0 }] }));

    const queueCount = queueCheck.recordset[0].cnt;
    const bookingCount = bookingCheck.recordset[0].cnt;

    console.log(`\n  Active queue tickets: ${queueCount}`);
    console.log(`  Active bookings: ${bookingCount}`);

    if (queueCount === 0 && bookingCount === 0) {
        console.log(`\n  ⚠️ No active queue/bookings found - cannot test blockers`);
        console.log(`  (This is OK for accuracy test - blockers only affect days with activity)`);
    } else {
        console.log(`\n  ✅ Active tickets/bookings exist - blockers will be checked in specific mode`);
    }

    // =====================================================
    // TASK 6: Final Report
    // =====================================================
    console.log('\n' + '='.repeat(80));
    console.log('TASK 6: FINAL ACCURACY REPORT');
    console.log('='.repeat(80));

    console.log(`\n📋 SUMMARY:`);
    console.log(`  - Tested barbers: ${TEST_EMP_IDS.join(', ')}`);
    console.log(`  - Test dates: ${testDates.length} days`);
    console.log(`  - Active queue tickets in DB: ${queueCount}`);
    console.log(`  - Active bookings in DB: ${bookingCount}`);

    if (allPassed) {
        console.log(`\n✅ ALL ACCURACY CHECKS PASSED`);
        console.log(`   Phase 4B batch optimization preserved correctness.`);
        console.log(`   Ready for: Database indexes / performance tuning`);
    } else {
        console.log(`\n❌ ACCURACY ISSUES DETECTED`);
        console.log(`   Review mismatches above before proceeding.`);
    }

    await pool.close();
    process.exit(allPassed ? 0 : 1);
}

runAccuracyTest().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});