const http = require('http');

const options = {
  hostname: 'localhost',
  port: 5500,
  path: '/api/admin/booking-debug/day?date=2026-05-18&serviceIds=9',
  method: 'GET',
  headers: {
    'x-admin-secret': 'admin-secret-change-me'
  }
};

console.log('Testing diagnostic endpoint...\n');

const start = Date.now();
const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const elapsed = Date.now() - start;
    console.log(`Response time: ${elapsed}ms`);
    console.log(`Status: ${res.statusCode}`);
    console.log('\nResponse (first 500 chars):');
    console.log(data.slice(0, 500));
    
    try {
      const json = JSON.parse(data);
      if (json.barbers) {
        console.log(`\n\nBarbers found: ${json.barbers.length}`);
        json.barbers.forEach(b => {
          console.log(`\n${b.name} (ID: ${b.empId}):`);
          console.log(`  Working: ${b.isWorkingDay}`);
          console.log(`  Window: ${b.workingWindow ? `${b.workingWindow.start}-${b.workingWindow.end}` : 'N/A'}`);
          console.log(`  Available slots: ${b.availableSlots?.length || 0}`);
          console.log(`  Blocked slots: ${b.blockedSlots?.length || 0}`);
          if (b.reason) {
            console.log(`  Reason: ${b.reason} (${b.reasonCode})`);
          }
        });
      }
    } catch (e) {
      console.log('\nCould not parse JSON:', e.message);
    }
    
    require('fs').writeFileSync('debug-result.json', data);
  });
});

req.on('error', (e) => {
  console.error('Request failed:', e.message);
});

req.end();
