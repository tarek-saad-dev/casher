import test from 'node:test';
import assert from 'node:assert/strict';
import {
  run, pickTargets, CONFIRM_PHRASE,
} from '../reschedule-ali-mohamed-20261025.mjs';

const source = [
  {
    BookingID: 101,
    BookingCode: 'BK-ABCD2',
    ClientName: 'علي محمود',
    BookingDate: '2026-10-25T00:00:00.000Z',
    startTimeDisplay: '23:00',
    Status: 'confirmed',
    EmpName: 'عمر',
    AssignedEmpID: 17,
  },
  {
    BookingID: 102,
    BookingCode: 'BK-BCDE3',
    ClientName: 'محمد',
    BookingDate: '2026-10-25T00:00:00.000Z',
    startTimeDisplay: '23:30',
    Status: 'pending',
    EmpName: 'عمر',
    AssignedEmpID: 17,
  },
];

function mockServer({ rows = source, failValidationId, failPatchId } = {}) {
  const state = structuredClone(rows);
  const requests = [];
  const fetchImpl = async (url, options) => {
    const u = new URL(url);
    requests.push({ path: u.pathname, method: options.method, body: options.body && JSON.parse(options.body) });
    assert.equal(options.headers.Cookie, 'staff-session=fixture');
    if (u.pathname === '/api/bookings') {
      return Response.json({ bookings: state });
    }
    const matching = u.pathname.match(/^\/api\/(?:operations\/)?bookings\/(\d+)(?:\/(validate-move|reschedule))?$/);
    if (!matching) return Response.json({ error: 'unknown endpoint' }, { status: 404 });
    const [, rawId, action] = matching;
    const id = Number(rawId);
    const booking = state.find((item) => item.BookingID === id);
    if (!booking) return Response.json({ error: 'not found' }, { status: 404 });
    if (action === 'validate-move') {
      if (id === failValidationId) {
        return Response.json({ valid: false, code: 'SCHEDULE_CONFLICT', message: 'taken' });
      }
      return Response.json({ valid: true, targetEmpId: 17 });
    }
    if (action === 'reschedule') {
      if (id === failPatchId) {
        return Response.json({ code: 'SCHEDULE_CONFLICT', message: 'occupied' }, { status: 409 });
      }
      const { newStartAt, operationalDate, targetEmpId } = JSON.parse(options.body);
      assert.equal(operationalDate, '2026-10-28');
      assert.equal(targetEmpId, 17);
      assert.match(newStartAt, /^2026-10-28T20:(00|30):00\.000Z$/);
      booking.BookingDate = '2026-10-28T00:00:00.000Z';
      booking.startTimeDisplay = newStartAt.endsWith('20:00:00.000Z') ? '23:00' : '23:30';
      return Response.json({ ok: true, bookingId: id });
    }
    return Response.json({ booking });
  };
  return { requests, state, fetchImpl };
}
const args = (server, options = {}) => ({
  cookie: 'staff-session=fixture',
  fetchImpl: server.fetchImpl,
  log: () => {},
  ...options,
});

test('dry run validates both bookings and never calls PATCH', async () => {
  const server = mockServer();
  const result = await run(args(server));
  assert.deepEqual(result, { applied: false, validated: 2, changed: 0 });
  assert.equal(server.requests.filter((r) => r.method === 'POST').length, 2);
  assert.equal(server.requests.filter((r) => r.method === 'PATCH').length, 0);
});

test('same client on BOTH WhatsApp confirmations is not enough to identify Mohamed', async () => {
  const server = mockServer({
    rows: [source[0], { ...source[1], ClientName: 'علي محمود' }],
  });
  await assert.rejects(run(args(server)), /different client name/);
  assert.equal(server.requests.filter((r) => r.method !== 'GET').length, 0);
});

test('ambiguous same-time booking aborts before writing', () => {
  assert.throws(() => pickTargets([source[0], source[0], source[1]]), /expected exactly one/);
});

test('uneditable bookings cannot be moved', () => {
  assert.throws(
    () => pickTargets([{ ...source[0], Status: 'completed' }, source[1]]),
    /not editable/
  );
});

test('validation conflict in second booking blocks changes to both', async () => {
  const server = mockServer({ failValidationId: 102 });
  await assert.rejects(run(args(server, {
    apply: true, confirmation: CONFIRM_PHRASE,
  })), /Slot validation failed/);
  assert.equal(server.requests.filter((r) => r.method === 'PATCH').length, 0);
});

test('applying without the confirmation phrase is blocked before any network call', async () => {
  const server = mockServer();
  await assert.rejects(run(args(server, { apply: true })), /To apply/);
  assert.equal(server.requests.length, 0);
});

test('full apply moves BOTH to 28 October with preserved times and verifies readback', async () => {
  const server = mockServer();
  const result = await run(args(server, {
    apply: true, confirmation: CONFIRM_PHRASE,
  }));
  assert.deepEqual(result, { applied: true, validated: 2, changed: 2 });
  assert.equal(server.requests.filter((r) => r.method === 'PATCH').length, 2);
  assert.equal(server.state[0].startTimeDisplay, '23:00');
  assert.equal(server.state[1].startTimeDisplay, '23:30');
  assert.ok(server.state.every((booking) => booking.BookingDate.startsWith('2026-10-28')));
});

test('reports partial success instead of pretending both moved after second failure', async () => {
  const server = mockServer({ failPatchId: 102 });
  await assert.rejects(
    run(args(server, { apply: true, confirmation: CONFIRM_PHRASE })),
    /PARTIAL SUCCESS: 1 booking/
  );
  assert.equal(server.state[0].BookingDate.slice(0, 10), '2026-10-28');
  assert.equal(server.state[1].BookingDate.slice(0, 10), '2026-10-25');
});
