// Debug test to capture actual error
const BASE_URL = 'http://localhost:5500';

async function test() {
  try {
    const res = await fetch(`${BASE_URL}/api/public/booking/available-days?serviceIds=9&mode=specific&empId=13`);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
    
    // Also write to file
    const fs = await import('fs');
    fs.writeFileSync('scripts/debug-output.json', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
