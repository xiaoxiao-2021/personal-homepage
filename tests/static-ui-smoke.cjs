'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.resolve(__dirname, '../src/index.html'), 'utf8');
const renderer = fs.readFileSync(path.resolve(__dirname, '../src/renderer.js'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const unique = new Set(ids);
assert.equal(unique.size, ids.length, 'HTML IDs are unique');
const queriedIds = [...renderer.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((match) => match[1]);
const missing = [...new Set(queriedIds)].filter((id) => !unique.has(id));
assert.deepEqual(missing, [], `all direct renderer ID queries exist in HTML: ${missing.join(', ')}`);
for (const feature of ['data-layout-height="apps"', 'data-layout-setting="entryStyle"', 'data-view-toggle="showUnsetEntries"', 'id="modeInfoDialog"', 'id="didaInfo"', 'id="startupDialog"', 'id="startupEnabled"', 'id="startupMode"', 'id="startupDelay"', 'id="startupStatus"', 'id="aboutInfo"']) {
  assert.ok(html.includes(feature), `markup includes ${feature}`);
}
console.log(`static UI checks passed: ${ids.length} unique markup IDs; ${new Set(queriedIds).size} direct renderer selectors resolve`);
