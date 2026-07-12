'use strict';

/**
 * Printer adapter — isolates Windows spooler / pdf-to-printer so tests can mock it.
 * Set PRINT_ADAPTER=mock to skip real printing (CI / diagnostics without paper).
 */

const fs = require('fs');
const path = require('path');

const MODE = (process.env.PRINT_ADAPTER || 'real').toLowerCase();

/**
 * @param {string} pdfPath
 * @param {{ printer: string, requestId?: string }} options
 * @returns {Promise<{ ok: true, mode: string, printer: string }>}
 */
async function printPdf(pdfPath, options) {
  const printer = options.printer;
  const requestId = options.requestId || 'n/a';

  if (!pdfPath || !fs.existsSync(pdfPath)) {
    const err = new Error(`PDF file not found: ${pdfPath}`);
    err.code = 'PDF_NOT_FOUND';
    err.stage = 'spooler';
    throw err;
  }

  if (MODE === 'mock') {
    console.log(`[print-service][${requestId}] mock adapter — skip spooler`, {
      printer,
      pdf: path.basename(pdfPath),
    });
    return { ok: true, mode: 'mock', printer };
  }

  const { print } = require('pdf-to-printer');
  console.log(`[print-service][${requestId}] spool command started`, { printer });
  try {
    await print(pdfPath, { printer, silent: true });
    console.log(`[print-service][${requestId}] spool command completed`, { printer });
    return { ok: true, mode: 'real', printer };
  } catch (error) {
    error.stage = error.stage || 'spooler';
    error.code = error.code || 'SPOOLER_ERROR';
    error.printer = printer;
    error.stdout = error.stdout || undefined;
    error.stderr = error.stderr || undefined;
    throw error;
  }
}

function getAdapterMode() {
  return MODE;
}

module.exports = { printPdf, getAdapterMode };
