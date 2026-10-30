'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSettingsStore, assertAllowed } = require('./printSettings');

describe('Local workstation print settings', () => {
  it('persists pause, cutter, and receipt-type switches across restarts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cut-print-settings-test-'));
    const file = path.join(dir, 'config.json');
    try {
      const store = createSettingsStore(file);
      assert.equal(store.get().enabled, true);
      store.update({ enabled: false, autoCut: true, types: { expense: false } });
      const loaded = createSettingsStore(file);
      assert.deepEqual(loaded.get(), {
        enabled: false, autoCut: true,
        types: { invoice: true, expense: false, deduction: true, other: true },
      });
      assert.throws(() => assertAllowed(loaded.get(), 'invoice'), { code: 'PRINT_DISABLED' });
      loaded.update({ enabled: true });
      assert.throws(() => assertAllowed(loaded.get(), 'expense'), { code: 'PRINT_TYPE_DISABLED' });
      assert.doesNotThrow(() => assertAllowed(loaded.get(), 'invoice'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unknown fields, unsafe strings and non-boolean updates', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cut-print-settings-test-'));
    const file = path.join(dir, 'config.json');
    try {
      const store = createSettingsStore(file);
      const before = store.get();
      for (const patch of [{ printer: 'another' }, { autoCut: 'yes' },
        { types: { unknown: false } }, { types: { invoice: 1 } }, {}]) {
        assert.throws(() => store.update(patch), TypeError);
      }
      assert.deepEqual(store.get(), before);
      assert.equal(fs.existsSync(file), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails closed on a corrupted existing settings file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cut-print-settings-test-'));
    const file = path.join(dir, 'config.json');
    try {
      fs.writeFileSync(file, '{ malformed');
      assert.equal(createSettingsStore(file).get().enabled, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
