// Smoke test for public booking endpoints — run with: node test-public-api.mjs
const BASE = 'http://localhost:5500';

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, headers: Object.fromEntries(res.headers), json };
}

async function run() {
  let passed = 0, failed = 0;

  function pass(label, detail = '') {
    console.log(`  PASS  ${label}${detail ? '  ' + detail : ''}`);
    passed++;
  }
  function fail(label, detail = '') {
    console.error(`  FAIL  ${label}${detail ? '  ' + detail : ''}`);
    failed++;
  }

  console.log('\n=== GET endpoints ===');

  // 1. config
  {
    const r = await req('GET', '/api/public/booking/config');
    r.status === 200 && r.json.ok ? pass('GET /config', `salonName=${r.json.salon?.name}`) : fail('GET /config', JSON.stringify(r.json));
    // CORS
    r.headers['access-control-allow-origin'] === '*' ? pass('CORS header present') : fail('CORS header missing', r.headers['access-control-allow-origin']);
  }

  // 2. services
  {
    const r = await req('GET', '/api/public/booking/services');
    r.status === 200 && r.json.ok ? pass('GET /services', `count=${r.json.services?.length}`) : fail('GET /services', JSON.stringify(r.json));
  }

  // 3. barbers
  {
    const r = await req('GET', '/api/public/booking/barbers');
    r.status === 200 && r.json.ok ? pass('GET /barbers', `count=${r.json.barbers?.length}`) : fail('GET /barbers', JSON.stringify(r.json));
  }

  // 4. available-days
  {
    const r = await req('GET', '/api/public/booking/available-days?serviceIds=9&mode=nearest');
    r.status === 200 && r.json.ok ? pass('GET /available-days', `days=${r.json.days?.length}`) : fail('GET /available-days', JSON.stringify(r.json));
  }

  // 5. available-slots nearest
  {
    const r = await req('GET', '/api/public/booking/available-slots?date=2026-05-19&serviceIds=9&mode=nearest');
    r.status === 200 && r.json.ok ? pass('GET /available-slots nearest', `slots=${r.json.slots?.length}`) : fail('GET /available-slots', JSON.stringify(r.json));
  }

  console.log('\n=== POST check-slot ===');

  // 6. check-slot nearest
  {
    const r = await req('POST', '/api/public/booking/check-slot', { date:'2026-05-19', time:'23:00', serviceIds:[9], mode:'nearest' });
    r.status === 200 ? pass('POST /check-slot nearest', `available=${r.json.available}`) : fail('POST /check-slot nearest', JSON.stringify(r.json));
  }

  // 7. check-slot specific without empId — expect 400
  {
    const r = await req('POST', '/api/public/booking/check-slot', { date:'2026-05-19', time:'23:00', serviceIds:[9], mode:'specific' });
    r.status === 400 ? pass('POST /check-slot specific no empId -> 400 (expected)') : fail('POST /check-slot specific no empId', `got ${r.status}`);
  }

  console.log('\n=== POST create ===');

  let bookingCode = null;
  {
    const r = await req('POST', '/api/public/booking/create', {
      customer: { name: 'Test Client', phone: '01099999999' },
      serviceIds: [9],
      mode: 'nearest',
      date: '2026-05-19',
      time: '23:00',
      notes: 'smoke test',
    });
    if (r.status === 201 && r.json.ok) {
      bookingCode = r.json.booking?.code;
      pass('POST /create', `code=${bookingCode} barber=${r.json.booking?.barberName}`);
    } else {
      fail('POST /create', `status=${r.status} ${JSON.stringify(r.json)}`);
    }
  }

  if (bookingCode) {
    console.log('\n=== GET /:code ===');
    {
      const r = await req('GET', `/api/public/booking/${bookingCode}`);
      r.status === 200 && r.json.ok ? pass(`GET /${bookingCode}`, `status=${r.json.booking?.status}`) : fail(`GET /${bookingCode}`, JSON.stringify(r.json));
    }

    console.log('\n=== POST /:code/cancel ===');
    // wrong phone -> 403
    {
      const r = await req('POST', `/api/public/booking/${bookingCode}/cancel`, { phone: '00000000000', reason: 'wrong phone' });
      r.status === 403 ? pass('cancel wrong phone -> 403 (expected)') : fail('cancel wrong phone', `got ${r.status}`);
    }
    // correct phone
    {
      const r = await req('POST', `/api/public/booking/${bookingCode}/cancel`, { phone: '01099999999', reason: 'smoke test cancel' });
      r.status === 200 && r.json.ok ? pass('cancel correct phone -> 200') : fail('cancel', `status=${r.status} ${JSON.stringify(r.json)}`);
    }
    // cancel again -> 409
    {
      const r = await req('POST', `/api/public/booking/${bookingCode}/cancel`, { phone: '01099999999', reason: 'double cancel' });
      r.status === 409 ? pass('cancel already cancelled -> 409 (expected)') : fail('cancel double', `got ${r.status}`);
    }
  }

  console.log(`\n=== Result: ${passed} passed / ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
