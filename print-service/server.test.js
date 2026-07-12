'use strict';

/**
 * Print service unit tests — mock adapter only (no real printer / Puppeteer spool).
 * Run: node --test print-service/server.test.js
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.PRINT_ADAPTER = 'mock';

const { app, validateReceiptData, createRequestId } = require('./server');

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
