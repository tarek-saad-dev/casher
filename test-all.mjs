const BASE_URL = 'http://localhost:5500';
const SERVICE_ID = 9;

async function testEndpoint(name, url) {
  console.log(`\n========================================`);
  console.log(`TEST: ${name}`);
  console.log(`URL: ${url}`);
  console.log(`========================================`);
  
  const start = Date.now();
  try {
    const res = await fetch(url);
    const data = await res.json();
    const elapsed = Date.now() - start;
    
    console.log(`Status: ${res.status}`);
    console.log(`Time: ${elapsed}ms`);
    console.log(`Response:`);
    console.log(JSON.stringify(data, null, 2));
    
    // Write to file
    const fs = await import('fs');
    fs.writeFileSync(`${name.replace(/[^a-z0-9]/gi, '_')}.json`, JSON.stringify(data, null, 2));
    
    return { success: true, data, time: elapsed };
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`ERROR after ${elapsed}ms: ${err.message}`);
    return { success: false, error: err.message, time: elapsed };
  }
}

async function runTests() {
  // Wait for server
  console.log('Waiting for server...');
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
  
  // Test 1: Config
  await testEndpoint('Config', `${BASE_URL}/api/public/booking/config`);
  
  // Test 2: Specific empId=13
  await testEndpoint('Specific empId=13', `${BASE_URL}/api/public/booking/available-days?serviceIds=${SERVICE_ID}&mode=specific&empId=13`);
  
  // Test 3: Specific empId=25
  await testEndpoint('Specific empId=25', `${BASE_URL}/api/public/booking/available-days?serviceIds=${SERVICE_ID}&mode=specific&empId=25`);
  
  // Test 4: Nearest
  await testEndpoint('Nearest', `${BASE_URL}/api/public/booking/available-days?serviceIds=${SERVICE_ID}&mode=nearest`);
}

runTests();
