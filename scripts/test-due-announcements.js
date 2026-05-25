const http = require('http');

const today = new Date().toISOString().slice(0, 10);
const url = `http://localhost:5500/api/operations/queue/due-announcements?date=${today}`;

console.log('Testing:', url);

http.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const j = JSON.parse(data);
    console.log('\nStatus:', res.statusCode);
    console.log('announcements count:', j.announcements?.length ?? 'N/A');
    console.log('schema:', JSON.stringify(j.schema, null, 2));

    if (j.announcements?.length) {
      j.announcements.forEach(a => {
        console.log('\n  Type:', a.type);
        console.log('  Code:', a.ticketCode);
        console.log('  EmpName:', a.empName);
        console.log('  ScheduledTime:', a.scheduledTime || a.estimatedStartTime);
        console.log('  ChairNumber:', a.chairNumber);
        console.log('  AR:', a.announcementTextAr?.slice(0, 60));
        console.log('  EN:', a.announcementTextEn?.slice(0, 60));
      });
    } else {
      console.log('\n  (no announcements due right now)');
    }

    if (j.error) console.error('Error:', j.error);
  });
}).on('error', e => {
  console.error('HTTP error:', e.message);
  console.error('Is the dev server running on port 5500?');
});
