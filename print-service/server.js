'use strict';

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { buildReceiptHTML } = require('./receipt-template');
const { printPdf, getAdapterMode } = require('./printerAdapter');
const { buildEscPosFromPng } = require('./escpos');
const { printRawEscPos } = require('./rawPrinterAdapter');
const { createSettingsStore, assertAllowed, TYPES } = require('./printSettings');
const printSettings = createSettingsStore();

const app = express();
const PORT = Number(process.env.PRINTER_SERVICE_PORT || 7788);
const PRINTER_NAME = process.env.PRINTER_NAME || 'XP-80';
// Opt-in per workstation. Keep tested PDF path until XP-80 RAW support is verified.
const PRINT_ENGINE = process.env.PRINT_ENGINE === 'escpos' ? 'escpos' : 'pdf';
// Cutter is configured in persistent local settings; startup env is only the first-run default.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'http://localhost:5500,http://127.0.0.1:5500,https://ops.cutsaloon.com'
).split(',').map((s) => s.trim()).filter(Boolean);

app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin(origin, callback) {
    // Allow non-browser clients (curl/PowerShell) that send no Origin
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Request-Id'],
}));

// Serialized jobs; changes to settings affect pending jobs before they reach Windows.
let printTail = Promise.resolve();
const recentRequests = new Map();
let pendingJobs = 0;
let activeJobs = 0;
let lastAcceptedAt = null;
function scheduleOnce(requestId, task, receiptType = 'other') {
  assertAllowed(printSettings.get(), receiptType);
  const now = Date.now();
  for (const [key, entry] of recentRequests) {
    if (now - entry.at > 10 * 60 * 1000) recentRequests.delete(key);
  }
  if (recentRequests.has(requestId)) {
    return recentRequests.get(requestId).promise.then((result) => ({ ...result, duplicate: true }));
  }
  pendingJobs += 1;
  const promise = printTail.then(async () => {
    pendingJobs -= 1;
    assertAllowed(printSettings.get(), receiptType);
    activeJobs += 1;
    try {
      const result = await task();
      lastAcceptedAt = new Date().toISOString();
      return result;
    } finally {
      activeJobs -= 1;
    }
  }, (err) => { pendingJobs -= 1; throw err; });
  printTail = promise.catch(() => {});
  recentRequests.set(requestId, { at: now, promise });
  if (recentRequests.size > 1000) recentRequests.delete(recentRequests.keys().next().value);
  return promise;
}

let escposBrowserPromise;
async function getEscposBrowser() {
  if (!escposBrowserPromise) {
    escposBrowserPromise = puppeteer.launch({
      headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }).catch((err) => { escposBrowserPromise = null; throw err; });
  }
  const browser = await escposBrowserPromise;
  if (!browser.isConnected()) { escposBrowserPromise = null; return getEscposBrowser(); }
  return browser;
}

async function closeEscposBrowser() {
  const pending = escposBrowserPromise;
  escposBrowserPromise = null;
  if (!pending) return;
  const browser = await pending.catch(() => null);
  if (browser?.isConnected()) await browser.close();
}

function createRequestId(incoming) {
  if (typeof incoming === 'string' && incoming.trim()) return incoming.trim().slice(0, 64);
  return `ps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function logErrorDetails(requestId, error, extra = {}) {
  console.error(`[print-service][${requestId}] error details`, {
    name: error?.name,
    message: error?.message,
    code: error?.code,
    stage: error?.stage,
    exitCode: error?.exitCode ?? error?.status,
    stdout: error?.stdout,
    stderr: error?.stderr,
    printer: error?.printer || PRINTER_NAME,
    stack: error?.stack,
    ...extra,
  });
}

function errorResponse(res, status, {
  requestId,
  stage,
  code,
  message,
  printer = PRINTER_NAME,
}) {
  return res.status(status).json({
    ok: false,
    success: false,
    stage,
    code,
    message,
    requestId,
    printer,
  });
}

function validateReceiptData(data) {
  const required = ['invID', 'invDate', 'invTime', 'GrandTotal'];
  const missing = required.filter((field) => data[field] === undefined || data[field] === null || data[field] === '');

  if (missing.length > 0) {
    return { valid: false, error: `Missing required fields: ${missing.join(', ')}`, code: 'INVALID_PAYLOAD' };
  }

  if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
    return { valid: false, error: 'Items array is required and must not be empty', code: 'INVALID_PAYLOAD' };
  }

  return { valid: true };
}

/**
 * Render HTML → PDF → Windows spooler via adapter.
 */
async function printHtmlDocument(html, {
  requestId,
  width = '80mm',
  printer = PRINTER_NAME,
  filePrefix = 'doc',
}) {
  if (!html || typeof html !== 'string' || html.trim().length < 10) {
    const err = new Error('html is required and must be a non-empty string');
    err.code = 'INVALID_PAYLOAD';
    err.stage = 'validation';
    throw err;
  }

  console.log(`[print-service][${requestId}] payload validated`, {
    htmlLength: html.length,
    width,
    printer,
  });
  console.log(`[print-service][${requestId}] printer resolved`, { printer });

  // Native ESC/POS raster mode: screenshot => monochrome dots => RAW spooler.
  // No temporary PDF, printer graphics driver pagination, or Chrome print dialog.
  if (PRINT_ENGINE === 'escpos') {
    if (!['58mm', '72mm', '80mm'].includes(width)) {
      const err = new Error('Unsupported receipt width');
      err.code = 'INVALID_PAYLOAD';
      err.stage = 'validation';
      throw err;
    }
    const warmBrowser = await getEscposBrowser();
    const page = await warmBrowser.newPage();
    try {
      await page.setViewport({ width: 600, height: 600, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      // 80mm rolls have ~72mm printable width (576 dots). Keep capture within
      // the printable raster even for generic HTML without receipt-specific CSS.
      const captureWidth = width === '58mm' ? '58mm' : '72mm';
      await page.evaluate(async (fixedWidth) => {
        document.documentElement.style.width = fixedWidth;
        document.body.style.width = fixedWidth;
        document.body.style.maxWidth = fixedWidth;
        document.body.style.boxSizing = 'border-box';
        await document.fonts.ready;
        await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => {})));
      }, captureWidth);
      const element = await page.$('body');
      if (!element) throw new Error('Receipt body not found');
      const png = await element.screenshot({ type: 'png' });
      const commands = buildEscPosFromPng(Buffer.from(png), { cut: printSettings.get().autoCut });
      const spool = await printRawEscPos(commands, { printer, requestId });
      return { printer, width, jobId: spool.jobId, status: spool.status };
    } finally {
      await page.close().catch(() => {});
    }
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const bodyHeightPx = await page.evaluate(() => Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
    ));
    const heightMm = Math.ceil(bodyHeightPx * 0.264583) + 10;

    const pdfBuffer = await page.pdf({
      format: null,
      width,
      height: `${heightMm}mm`,
      printBackground: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    });

    await browser.close();
    browser = null;

    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const pdfPath = path.join(tempDir, `${filePrefix}_${Date.now()}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuffer);

    try {
      await printPdf(pdfPath, { printer, requestId });
    } finally {
      setTimeout(() => {
        try { fs.unlinkSync(pdfPath); } catch (cleanupErr) {
          console.error(`[print-service][${requestId}] temp cleanup failed`, cleanupErr.message);
        }
      }, 5000);
    }

    return { printer, width };
  } catch (error) {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    if (!error.stage) {
      error.stage = error.code === 'INVALID_PAYLOAD' ? 'validation'
        : (String(error.message || '').toLowerCase().includes('printer') ? 'printer_resolution' : 'command');
    }
    if (!error.code) {
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('not found') || msg.includes('cannot find')) error.code = 'PRINTER_NOT_FOUND';
      else if (msg.includes('offline')) error.code = 'PRINTER_OFFLINE';
      else if (msg.includes('spool')) error.code = 'SPOOLER_ERROR';
      else error.code = 'PRINT_COMMAND_FAILED';
    }
    throw error;
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    ok: true,
    service: 'pos-print-service',
    version: '1.1.0',
    printer: PRINTER_NAME,
    adapter: getAdapterMode(),
    engine: PRINT_ENGINE,
    printingEnabled: printSettings.get().enabled,
    note: 'ok means agent is running; not physical printer readiness',
    timestamp: new Date().toISOString(),
  });
});

// This page controls the LOCAL Windows PC, not other branches or the VPS.
// Reject unsupported browser origins even when CORS would only hide the response.
app.use('/settings', (req, res, next) => {
  const origin = req.get('Origin');
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ ok: false, code: 'FORBIDDEN_ORIGIN' });
  }
  return next();
});

app.get('/settings', (req, res) => res.json({
  ok: true,
  ...printSettings.get(),
  printer: PRINTER_NAME,
  engine: PRINT_ENGINE,
  adapter: getAdapterMode(),
  pendingJobs,
  activeJobs,
  lastAcceptedAt,
  scope: 'this-computer',
  physicalPrinterStatus: 'unknown', // RAW accepted !== printed / no Windows hardware probe
}));

app.patch('/settings', (req, res) => {
  try {
    const next = printSettings.update(req.body);
    console.log('[print-service] local settings updated', next);
    return res.json({ ok: true, ...next });
  } catch (err) {
    if (err instanceof TypeError) {
      return res.status(400).json({ ok: false, code: 'INVALID_PAYLOAD', message: err.message });
    }
    console.error('[print-service] save settings failed', err);
    return res.status(500).json({ ok: false, code: 'SETTINGS_SAVE_FAILED' });
  }
});

// Sales receipt (structured JSON → shared template)
app.post('/print/receipt', async (req, res) => {
  const requestId = createRequestId(req.body?.requestId || req.get('X-Request-Id'));
  console.log(`[print-service][${requestId}] request received`, { endpoint: '/print/receipt' });

  try {
    const validation = validateReceiptData(req.body || {});
    if (!validation.valid) {
      return errorResponse(res, 400, {
        requestId,
        stage: 'validation',
        code: validation.code || 'INVALID_PAYLOAD',
        message: validation.error,
      });
    }

    const receiptData = req.body;
    const html = buildReceiptHTML(receiptData);
    const result = await scheduleOnce(requestId, () => printHtmlDocument(html, {
      requestId,
      width: '80mm',
      printer: PRINTER_NAME,
      filePrefix: `receipt_${receiptData.invID}`,
    }), 'invoice');

    return res.json({
      ok: true,
      success: true,
      message: 'Receipt printed successfully',
      invoiceId: receiptData.invID,
      printer: result.printer,
      requestId,
      status: result.status || 'accepted',
      duplicate: Boolean(result.duplicate),
    });
  } catch (error) {
    logErrorDetails(requestId, error, { endpoint: '/print/receipt' });
    return errorResponse(res, error.stage === 'settings' ? 409 : 500, {
      requestId,
      stage: error.stage || 'command',
      code: error.code || 'PRINT_COMMAND_FAILED',
      message: error.message || 'Print failed',
      printer: error.printer || PRINTER_NAME,
    });
  }
});

// Generic HTML print (expenses, booking tickets, custom receipts)
app.post('/print/html', async (req, res) => {
  const requestId = createRequestId(req.body?.requestId || req.get('X-Request-Id'));
  console.log(`[print-service][${requestId}] request received`, {
    endpoint: '/print/html',
    htmlLength: typeof req.body?.html === 'string' ? req.body.html.length : 0,
  });

  try {
    const html = req.body?.html;
    const width = typeof req.body?.width === 'string' && req.body.width ? req.body.width : '80mm';
    const receiptType = req.body?.receiptType || 'other';
    if (!TYPES.includes(receiptType)) {
      return errorResponse(res, 400, { requestId, stage: 'validation', code: 'INVALID_PAYLOAD', message: 'Unknown receiptType' });
    }
    const printer = (typeof req.body?.printer === 'string' && req.body.printer && req.body.printer !== 'default')
      ? req.body.printer
      : PRINTER_NAME;

    const result = await scheduleOnce(requestId, () => printHtmlDocument(html, {
      requestId,
      width,
      printer,
      filePrefix: 'html',
    }), receiptType);

    return res.json({
      ok: true,
      success: true,
      message: 'HTML printed successfully',
      printer: result.printer,
      requestId,
      status: result.status || 'accepted',
      duplicate: Boolean(result.duplicate),
    });
  } catch (error) {
    logErrorDetails(requestId, error, { endpoint: '/print/html' });
    const status = error.code === 'INVALID_PAYLOAD' ? 400 : (String(error.code).startsWith('PRINT_') && error.stage === 'settings' ? 409 : 500);
    return errorResponse(res, status, {
      requestId,
      stage: error.stage || 'command',
      code: error.code || 'PRINT_COMMAND_FAILED',
      message: error.message || 'Print failed',
      printer: error.printer || PRINTER_NAME,
    });
  }
});

// Safe diagnostic test print (short line only — explicit opt-in)
app.post('/print/test', async (req, res) => {
  const requestId = createRequestId(req.body?.requestId || req.get('X-Request-Id'));
  console.log(`[print-service][${requestId}] request received`, { endpoint: '/print/test' });

  const html = `<!DOCTYPE html><html lang="ar"><head><meta charset="utf-8"/><style>
    *{box-sizing:border-box}
    body{margin:0;padding:3mm;width:72mm;font-family:Tahoma,Arial,sans-serif;font-size:19px;line-height:1.45;color:#000;background:#fff}
    .brand{font-size:24px;font-weight:900;text-align:center}
    .arabic{font-size:19px;font-weight:700;text-align:center;direction:rtl;margin:2mm 0}
    .diagnostic{font-size:12px;line-height:1.25;overflow-wrap:anywhere;margin-top:2mm}
  </style></head><body>
    <div class="brand">CUT SALON</div>
    <div class="arabic">اختبار الطباعة - كات صالون</div>
    <div>XP-80 TEXT TEST 123</div>
    <div class="diagnostic">requestId: ${requestId}<br/>${new Date().toISOString()}</div>
  </body></html>`;

  try {
    const result = await scheduleOnce(requestId, () => printHtmlDocument(html, {
      requestId,
      width: '80mm',
      printer: PRINTER_NAME,
      filePrefix: 'test',
    }), 'other');
    return res.json({
      ok: true,
      success: true,
      message: 'Test print completed',
      printer: result.printer,
      requestId,
      mode: req.body?.mode || 'diagnostic',
      status: result.status || 'accepted',
      duplicate: Boolean(result.duplicate),
    });
  } catch (error) {
    logErrorDetails(requestId, error, { endpoint: '/print/test' });
    return errorResponse(res, error.stage === 'settings' ? 409 : 500, {
      requestId,
      stage: error.stage || 'command',
      code: error.code || 'PRINT_COMMAND_FAILED',
      message: error.message || 'Test print failed',
    });
  }
});

function startServer(listenPort = PORT) {
  return app.listen(listenPort, '127.0.0.1', () => {
    console.log(`🖨️  POS Print Service running on http://127.0.0.1:${listenPort}`);
    console.log(`📋 Health: http://127.0.0.1:${listenPort}/health`);
    console.log(`🖨️  Printer: ${PRINTER_NAME} (engine=${PRINT_ENGINE}, adapter=${getAdapterMode()})`);
  });
}

if (require.main === module) {
  startServer();
}

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down print service...');
  process.exit(0);
});

module.exports = {
  app,
  startServer,
  validateReceiptData,
  printHtmlDocument,
  createRequestId,
  PRINTER_NAME,
  closeEscposBrowser,
};
