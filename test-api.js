// Quick API test script
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 5500,
  path: '/api/customers/8/history-summary',
  method: 'GET',
  headers: {
    'Content-Type': 'application/json'
  }
};

console.log('Testing: GET http://localhost:5500/api/customers/8/history-summary\n');

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`Status Code: ${res.statusCode}\n`);
    
    if (res.statusCode === 200) {
      const json = JSON.parse(data);
      console.log('✅ SUCCESS! API is working correctly.\n');
      console.log('Response:');
      console.log(JSON.stringify(json, null, 2));
    } else {
      console.log('❌ ERROR Response:');
      console.log(data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
  console.log('\nMake sure the dev server is running on port 5500');
});

req.end();
