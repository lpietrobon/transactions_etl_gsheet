const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createSandbox(overrides = {}) {
  const sandbox = {
    console,
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: () => {
        throw new Error('Utilities.computeDigest mock not provided');
      },
      parseDate: () => {
        throw new Error('Utilities.parseDate mock not provided');
      }
    },
    ...overrides
  };
  sandbox.global = sandbox;
  return sandbox;
}

function loadAppsScript(files, overrides = {}) {
  const sandbox = createSandbox(overrides);
  const context = vm.createContext(sandbox);
  files.forEach(file => {
    const filePath = path.resolve(__dirname, '..', file);
    const code = fs.readFileSync(filePath, 'utf8');
    vm.runInContext(code, context, { filename: file });
  });
  context.__runInContext = expr => vm.runInContext(expr, context);
  return context;
}

module.exports = { loadAppsScript };
