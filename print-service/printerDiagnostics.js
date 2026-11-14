'use strict';

// Read-only, best-effort Windows spooler probe. Never prints or mutates Windows settings.
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execAsync = promisify(execFile);

async function diagnoseWindowsPrinter(printerName, options = {}) {
  const platform = options.platform || process.platform;
  const execute = options.execute || execAsync;
  const base = { printerName, physicalPrinterStatus: 'unknown' };
  if (platform !== 'win32') {
    return { ...base, probe: 'unsupported', printerFound: null, spoolerStatus: 'unknown', queuedJobs: null };
  }
  try {
    const script = path.join(__dirname, 'windows', 'diagnose-printer.ps1');
    const { stdout } = await execute('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, '-PrinterName', printerName,
    ], { timeout: 6000, windowsHide: true, maxBuffer: 16384 });
    const output = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim());
    return {
      ...base,
      probe: 'ok',
      printerFound: output.found === true,
      printerStatus: typeof output.status === 'string' ? output.status : 'unknown',
      spoolerStatus: typeof output.spooler === 'string' ? output.spooler : 'unknown',
      queuedJobs: Number.isInteger(output.queuedJobs) && output.queuedJobs >= 0 ? output.queuedJobs : null,
    };
  } catch (error) {
    console.warn('[print-service] diagnostic probe failed', { code: error.code || 'PROBE_FAILED', message: error.message });
    return { ...base, probe: 'failed', printerFound: null, spoolerStatus: 'unknown', queuedJobs: null };
  }
}
module.exports = { diagnoseWindowsPrinter };
