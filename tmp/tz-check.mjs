const ms = Date.parse('2026-08-28T13:00:00.000Z');
const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZoneName: 'shortOffset',
}).formatToParts(new Date(ms));
console.log('13:00 UTC in Cairo:', JSON.stringify(parts));

// simulate normalizeBookingTimes StartTime 16:00
const st = new Date('1970-01-01T16:00:00.000Z');
const h = String(st.getUTCHours()).padStart(2, '0');
const m = String(st.getUTCMinutes()).padStart(2, '0');
console.log('SQL StartTime parsed:', `${h}:${m}`);

function salonDateTimeToMs(dateStr, hhmm, tz) {
  const [hh, mm] = hhmm.split(':').map(Number);
  const noonUtc = new Date(`${dateStr}T12:00:00Z`);
  const noonLocal = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'shortOffset',
  }).formatToParts(noonUtc);
  const offsetPart = noonLocal.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
  const offsetMatch = offsetPart.match(/GMT([+-]\d+(?::\d+)?)/);
  let offsetMinutes = 0;
  if (offsetMatch) {
    const parts2 = offsetMatch[1].split(':');
    offsetMinutes = parseInt(parts2[0], 10) * 60 + (parts2[1] ? parseInt(parts2[1], 10) * Math.sign(parseInt(parts2[0], 10)) : 0);
  }
  const midnightUtcMs = new Date(`${dateStr}T00:00:00Z`).getTime();
  return midnightUtcMs - offsetMinutes * 60_000 + (hh * 60 + mm) * 60_000;
}

const fromStartTime = salonDateTimeToMs('2026-08-28', '16:00', 'Africa/Cairo');
const fromAbs = ms;
console.log('From StartTime 16:00 ms:', fromStartTime, new Date(fromStartTime).toISOString());
console.log('From AbsoluteStartUtc ms:', fromAbs, new Date(fromAbs).toISOString());
console.log('Match:', fromStartTime === fromAbs);
