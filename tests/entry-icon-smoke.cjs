'use strict';

const assert = require('node:assert/strict');
const { createEntryIconResolver, MAX_ICON_BYTES } = require('../entry-icon.cjs');

async function run() {
  const entries = {
    app: { kind: 'application', target: 'C:\\synthetic\\safe.exe' },
    web: { kind: 'website', target: 'https://example.invalid/' },
    demo: { kind: 'demo', target: '' },
    denied: { kind: 'file', target: 'D:\\K science\\R 软件资料\\never-open.txt' },
    failed: { kind: 'file', target: 'C:\\synthetic\\fail.txt' },
    oversized: { kind: 'file', target: 'C:\\synthetic\\large.txt' }
  };
  const calls = [];
  let shouldFail = false;
  let largeIcon = false;
  const app = {
    async getFileIcon(target) {
      calls.push(target);
      if (shouldFail) throw new Error('synthetic icon failure');
      return {
        isEmpty: () => false,
        resize: () => ({ toPNG: () => Buffer.alloc(largeIcon ? MAX_ICON_BYTES + 1 : 24, 7) })
      };
    }
  };
  const resolver = createEntryIconResolver({
    app,
    getEntryById: async (id) => entries[id] || null,
    validateEntry: async ({ kind, target }) => {
      if (target.toLowerCase().startsWith('d:\\k science\\r 软件资料')) return { ok: false };
      if (kind === 'website') return { ok: true, target };
      return { ok: true, target };
    }
  });

  assert.equal((await resolver('app')).kind, 'system', 'configured local entry yields bounded PNG data');
  const firstCount = calls.length;
  assert.equal((await resolver('app')).kind, 'system', 'repeated lookup returns cached icon');
  assert.equal(calls.length, firstCount, 'cache avoids a second native icon extraction');
  assert.equal((await resolver('web')).kind, 'website', 'website uses local generic icon marker');
  assert.equal((await resolver('demo')).kind, 'placeholder', 'unset demo entry keeps placeholder');
  assert.equal((await resolver('missing')).kind, 'fallback', 'unknown ID returns fallback');
  assert.equal((await resolver('denied')).kind, 'fallback', 'protected target is rejected');
  assert(!calls.some((target) => target.toLowerCase().startsWith('d:\\k science\\r 软件资料')), 'protected target never reaches Electron icon API');

  entries.app.target = 'C:\\synthetic\\changed.exe';
  assert.equal((await resolver('app')).kind, 'system', 'changed target gets a refreshed icon');
  assert(calls.includes(entries.app.target), 'updated target reaches icon extractor after validation');

  shouldFail = true;
  assert.equal((await resolver('failed')).kind, 'fallback', 'native extraction failure is harmless');
  shouldFail = false;
  largeIcon = true;
  assert.equal((await resolver('oversized')).kind, 'fallback', 'oversized icon is rejected');
  console.log('entry icon isolated checks passed: system icon, cache, address change, generic website, demo fallback, protected path, extraction failure, size cap');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
