// Operational scripts under src/scripts are excluded from coverage and have no
// unit tests, so a bad merge can leave one unparseable without CI noticing
// (seed-collection.js shipped with a duplicate const after #556). Parse each
// one; do not require() them — most run main() on load.
const { execFileSync } = require('child_process');
const { readdirSync, statSync } = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../src/scripts');

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (name === 'node_modules') return [];
    if (statSync(p).isDirectory()) return jsFiles(p);
    return name.endsWith('.js') ? [p] : [];
  });
}

describe('src/scripts parse', () => {
  test.each(jsFiles(ROOT).map((f) => [path.relative(ROOT, f), f]))('%s', (_rel, file) => {
    expect(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })).not.toThrow();
  });
});
