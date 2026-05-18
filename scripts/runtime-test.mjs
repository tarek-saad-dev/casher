// Runtime test after Phase 4B batch optimization
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import sql from 'mssql';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const BASE_URL = 'http://localhost:5500';

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

async function waitForServer(maxRetries = 30) {
  console.log('Waiting for dev server to start...');
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/public/booking/config`);
      const data = await res.json();
      if (data.ok) {
        console.log('✅ Server ready\n');
        return true;
      }
    } catch {
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error('Server did not start in time');
}

async function testApi(endpoint) {
  const url = `${BASE_URL}${endpoint}`;
  console.log(`Testing: ${url}`);
  try {
    const res = await fetch(url);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: 'Invalid JSON', raw: text.slice(0, 500) };
    }
  } catch (err) {
    return { error: err.message };
  }
}

async function getDbData(pool) {
  const empRes = await pool.request().query(`
    SELECT EmpID, EmpName, Job, isActive
    FROM dbo.TblEmp
    WHERE EmpID IN (13, 25)
  `);
  
  const scheduleRes = await pool.request().query(`
    SELECT EmpID, DayOfWeek, IsWorkingDay, StartTime, EndTime
    FROM dbo.TblEmpWorkSchedule
    WHERE EmpID IN (13, 25)
    ORDER BY EmpID, DayOfWeek
  `);
  
  return {
    employees: empRes.recordset,
    schedules: scheduleRes.recordset
  };
}

async function runTest() {
  console.log('='.repeat(80));
  console.log('TASK 1: Checking server status');
  console.log('='.repeat(80));
  
  await waitForServer();
  
  console.log('='.repeat(80));
  console.log('TASK 2: Running API calls');
  console.log('='.repeat(80));
  
  // Test 1: Specific empId=13
  console.log('\n1. GET /api/public/booking/available-days?serviceIds=9&mode=specific&empId=13');
  const result13 = await testApi('/api/public/booking/available-days?serviceIds=9&mode=specific&empId=13');
  console.log(JSON.stringify(result13, null, 2));
  
  // Test 2: Specific empId=25
  console.log('\n2. GET /api/public/booking/available-days?serviceIds=9&mode=specific&empId=25');
  const result25 = await testApi('/api/public/booking/available-days?serviceIds=9&mode=specific&empId=25');
  console.log(JSON.stringify(result25, null, 2));
  
  // Test 3: Nearest
  console.log('\n3. GET /api/public/booking/available-days?serviceIds=9&mode=nearest');
  const resultNearest = await testApi('/api/public/booking/available-days?serviceIds=9&mode=nearest');
  console.log(`Days returned: ${resultNearest.days?.length || 0}`);
  if (resultNearest.days) {
    console.log('First 7 days:', JSON.stringify(resultNearest.days.slice(0, 7), null, 2));
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('TASK 3: Database validation');
  console.log('='.repeat(80));
  
  const pool = await sql.connect(config);
  const dbData = await getDbData(pool);
  
  console.log('\nEmployees:');
  console.table(dbData.employees);
  
  console.log('\nSchedules:');
  for (const emp of dbData.employees) {
    console.log(`\nEmpID ${emp.EmpID} (${emp.EmpName}):`);
    const empSchedules = dbData.schedules.filter(s => s.EmpID === emp.EmpID);
    for (const s of empSchedules) {
      const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const start = s.StartTime ? s.StartTime.toString().slice(0,5) : 'NULL';
      const end = s.EndTime ? s.EndTime.toString().slice(0,5) : 'NULL';
      console.log(`  Day ${s.DayOfWeek} (${dayNames[s.DayOfWeek]}): IsWorkingDay=${s.IsWorkingDay}, Hours=${start}-${end}`);
    }
  }
  
  await pool.close();
  
  console.log('\n' + '='.repeat(80));
  console.log('TASK 4: Comparison table');
  console.log('='.repeat(80));
  
  // Build comparison
  const testDates = [
    { date: '2026-05-18', dow: 1, label: 'Mon' },
    { date: '2026-05-19', dow: 2, label: 'Tue' },
    { date: '2026-05-20', dow: 3, label: 'Wed' },
    { date: '2026-05-21', dow: 4, label: 'Thu' },
    { date: '2026-05-22', dow: 5, label: 'Fri' },
    { date: '2026-05-23', dow: 6, label: 'Sat' },
    { date: '2026-05-24', dow: 0, label: 'Sun' },
  ];
  
  // Build schedule lookup
  const scheduleMap = {};
  for (const s of dbData.schedules) {
    if (!scheduleMap[s.EmpID]) scheduleMap[s.EmpID] = {};
    scheduleMap[s.EmpID][s.DayOfWeek] = {
      isWorking: s.IsWorkingDay,
      startTime: s.StartTime ? s.StartTime.toString().slice(0,5) : null,
      endTime: s.EndTime ? s.EndTime.toString().slice(0,5) : null
    };
  }
  
  // Build API result maps
  const api13Map = {};
  if (result13.days) {
    for (const d of result13.days) api13Map[d.date] = d;
  }
  
  const api25Map = {};
  if (result25.days) {
    for (const d of result25.days) api25Map[d.date] = d;
  }
  
  console.log('\nEmpID=13 Comparison:');
  console.log('| Date | Day | DB IsWorkingDay | DB Hours | API available | API reasonCode | Match? |');
  console.log('|------|-----|-----------------|----------|---------------|----------------|--------|');
  
  let allMatch = true;
  
  for (const td of testDates) {
    const sched = scheduleMap[13]?.[td.dow];
    const apiDay = api13Map[td.date];
    
    if (!apiDay) {
      console.log(`| ${td.date} | ${td.label} | ${sched?.isWorking || 'NO SCHED'} | ${sched ? `${sched.startTime}-${sched.endTime}` : '-'} | MISSING | MISSING | ❌ |`);
      allMatch = false;
      continue;
    }
    
    const dbStatus = sched ? (sched.isWorking ? 'true' : 'false') : 'NO SCHED';
    const dbHours = sched ? `${sched.startTime || 'N/A'}-${sched.endTime || 'N/A'}` : '-';
    
    // Determine expected
    let expectedAvailable = false;
    if (!sched) {
      expectedAvailable = false;
    } else if (!sched.isWorking) {
      expectedAvailable = false;
    } else {
      // Working day - should be available unless fully blocked
      // For test, assume available=true is correct for working days
      expectedAvailable = true;
    }
    
    const match = (expectedAvailable === apiDay.available) ? '✅' : '❌';
    if (match === '❌') allMatch = false;
    
    console.log(`| ${td.date} | ${td.label} | ${dbStatus} | ${dbHours} | ${apiDay.available} | ${apiDay.reasonCode || '-'} | ${match} |`);
  }
  
  console.log('\nEmpID=25 Comparison:');
  console.log('| Date | Day | DB IsWorkingDay | DB Hours | API available | API reasonCode | Match? |');
  console.log('|------|-----|-----------------|----------|---------------|----------------|--------|');
  
  for (const td of testDates) {
    const sched = scheduleMap[25]?.[td.dow];
    const apiDay = api25Map[td.date];
    
    if (!apiDay) {
      console.log(`| ${td.date} | ${td.label} | ${sched?.isWorking || 'NO SCHED'} | ${sched ? `${sched.startTime}-${sched.endTime}` : '-'} | MISSING | MISSING | ❌ |`);
      allMatch = false;
      continue;
    }
    
    const dbStatus = sched ? (sched.isWorking ? 'true' : 'false') : 'NO SCHED';
    const dbHours = sched ? `${sched.startTime || 'N/A'}-${sched.endTime || 'N/A'}` : '-';
    
    let expectedAvailable = false;
    if (!sched) {
      expectedAvailable = false;
    } else if (!sched.isWorking) {
      expectedAvailable = false;
    } else {
      expectedAvailable = true;
    }
    
    const match = (expectedAvailable === apiDay.available) ? '✅' : '❌';
    if (match === '❌') allMatch = false;
    
    console.log(`| ${td.date} | ${td.label} | ${dbStatus} | ${dbHours} | ${apiDay.available} | ${apiDay.reasonCode || '-'} | ${match} |`);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('TASK 6: Final Decision');
  console.log('='.repeat(80));
  
  const hasErrors = result13.error || result25.error || resultNearest.error;
  
  if (hasErrors) {
    console.log('\n❌ Post-4B Runtime Accuracy: FAILED');
    console.log('Errors detected in API responses:');
    if (result13.error) console.log('  - empId=13:', result13.error);
    if (result25.error) console.log('  - empId=25:', result25.error);
    if (resultNearest.error) console.log('  - nearest:', resultNearest.error);
  } else if (!allMatch) {
    console.log('\n⚠️ Post-4B Runtime Accuracy: MISMATCHES FOUND');
    console.log('API returned responses but some results do not match expected DB state.');
  } else {
    console.log('\n✅ Post-4B Runtime Accuracy: PASSED');
    console.log('All API responses match expected database state.');
  }
  
  process.exit(hasErrors ? 1 : 0);
}

runTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
