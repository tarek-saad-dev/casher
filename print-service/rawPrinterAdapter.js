'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

/**
 * ESC/POS requires a printer/driver that accepts RAW spool jobs.
 * This does NOT send a graphical job through the XP-80 Windows driver.
 * A successful return means Windows accepted the job, not that paper exited.
 */
async function printRawEscPos(bytes, { printer, requestId, exec = execFileAsync } = {}) {
  if (!printer || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 2 * 1024 * 1024) {
    const err = new Error('Invalid RAW print job');
    err.code = 'INVALID_PAYLOAD';
    throw err;
  }
  if (process.env.PRINT_ADAPTER === 'mock') {
    return { mode: 'mock', printer, jobId: 'mock', status: 'accepted' };
  }
  if (process.platform !== 'win32') {
    const err = new Error('ESC/POS Windows RAW mode requires Windows');
    err.code = 'PRINT_COMMAND_FAILED';
    throw err;
  }
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cut-escpos-'));
  const tempFile = path.join(tempDir, 'receipt.bin');
  try {
    await fs.writeFile(tempFile, bytes, { flag: 'wx' });
    const script = path.join(__dirname, 'windows-raw-print.ps1');
    const { stdout } = await exec('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', script, printer, tempFile,
    ], { timeout: 30000, windowsHide: true, maxBuffer: 65536 });
    const match = /SPOOLED:(\d+)/.exec(stdout || '');
    if (!match) throw new Error('Windows did not confirm spool job acceptance');
    console.log('[print-service] ESC/POS queued', { requestId, printer, jobId: match[1], bytes: bytes.length });
    return { mode: 'escpos', printer, jobId: match[1], status: 'accepted' };
  } catch (err) {
    err.stage = 'spooler';
    err.code = err.code || 'SPOOLER_ERROR';
    throw err;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { printRawEscPos };
