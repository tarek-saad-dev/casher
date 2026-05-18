/**
 * Diagnostic script for empId=13 accuracy verification
 * Uses the same DB connection as the app
 */

require('dotenv').config({ path: '.env.local' });
const sql = require('mssql');

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

const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

async function diagnose() {
    try {
        console.log('Connecting to database...');
        const pool = await sql.connect(config);
        console.log('Connected.\n');

        // ====================================================
        // TASK 1 — Get Employee Row
        // ====================================================
        console.log('='.repeat(60));
        console.log('1. EMPLOYEE ROW (empId=13)');
        console.log('='.repeat(60));

        const empResult = await pool.request()
            .query(`
        SELECT 
          EmpID, EmpName, Job, isActive
        FROM dbo.TblEmp
        WHERE EmpID = 13
      `);

        if (empResult.recordset.length === 0) {
            console.log('❌ Employee NOT FOUND');
        } else {
            console.log('Employee Found:');
            console.table(empResult.recordset[0]);
        }

        // ====================================================
        // TASK 1 — Work Schedule Rows
        // ====================================================
        console.log('\n' + '='.repeat(60));
        console.log('2. WORK SCHEDULE ROWS (empId=13)');
        console.log('='.repeat(60));

        const scheduleResult = await pool.request()
            .query(`
        SELECT 
          EmpID, DayOfWeek, IsWorkingDay,
          StartTime, EndTime, Notes
        FROM dbo.TblEmpWorkSchedule
        WHERE EmpID = 13
        ORDER BY DayOfWeek
      `);

        console.log(`Found ${scheduleResult.recordset.length} schedule rows:`);
        if (scheduleResult.recordset.length > 0) {
            console.table(scheduleResult.recordset.map(r => ({
                ...r,
                DayOfWeek: `${r.DayOfWeek} (${AR_DAYS[r.DayOfWeek]})`,
                StartTime: r.StartTime ? (r.StartTime.toString().match(/(\d{2}:\d{2})/) || [])[1] || r.StartTime.toString().slice(0, 5) : 'NULL',
                EndTime: r.EndTime ? (r.EndTime.toString().match(/(\d{2}:\d{2})/) || [])[1] || r.EndTime.toString().slice(0, 5) : 'NULL'
            })));
        } else {
            console.log('❌ NO WORK SCHEDULE FOUND');
        }

        // ====================================================
        // TASK 1 — Day Off Rows
        // ====================================================
        console.log('\n' + '='.repeat(60));
        console.log('3. DAY OFF ROWS (empId=13)');
        console.log('='.repeat(60));

        let dayOffResult;
        try {
            dayOffResult = await pool.request()
                .query(`
          SELECT 
            DayOffID, EmpID, OffDate, DayOfWeek,
            Reason, IsApproved, CreatedAt,
            StartDate, EndDate, IsRecurring
          FROM dbo.TblEmpDayOff
          WHERE EmpID = 13
          ORDER BY OffDate
        `);

            console.log(`Found ${dayOffResult.recordset.length} day off rows:`);
            if (dayOffResult.recordset.length > 0) {
                console.table(dayOffResult.recordset.map(r => ({
                    ...r,
                    OffDate: r.OffDate ? r.OffDate.toISOString().slice(0, 10) : 'NULL',
                    DayOfWeek: r.DayOfWeek !== null ? `${r.DayOfWeek} (${AR_DAYS[r.DayOfWeek]})` : 'NULL',
                    StartDate: r.StartDate ? r.StartDate.toISOString().slice(0, 10) : 'NULL',
                    EndDate: r.EndDate ? r.EndDate.toISOString().slice(0, 10) : 'NULL',
                    IsRecurring: r.IsRecurring || 'NULL'
                })));
            } else {
                console.log('✅ No day offs found');
            }
        } catch (err) {
            console.log('⚠️ TblEmpDayOff table does not exist or error:', err.message);
            dayOffResult = { recordset: [] };
        }

        // ====================================================
        // TASK 1 — Service Row
        // ====================================================
        console.log('\n' + '='.repeat(60));
        console.log('4. SERVICE ROW (serviceId=9)');
        console.log('='.repeat(60));

        const serviceResult = await pool.request()
            .query(`
        SELECT 
          ProID, ProName, SPrice1
        FROM dbo.TblPro
        WHERE ProID = 9
      `);

        if (serviceResult.recordset.length === 0) {
            console.log('❌ Service NOT FOUND');
        } else {
            console.log('Service Found:');
            console.table(serviceResult.recordset[0]);
        }

        // ====================================================
        // TASK 1 — Settings Row
        // ====================================================
        console.log('\n' + '='.repeat(60));
        console.log('5. QUEUE BOOKING SETTINGS');
        console.log('='.repeat(60));

        const settingsResult = await pool.request()
            .query(`
        SELECT TOP 1 *
        FROM dbo.QueueBookingSettings
      `).catch(() => ({ recordset: [] }));

        if (settingsResult.recordset.length === 0) {
            console.log('❌ Settings NOT FOUND');
        } else {
            console.log('Settings Found:');
            console.table(settingsResult.recordset[0]);
        }

        // ====================================================
        // TASK 2 — Barber List API Check
        // ====================================================
        console.log('\n' + '='.repeat(60));
        console.log('6. BARBER LIST API VISIBILITY');
        console.log('='.repeat(60));

        const barberCheck = await pool.request()
            .query(`
        SELECT 
          e.EmpID,
          e.EmpName,
          e.Job,
          e.isActive,
          CASE 
            WHEN e.Job LIKE N'%حلاق%' 
                 AND e.isActive = 1 
            THEN '✅ WOULD APPEAR'
            ELSE '❌ WOULD NOT APPEAR'
          END AS ApiVisibility
        FROM dbo.TblEmp e
        WHERE e.EmpID = 13
      `);

        if (barberCheck.recordset.length === 0) {
            console.log('❌ empId=13 does NOT match barber API criteria');
        } else {
            console.log('Barber API Check:');
            console.table(barberCheck.recordset[0]);
        }

        // ====================================================
        // TASK 3 — Day Mapping Verification
        // ====================================================
        console.log('\n' + '='.repeat(60));
        console.log('7. DAY-OF-WEEK MAPPING VERIFICATION');
        console.log('='.repeat(60));
        console.log('Testing dates: 2026-05-18 (Mon) to 2026-05-24 (Sun)\n');

        const dates = [
            { date: '2026-05-18', label: 'الاثنين', jsDay: 1 },
            { date: '2026-05-19', label: 'الثلاثاء', jsDay: 2 },
            { date: '2026-05-20', label: 'الأربعاء', jsDay: 3 },
            { date: '2026-05-21', label: 'الخميس', jsDay: 4 },
            { date: '2026-05-22', label: 'الجمعة', jsDay: 5 },
            { date: '2026-05-23', label: 'السبت', jsDay: 6 },
            { date: '2026-05-24', label: 'الأحد', jsDay: 0 },
        ];

        const dayMappingReport = [];

        for (const d of dates) {
            // Check schedule
            const scheduleCheck = await pool.request()
                .input('empId', sql.Int, 13)
                .input('dayOfWeek', sql.Int, d.jsDay)
                .query(`
          SELECT StartTime, EndTime, IsWorkingDay
          FROM dbo.TblEmpWorkSchedule
          WHERE EmpID = @empId AND DayOfWeek = @dayOfWeek
        `);

            // Check day off for specific date
            let dayOffCheck;
            try {
                dayOffCheck = await pool.request()
                    .input('empId', sql.Int, 13)
                    .input('offDate', sql.Date, d.date)
                    .query(`
            SELECT Reason, IsRecurring
            FROM dbo.TblEmpDayOff
            WHERE EmpID = @empId AND OffDate = @offDate
          `);
            } catch {
                dayOffCheck = { recordset: [] };
            }

            const hasSchedule = scheduleCheck.recordset.length > 0;
            const hasDayOff = dayOffCheck.recordset.length > 0;

            let finalReason = 'NO_WORKING_SCHEDULE';
            if (hasDayOff) {
                finalReason = 'DAY_OFF (specific date)';
            } else if (hasSchedule) {
                const s = scheduleCheck.recordset[0];
                finalReason = `WORKING ${s.StartTime?.toString().slice(0, 5)}-${s.EndTime?.toString().slice(0, 5)}`;
            }

            dayMappingReport.push({
                Date: d.date,
                Label: d.label,
                JsDay: d.jsDay,
                HasSchedule: hasSchedule ? '✅' : '❌',
                ScheduleTime: hasSchedule ?
                    `${scheduleCheck.recordset[0].StartTime?.toString().slice(0, 5)}-${scheduleCheck.recordset[0].EndTime?.toString().slice(0, 5)}` : '-',
                HasDayOff: hasDayOff ? '🚫' : '-',
                DayOffReason: hasDayOff ? dayOffCheck.recordset[0].Reason : '-',
                ExpectedApiResult: finalReason
            });
        }

        console.table(dayMappingReport);

        // ====================================================
        // TASK 4 — TblEmpDayOff Structure
        // ====================================================
        console.log('\n' + '='.repeat(60));
        console.log('8. TblEmpDayOff STRUCTURE ANALYSIS');
        console.log('='.repeat(60));

        try {
            const columnsResult = await pool.request()
                .query(`
          SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            IS_NULLABLE,
            COLUMN_DEFAULT
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = 'TblEmpDayOff'
          ORDER BY ORDINAL_POSITION
        `);

            console.log('Table Columns:');
            console.table(columnsResult.recordset);

            // Analyze how day offs are stored
            console.log('\nDay Off Data Pattern Analysis:');
            const patternResult = await pool.request()
                .query(`
          SELECT 
            DayOffID,
            EmpID,
            OffDate,
            DayOfWeek,
            Reason,
            StartDate,
            EndDate,
            IsRecurring,
            CASE 
              WHEN OffDate IS NOT NULL AND DayOfWeek IS NULL THEN 'SPECIFIC_DATE_ONLY'
              WHEN DayOfWeek IS NOT NULL AND OffDate IS NULL THEN 'WEEKLY_RECURRING'
              WHEN OffDate IS NOT NULL AND DayOfWeek IS NOT NULL THEN 'BOTH_FIELDS_SET'
              ELSE 'UNKNOWN_PATTERN'
            END AS DataPattern
          FROM dbo.TblEmpDayOff
          WHERE EmpID = 13 OR EmpID IN (SELECT TOP 5 EmpID FROM dbo.TblEmpDayOff GROUP BY EmpID)
          ORDER BY CreatedAt DESC
        `);

            if (patternResult.recordset.length > 0) {
                console.table(patternResult.recordset.slice(0, 10).map(r => ({
                    ...r,
                    OffDate: r.OffDate ? r.OffDate.toISOString().slice(0, 10) : 'NULL',
                    DayOfWeek: r.DayOfWeek !== null ? r.DayOfWeek : 'NULL',
                    StartDate: r.StartDate ? r.StartDate.toISOString().slice(0, 10) : 'NULL',
                    EndDate: r.EndDate ? r.EndDate.toISOString().slice(0, 10) : 'NULL'
                })));

                // Count patterns
                const patterns = {};
                for (const row of patternResult.recordset) {
                    patterns[row.DataPattern] = (patterns[row.DataPattern] || 0) + 1;
                }
                console.log('\nPattern Summary:');
                console.table(Object.entries(patterns).map(([pattern, count]) => ({ Pattern: pattern, Count: count })));
            }
        } catch (err) {
            console.log('⚠️ TblEmpDayOff table does not exist - skipping structure analysis');
        }

        // ====================================================
        // TASK 5 — Compare with other barbers
        // ====================================================
        console.log('\n' + '='.repeat(60));
        console.log('9. COMPARISON: Other barbers with schedules');
        console.log('='.repeat(60));

        const comparison = await pool.request()
            .query(`
        SELECT TOP 5
          e.EmpID,
          e.EmpName,
          COUNT(ws.ScheduleID) AS ScheduleCount,
          (SELECT COUNT(*) FROM dbo.TblEmpDayOff WHERE EmpID = e.EmpID) AS DayOffCount
        FROM dbo.TblEmp e
        JOIN dbo.TblEmpWorkSchedule ws ON ws.EmpID = e.EmpID
        WHERE e.Job LIKE N'%حلاق%'
          AND e.isActive = 1
        GROUP BY e.EmpID, e.EmpName
        ORDER BY ScheduleCount DESC
      `);

        console.log('Barbers with schedules (for comparison):');
        console.table(comparison.recordset);

        // Show empId=13 if it has any schedule
        const emp13Comparison = comparison.recordset.find(r => r.EmpID === 13);
        if (emp13Comparison) {
            console.log(`\n✅ empId=13 has ${emp13Comparison.ScheduleCount} schedule rows`);
        } else {
            console.log(`\n❌ empId=13 has NO schedules (or doesn't match barber criteria)`);
        }

        // ====================================================
        // SUMMARY
        // ====================================================
        console.log('\n' + '='.repeat(60));
        console.log('FINAL SUMMARY');
        console.log('='.repeat(60));

        const emp = empResult.recordset[0];
        const scheduleCount = scheduleResult.recordset.length;
        const dayOffCount = dayOffResult.recordset.length;

        console.log(`Employee: ${emp?.EmpName || 'NOT FOUND'} (ID: 13)`);
        console.log(`Job: ${emp?.Job || 'N/A'}`);
        console.log(`Active: ${emp?.isActive}`);
        console.log(`Work Schedules: ${scheduleCount}`);
        console.log(`Day Offs: ${dayOffCount}`);

        if (scheduleCount === 0) {
            console.log('\n🔴 CRITICAL: empId=13 has NO work schedule');
            console.log('   API returning NO_WORKING_SCHEDULE is CORRECT');
        }

        if (dayOffCount > 0) {
            console.log('\n🟡 empId=13 has day off entries');
            console.log('   API returning DAY_OFF for those dates is CORRECT');
        }

        const isBarber = emp && emp.Job && emp.Job.includes('حلاق') && emp.isActive === 1;
        if (!isBarber) {
            console.log('\n🔴 CRITICAL: empId=13 may not be a valid bookable barber');
            console.log('   Check Job field contains "حلاق", isActive=1');
        }

        console.log('\n✅ Diagnosis complete.');

        await pool.close();
        process.exit(0);

    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

diagnose();