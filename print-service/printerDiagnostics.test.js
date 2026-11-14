'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { diagnoseWindowsPrinter } = require('./printerDiagnostics');
describe('read-only Windows printer diagnostics', () => {
  it('reports selected printer without claiming physical printing', async () => {
    let command;
    const result = await diagnoseWindowsPrinter('XP-80', {
      platform: 'win32',
      execute: async (executable, args, opts) => {
        command = { executable, args, opts };
        return { stdout: '{"found":true,"status":"Normal","spooler":"Running","queuedJobs":2}' };
      },
    });
    assert.equal(command.executable, 'powershell.exe');
    assert.equal(command.args.at(-1), 'XP-80');
    assert.equal(command.opts.timeout, 6000);
    assert.equal(result.printerFound, true);
    assert.equal(result.spoolerStatus, 'Running');
    assert.equal(result.queuedJobs, 2);
    assert.equal(result.physicalPrinterStatus, 'unknown');
  });
  it('detects missing printer and tolerates missing spool counts', async () => {
    const result = await diagnoseWindowsPrinter('Receipt USB', {
      platform: 'win32', execute: async () => ({ stdout: '{"found":false,"status":"not-found","spooler":"Running","queuedJobs":null}' }),
    });
    assert.equal(result.printerFound, false);
    assert.equal(result.queuedJobs, null);
  });
  it('returns unknown on unsupported OS or failed PowerShell', async () => {
    assert.equal((await diagnoseWindowsPrinter('XP-80', { platform: 'linux' })).probe, 'unsupported');
    const fail = await diagnoseWindowsPrinter('XP-80', { platform: 'win32', execute: async () => { throw Error('timeout'); } });
    assert.equal(fail.probe, 'failed');
    assert.equal(fail.printerFound, null);
  });
});
