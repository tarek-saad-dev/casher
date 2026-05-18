const BASE_URL = 'http://localhost:5500';
const SERVICE_ID = 9;

async function testEndpoint(name, url, expectedResults = null) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST: ${name}`);
  console.log(`${'='.repeat(80)}`);
  
  const times = [];
  const results = [];
  
  for (let i = 1; i <= 3; i++) {
    const start = Date.now();
    try {
      const res = await fetch(url);
      const data = await res.json();
      const elapsed = Date.now() - start;
      times.push(elapsed);
      results.push(data);
      console.log(`Run ${i}: ${elapsed}ms - ${data.ok ? 'OK' : 'ERROR'}`);
    } catch (err) {
      const elapsed = Date.now() - start;
      times.push(elapsed);
      console.log(`Run ${i}: ${elapsed}ms - ERROR: ${err.message}`);
    }
  }
  
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const min = Math.min(...times);
  const max = Math.max(...times);
  
  console.log(`\nTiming Summary:`);
  console.log(`  Average: ${avg}ms`);
  console.log(`  Min: ${min}ms`);
  console.log(`  Max: ${max}ms`);
  
  if (expectedResults && results[0]?.days) {
    console.log(`\nAccuracy Check:`);
    let passed = 0;
    for (const [date, expected] of Object.entries(expectedResults)) {
      const day = results[0].days.find(d => d.date === date);
      if (day) {
        const match = day.available === expected;
        console.log(`  ${date}: ${day.available} (expected ${expected}) ${match ? '✅' : '❌'}`);
        if (match) passed++;
      }
    }
    console.log(`  ${passed}/${Object.keys(expectedResults).length} checks passed`);
  }
  
  // Save result
  const fs = await import('fs');
  fs.writeFileSync(
    `perf-${name.replace(/[^a-z0-9]/gi, '_')}.json`,
    JSON.stringify({ times, average: avg, result: results[0] }, null, 2)
  );
  
  return { times, average: avg, results };
}

async function runTests() {
  console.log('PHASE 4C: PERFORMANCE TEST AFTER INDEXES');
  console.log('Waiting for server...');
  
  // Wait for server
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(`${BASE_URL}/api/public/booking/config`);
      console.log('Server ready!\n');
      break;
    } catch {
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  // Test 1: Nearest mode (3 runs)
  await testEndpoint(
    'Nearest Mode',
    `${BASE_URL}/api/public/booking/available-days?serviceIds=${SERVICE_ID}&mode=nearest`
  );
  
  // Test 2: Specific empId=13 with accuracy check
  await testEndpoint(
    'Specific empId=13',
    `${BASE_URL}/api/public/booking/available-days?serviceIds=${SERVICE_ID}&mode=specific&empId=13`,
    {
      '2026-05-18': true,  // Monday - working
      '2026-05-19': false, // Tuesday - off
      '2026-05-22': true,  // Friday - working
      '2026-05-24': true,  // Sunday - working
    }
  );
  
  console.log('\n' + '='.repeat(80));
  console.log('PERFORMANCE TEST COMPLETE');
  console.log('='.repeat(80));
}

runTests();
