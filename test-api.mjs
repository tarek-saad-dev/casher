const http = require('http');

const options = {
  hostname: 'localhost',
  port: 5500,
  path: '/api/public/booking/available-days?serviceIds=9&mode=specific&empId=13',
  method: 'GET',
  timeout: 30000
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log('Response:', data);
    require('fs').writeFileSync('final-response.json', data);
    console.log('Saved to final-response.json');
  });
});

req.on('error', (e) => {
  console.error('Request failed:', e.message);
  require('fs').writeFileSync('final-response.json', JSON.stringify({ error: e.message }));
});

req.on('timeout', () => {
  console.error('Request timed out');
  req.destroy();
});

req.end();
