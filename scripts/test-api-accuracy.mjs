// API Accuracy Test for empId=13
// Tests /api/public/booking/available-days endpoint

const BASE_URL = process.env.BASE_URL || 'http://localhost:5500';
const EMP_ID = 13;
const SERVICE_ID = 9;

async function testEndpoint() {
    console.log('='.repeat(70));
    console.log('API ACCURACY TEST: empId=13');
    console.log('='.repeat(70));
    console.log(`Endpoint: ${BASE_URL}/api/public/booking/available-days`);
    console.log(`Params: serviceIds=${SERVICE_ID}&mode=specific&empId=${EMP_ID}`);
    console.log('');

    try {
        const url = `${BASE_URL}/api/public/booking/available-days?serviceIds=${SERVICE_ID}&mode=specific&empId=${EMP_ID}`;
        
        console.log(`Fetching: ${url}`);
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error(`❌ HTTP Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error('Response body:', text.slice(0, 500));
            process.exit(1);
        }

        const data = await response.json();
        
        console.log('\n' + '='.repeat(70));
        console.log('API RESPONSE:');
        console.log('='.repeat(70));
        console.log(JSON.stringify(data, null, 2));
        
        // Analyze specific dates
        console.log('\n' + '='.repeat(70));
        console.log('DETAILED ANALYSIS - Focus Dates:');
        console.log('='.repeat(70));
        
        const focusDates = [
            { date: '2026-05-18', label: 'Monday', jsDay: 1, dbDayOfWeek: 1, isWorking: true },
            { date: '2026-05-22', label: 'Friday', jsDay: 5, dbDayOfWeek: 5, isWorking: true },
            { date: '2026-05-24', label: 'Sunday', jsDay: 0, dbDayOfWeek: 0, isWorking: true },
        ];
        
        const offDays = [
            { date: '2026-05-19', label: 'Tuesday', jsDay: 2, dbDayOfWeek: 2, isWorking: false },
            { date: '2026-05-20', label: 'Wednesday', jsDay: 3, dbDayOfWeek: 3, isWorking: false },
            { date: '2026-05-21', label: 'Thursday', jsDay: 4, dbDayOfWeek: 4, isWorking: false },
            { date: '2026-05-23', label: 'Saturday', jsDay: 6, dbDayOfWeek: 6, isWorking: false },
        ];
        
        if (data.days && Array.isArray(data.days)) {
            console.log('\n📅 WORKING DAYS (Expected: available=true):');
            console.log('-'.repeat(70));
            
            for (const test of focusDates) {
                const dayData = data.days.find(d => d.date === test.date);
                if (dayData) {
                    const status = dayData.available ? '✅ CORRECT' : '❌ WRONG';
                    const expected = test.isWorking ? 'available=true' : 'available=false';
                    const actual = `available=${dayData.available}`;
                    
                    console.log(`\n${test.date} ${test.label} (jsDay=${test.jsDay}):`);
                    console.log(`  Expected: ${expected}`);
                    console.log(`  Actual:   ${actual}`);
                    console.log(`  Status:   ${status}`);
                    
                    if (!dayData.available) {
                        console.log(`  reason:   ${dayData.reason || 'N/A'}`);
                        console.log(`  reasonCode: ${dayData.reasonCode || 'N/A'}`);
                        
                        if (dayData.reasonCode === 'NO_WORKING_SCHEDULE') {
                            console.log('  🔴 BUG: API not reading schedule correctly!');
                        }
                    }
                } else {
                    console.log(`\n${test.date} ${test.label}: ❌ NOT FOUND in response`);
                }
            }
            
            console.log('\n\n📅 OFF DAYS (Expected: available=false):');
            console.log('-'.repeat(70));
            
            for (const test of offDays) {
                const dayData = data.days.find(d => d.date === test.date);
                if (dayData) {
                    const status = !dayData.available ? '✅ CORRECT' : '❌ WRONG';
                    
                    console.log(`\n${test.date} ${test.label} (jsDay=${test.jsDay}):`);
                    console.log(`  Expected: available=false`);
                    console.log(`  Actual:   available=${dayData.available}`);
                    console.log(`  Status:   ${status}`);
                    
                    if (!dayData.available) {
                        console.log(`  reason:   ${dayData.reason || 'N/A'}`);
                        console.log(`  reasonCode: ${dayData.reasonCode || 'N/A'}`);
                    }
                }
            }
            
            // Summary
            console.log('\n\n' + '='.repeat(70));
            console.log('SUMMARY:');
            console.log('='.repeat(70));
            
            const workingDays = data.days.filter(d => 
                focusDates.some(fd => fd.date === d.date)
            );
            const availableWorkingDays = workingDays.filter(d => d.available);
            
            console.log(`\nWorking Days Test:`);
            console.log(`  Total working days: ${workingDays.length}`);
            console.log(`  Available: ${availableWorkingDays.length}`);
            console.log(`  Unavailable: ${workingDays.length - availableWorkingDays.length}`);
            
            if (availableWorkingDays.length === workingDays.length) {
                console.log('  ✅ ALL WORKING DAYS AVAILABLE - Schedule reading OK');
            } else {
                console.log('  ❌ SOME WORKING DAYS UNAVAILABLE - Check schedule logic');
            }
            
        } else {
            console.log('❌ Response missing "days" array');
            console.log('Full response:', JSON.stringify(data, null, 2));
        }

    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

testEndpoint();
