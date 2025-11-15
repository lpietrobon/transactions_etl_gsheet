// Core Node modules used to emulate the Apps Script runtime.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_SCRIPT_FILES = ['config.gs', 'alerting.gs', 'ingestion.gs', 'rules.gs'];

const DigestAlgorithm = { SHA_256: 'sha256' };

// Lightweight utilities that mimic the pieces of Apps Script's Utilities service
// used throughout the project. Jest runs in Node so we recreate the relevant
// behaviours in plain JavaScript.
function parseCsv(text) {
  if (typeof text !== 'string') {
    return [['']];
  }
  if (text === '') {
    return [['']];
  }

  const rows = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const lineCount = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;

  for (let index = 0; index < lineCount; index += 1) {
    const line = lines[index];
    const cells = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (char === ',' && !inQuotes) {
        cells.push(current);
        current = '';
        continue;
      }
      current += char;
    }

    cells.push(current);
    rows.push(cells);
  }

  return rows.length ? rows : [['']];
}

function parseDate(value, _timezone, pattern) {
  const str = String(value ?? '').trim();
  if (!str) {
    throw new Error('Empty date string');
  }

  if (!pattern) {
    const asDate = new Date(str);
    if (Number.isNaN(asDate.getTime())) {
      throw new Error(`Unparseable date "${str}"`);
    }
    return asDate;
  }

  const tokens = pattern.split(/[^A-Za-z]+/).filter(Boolean);
  const parts = str.split(/\D+/).map(Number);
  if (tokens.length !== parts.length) {
    throw new Error(`Unparseable date "${str}" with pattern ${pattern}`);
  }

  const lookup = Object.create(null);
  tokens.forEach((token, index) => {
    lookup[token] = parts[index];
  });

  const year = lookup.yyyy ?? lookup.yy;
  const month = lookup.MM ?? lookup.M;
  const day = lookup.dd ?? lookup.d;
  const parsed = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Unparseable date "${str}" with pattern ${pattern}`);
  }

  return parsed;
}

function computeDigest(algorithm, value) {
  const hash = crypto.createHash(algorithm);
  hash.update(typeof value === 'string' ? value : String(value));
  return Array.from(hash.digest());
}

function throwingStub(name) {
  return () => {
    throw new Error(`${name} not implemented in tests`);
  };
}

// Default mocks for Google services so tests can interact with the Apps Script
// source without hitting real APIs. Individual tests can override any entry by
// passing replacements into loadAppsScript.
const defaultSandboxValues = {
  console,
  Utilities: {
    DigestAlgorithm,
    parseCsv,
    parseDate,
    computeDigest,
  },
  DriveApp: {
    getFolderById: throwingStub('DriveApp.getFolderById'),
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: throwingStub('SpreadsheetApp.getActiveSpreadsheet'),
  },
  ScriptApp: {
    newTrigger() {
      const chain = {
        timeBased() { return chain; },
        everyHours() { return chain; },
        create() { return null; },
      };
      return chain;
    },
  },
  MailApp: {
    sendEmail() {},
  },
  MimeType: { CSV: 'text/csv' },
};

function loadAppsScript(overrides = {}) {
  // Build a context that looks enough like Apps Script for the evaluated files
  // to run. The returned sandbox exposes globals defined by the source files so
  // tests can call internal helpers directly.
  const sandbox = { ...defaultSandboxValues, ...overrides };
  sandbox.global = sandbox;

  const context = vm.createContext(sandbox);
  for (const file of APP_SCRIPT_FILES) {
    const source = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }

  return sandbox;
}

module.exports = { loadAppsScript };
