'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { validateEntry } = require('../local-entry.cjs');

(async () => {
  const project = path.resolve(__dirname, '..');
  const folder = await validateEntry({ kind: 'folder', target: project });
  assert.equal(folder.ok, true, 'an allowed existing folder validates');
  assert.equal(folder.target, path.win32.normalize(project));
  const wrongType = await validateEntry({ kind: 'folder', target: path.join(project, 'package.json') });
  assert.equal(wrongType.ok, false, 'a file cannot be saved as a folder entry');
  const protectedPath = await validateEntry({ kind: 'folder', target: 'D:\\K science\\R 软件资料' });
  assert.equal(protectedPath.ok, false, 'protected path remains rejected before filesystem access');
  console.log('folder entry checks passed: existing folder, type mismatch, and protected-path rejection');
})().catch((error) => { console.error(error); process.exitCode = 1; });
