const ADMIN_KEY = 'admin-secret-change-me';
const BASE_URL = 'http://localhost:5500';

async function checkIndexes() {
  console.log('Checking current index status...\n');
  
  try {
    const res = await fetch(`${BASE_URL}/api/admin/booking-indexes-migrate`, {
      headers: { 'x-admin-secret': ADMIN_KEY }
    });
    const data = await res.json();
    
    console.log('Index Status:');
    console.log(JSON.stringify(data, null, 2));
    
    // Write to file
    const fs = await import('fs');
    fs.writeFileSync('index-status.json', JSON.stringify(data, null, 2));
    
    if (data.canMigrate) {
      console.log('\n⚠️ Missing indexes found. Run POST to create them.');
    } else {
      console.log('\n✅ All indexes exist or were skipped.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkIndexes();
