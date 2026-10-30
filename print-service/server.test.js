'use strict';

/**
 * Print service unit tests — mock adapter only (no real printer / Puppeteer spool).
 * Run: node --test print-service/server.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.PRINT_ADAPTER = 'mock';

const { app, validateReceiptData, createRequestId, closeEscposBrowser } = require('./server');

function request(server, { method, path, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch { json = data; }
        resolve({ status: res.statusCode, body: json, raw: data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('print-service', () => {
  let server;

  before(async () => {
    server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closeEscposBrowser();
  });

  it('health endpoint returns ok', async () => {
    const res = await request(server, { method: 'GET', path: '/health' });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.equal(res.body.ok, true);
    assert.ok(res.body.printer);
  });

  it('print/receipt rejects invalid body', async () => {
    const res = await request(server, {
      method: 'POST',
      path: '/print/receipt',
      body: { invID: 1 },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'INVALID_PAYLOAD');
    assert.ok(res.body.requestId);
    assert.equal(res.body.stack, undefined);
  });

  it('print/html rejects empty html', async () => {
    const res = await request(server, {
      method: 'POST',
      path: '/print/html',
      body: { html: '', requestId: 'html-empty' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'INVALID_PAYLOAD');
    assert.equal(res.body.requestId, 'html-empty');
    assert.equal(res.body.stack, undefined);
  });

  it('print/html mock adapter success includes requestId', async () => {
    const res = await request(server, {
      method: 'POST',
      path: '/print/html',
      body: {
        requestId: 'html-ok-1',
        html: '<!DOCTYPE html><html><body><h1>CUT SALON MOCK</h1></body></html>',
        width: '58mm',
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.success, true);
    assert.equal(res.body.requestId, 'html-ok-1');
    assert.ok(res.body.printer);
    assert.equal(res.body.stack, undefined);
  });

  it('coalesces duplicate receipt requests to a single queued job', async () => {
    const body = {
      requestId: 'duplicate-expense-42',
      html: '<html><body><strong>One receipt only</strong></body></html>',
      width: '58mm',
    };
    const [a, b] = await Promise.all([
      request(server, { method: 'POST', path: '/print/html', body }),
      request(server, { method: 'POST', path: '/print/html', body }),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body.duplicate, false);
    assert.equal(b.body.duplicate, true);
    assert.equal(a.body.requestId, b.body.requestId);
  });

  it('demo Arabic invoice is accepted without touching physical hardware', async () => {
    const fixture = require('./demo-receipt.json');
    const res = await request(server, {
      method: 'POST',
      path: '/print/receipt',
      body: fixture,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.requestId, fixture.requestId);
    assert.equal(res.body.invoiceId, 0);
    assert.equal(res.body.status, 'accepted');
  });

  it('settings page can pause and resume all printing without stopping the agent', async () => {
    const initial = await request(server, { method: 'GET', path: '/settings' });
    assert.equal(initial.status, 200);
    assert.equal(initial.body.ok, true);
    assert.equal(initial.body.engine, process.env.PRINT_ENGINE === 'escpos' ? 'escpos' : 'pdf');
    assert.equal(initial.body.physicalPrinterStatus, 'unknown');
    const paused = await request(server, {
      method: 'PATCH', path: '/settings', body: { enabled: false },
    });
    assert.equal(paused.status, 200);
    assert.equal(paused.body.enabled, false);
    const stopped = await request(server, {
      method: 'POST', path: '/print/test',
      body: { requestId: 'paused-test-1' },
    });
    assert.equal(stopped.status, 409);
    assert.equal(stopped.body.code, 'PRINT_DISABLED');
    const health = await request(server, { method: 'GET', path: '/health' });
    assert.equal(health.status, 200);
    assert.equal(health.body.printingEnabled, false);
    const resumed = await request(server, { method: 'PATCH', path: '/settings', body: { enabled: true } });
    assert.equal(resumed.body.enabled, true);
  });

  it('disabling expenses does not disable invoices or other receipts', async () => {
    const switched = await request(server, {
      method: 'PATCH', path: '/settings', body: { types: { expense: false } },
    });
    assert.equal(switched.status, 200);
    assert.equal(switched.body.types.expense, false);
    const receipt = await request(server, {
      method: 'POST', path: '/print/html',
      body: { requestId: 'disabled-exp-01', receiptType: 'expense', html: '<html>Expense</html>' },
    });
    assert.equal(receipt.status, 409);
    assert.equal(receipt.body.code, 'PRINT_TYPE_DISABLED');
    const invoice = await request(server, {
      method: 'POST', path: '/print/receipt',
      body: { ...require('./demo-receipt.json'), requestId: 'invoice-allowed-01' },
    });
    assert.equal(invoice.status, 200);
    const reset = await request(server, {
      method: 'PATCH', path: '/settings', body: { types: { expense: true } },
    });
    assert.equal(reset.body.types.expense, true);
  });

  it('settings reject unexpected properties and untrusted origins', async () => {
    const invalid = await request(server, { method: 'PATCH', path: '/settings', body: { engine: 'dangerous' } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, 'INVALID_PAYLOAD');
    const origin = await request(server, {
      method: 'PATCH', path: '/settings',
      body: { enabled: false },
      headers: { Origin: 'https://untrusted.invalid' },
    });
    assert.equal(origin.status, 403);
    const current = await request(server, { method: 'GET', path: '/settings' });
    assert.equal(current.body.enabled, true);
  });

  it('print/test mock mode succeeds', async () => {
    const res = await request(server, {
      method: 'POST',
      path: '/print/test',
      body: { requestId: 'test-1', mode: 'diagnostic' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.requestId, 'test-1');
  });

  it('validateReceiptData and createRequestId helpers', () => {
    assert.equal(validateReceiptData({}).valid, false);
    assert.equal(createRequestId('abc').startsWith('abc') || createRequestId('abc') === 'abc', true);
    assert.ok(createRequestId('').startsWith('ps-'));
  });
});
