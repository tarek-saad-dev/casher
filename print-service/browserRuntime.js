'use strict';

// Diagnostic only. A Chrome executable existing does not prove it launches,
// that the Windows spooler accepts the job, or that physical paper exits.
const fs = require('node:fs');
const puppeteer = require('puppeteer');

function getBrowserRuntimeStatus(deps = {}) {
  try {
    const executablePath = (deps.executablePath || (() => puppeteer.executablePath()))();
    const exists = (deps.existsSync || fs.existsSync)(executablePath);
    return { browserFound: Boolean(exists) };
  } catch {
    return { browserFound: false };
  }
}

function isBrowserMissingError(message) {
  return /could not find chrome|chrome-headless-shell.*not found|browser was not found/i.test(String(message || ''));
}

module.exports = { getBrowserRuntimeStatus, isBrowserMissingError };
