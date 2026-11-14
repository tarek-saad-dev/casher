'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getBrowserRuntimeStatus, isBrowserMissingError } = require('./browserRuntime');

describe('Puppeteer Chrome readiness', () => {
  it('reports missing Chrome when executable is not on disk', () => {
    assert.equal(getBrowserRuntimeStatus({ executablePath: () => 'C:/missing/chrome.exe', existsSync: () => false }).browserFound, false);
  });
  it('reports present Chrome without claiming the printer printed', () => {
    assert.deepEqual(getBrowserRuntimeStatus({ executablePath: () => 'C:/cache/chrome.exe', existsSync: () => true }), { browserFound: true });
  });
  it('does not disclose local filesystem paths on detection failure', () => {
    assert.deepEqual(getBrowserRuntimeStatus({ executablePath: () => { throw Error('C:/Users/name'); } }), { browserFound: false });
  });
  it('distinguishes Puppeteer missing renderer from printer name lookup', () => {
    assert.equal(isBrowserMissingError('Could not find Chrome (ver. 148.0.7778.97).'), true);
    assert.equal(isBrowserMissingError('Could not find printer XP-80'), false);
  });
});
