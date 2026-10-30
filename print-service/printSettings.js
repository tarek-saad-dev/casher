'use strict';

// Printer controls are workstation-local. They are never stored on the VPS or in SQL.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SETTINGS_FILE = process.env.PRINT_SETTINGS_FILE ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cut-salon'), 'CUT-Salon', 'print-settings.json');

const TYPES = Object.freeze(['invoice', 'expense', 'deduction', 'other']);

function defaults() {
  return {
    enabled: true,
    autoCut: process.env.PRINTER_AUTO_CUT === '1',
    types: { invoice: true, expense: true, deduction: true, other: true },
  };
}

function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function validateUpdate(patch) {
  if (!isObject(patch) || !Object.keys(patch).length ||
      Object.keys(patch).some(k => !['enabled', 'autoCut', 'types'].includes(k))) {
    throw new TypeError('Only enabled, autoCut and types can be changed.');
  }
  for (const key of ['enabled', 'autoCut']) {
    if (Object.hasOwn(patch, key) && typeof patch[key] !== 'boolean') {
      throw new TypeError(key + ' must be boolean.');
    }
  }
  if (Object.hasOwn(patch, 'types')) {
    if (!isObject(patch.types) || !Object.keys(patch.types).length ||
        Object.keys(patch.types).some(k => !TYPES.includes(k) || typeof patch.types[k] !== 'boolean')) {
      throw new TypeError('Invalid receipt type switches.');
    }
  }
}

function sanitize(saved) {
  const base = defaults();
  if (!isObject(saved)) return base;
  if (typeof saved.enabled === 'boolean') base.enabled = saved.enabled;
  if (typeof saved.autoCut === 'boolean') base.autoCut = saved.autoCut;
  if (isObject(saved.types)) {
    for (const type of TYPES) {
      if (typeof saved.types[type] === 'boolean') base.types[type] = saved.types[type];
    }
  }
  return base;
}

function createSettingsStore(filePath = SETTINGS_FILE) {
  let value = defaults();
  try {
    if (fs.existsSync(filePath)) value = sanitize(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (err) {
    console.error('[print-service] Could not load printer settings:', err.message);
    // Fail closed if an existing settings file is corrupt: avoid surprise receipts.
    value.enabled = false;
  }
  return {
    get() {
      return { ...value, types: { ...value.types } };
    },
    update(patch) {
      validateUpdate(patch);
      const next = {
        ...value,
        ...patch,
        types: { ...value.types, ...(patch.types || {}) },
      };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = filePath + '.tmp';
      try {
        fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(tmp, filePath);
      } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      }
      value = next;
      return this.get();
    },
  };
}

function assertAllowed(config, type) {
  if (!config.enabled) {
    const err = new Error('Printing is paused from the printer control center.');
    err.code = 'PRINT_DISABLED';
    err.stage = 'settings';
    throw err;
  }
  if (!TYPES.includes(type)) type = 'other';
  if (!config.types[type]) {
    const err = new Error('This receipt type is disabled from the printer control center.');
    err.code = 'PRINT_TYPE_DISABLED';
    err.stage = 'settings';
    throw err;
  }
}

module.exports = { createSettingsStore, validateUpdate, assertAllowed, TYPES };
