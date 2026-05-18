// Test nearest mode performance
const BASE_URL = 'http://localhost:5500';

async function test() {
    console.log('Testing nearest mode performance...\n');
    
    const start = Date.now();
    const url = `${BASE_URL}/api/public/booking/available-days?serviceIds=9&mode=nearest`;
    
    console.log(`Fetching: ${url}`);
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        const elapsed = Date.now() - start;
        
        console.log(`\n=== RESULTS ===`);
        console.log(`Response time: ${elapsed}ms`);
        console.log(`Days returned: ${data.days?.length || 0}`);
        
        if (data.ok && data.days) {
            const available = data.days.filter(d => d.available).length;
            console.log(`Available days: ${available}`);
            console.log(`Unavailable days: ${data.days.length - available}`);
            
            console.log(`\nFirst 7 days:`);
            data.days.slice(0, 7).forEach(d => {
                console.log(`  ${d.date} ${d.label}: ${d.available ? '✅' : '❌'}`);
            });
            
            if (elapsed < 2000) {
                console.log(`\n✅ TARGET ACHIEVED: Under 2 seconds!`);
            } else if (elapsed < 5000) {
                console.log(`\n⚠️ PARTIAL: Under 5 seconds`);
            } else {
                console.log(`\n❌ SLOW: Over 5 seconds`);
            }
        } else {
            console.log('Error:', data.error || 'Unknown error');
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
}

test();
