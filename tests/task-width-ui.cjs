'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');

app.setPath('userData', path.join(__dirname, '../test-results/task-width/profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

const watchdog = setTimeout(() => { console.error('FAIL: task width page test timed out'); app.exit(1); }, 30000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'ui-smoke-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  const gone = [];
  win.webContents.on('render-process-gone', (_event, detail) => gone.push(detail.reason));
  await win.loadFile(path.resolve(__dirname, '../src/index.html'));
  const run = code => win.webContents.executeJavaScript(code, true);
  const wait = () => new Promise(resolve => setTimeout(resolve, 100));

  // Old saved layouts using focus-apps/focus-side are migrated to the uniform rule.
  const migrated = await run(`(() => {
    const saved = clone(defaults);
    saved.scenes['🔬 科研'].layout.focus = 'apps';
    saved.scenes['🏠 生活'].layout.focus = 'side';
    const normalized = normalizeWithModules(saved);
    return SCENES.map(scene => normalized.scenes[scene].layout.focus);
  })()`);
  assert.deepEqual(migrated, ['normal', 'normal', 'normal', 'normal', 'normal']);

  await run(`state=normalizeWithModules(clone(defaults));render();`);
  for (const width of [1440, 1100, 900, 760, 590, 390]) {
    win.setContentSize(width, 900);
    await wait();
    const values = await run(`(() => {
      const result = {};
      for (const scene of SCENES) {
        state.scene = scene;
        render();
        const node = document.querySelector('[data-card="tasks"]');
        result[scene] = { width: Math.round(node.getBoundingClientRect().width * 10) / 10, template: getComputedStyle(document.querySelector('#workspace')).gridTemplateColumns };
      }
      return result;
    })()`);
    const widths = Object.values(values).map(value => value.width);
    assert(widths.every(value => value > 0), `task card not visible at ${width}px: ${JSON.stringify(values)}`);
    assert(Math.max(...widths) - Math.min(...widths) <= 1, `unequal task widths at ${width}px: ${JSON.stringify(values)}`);
  }

  const controls = await run(`(() => {
    state.scene = '🔬 科研'; editing = true; renderLayout();
    return document.querySelectorAll('[data-size]').length === 0
      && document.querySelectorAll('.display-settings').length === 3
      && [...document.querySelectorAll('.display-settings')].every(node => getComputedStyle(node).display !== 'none');
  })()`);
  assert.equal(controls, true, 'display settings should replace inactive width controls');
  assert.equal(gone.length, 0, gone.join(','));
  console.log(JSON.stringify({ passed: 8, widthsUniform: true, legacyFocusMigrated: true }));
  clearTimeout(watchdog);
  win.destroy();
  app.exit(0);
}).catch(error => {
  console.error(error);
  clearTimeout(watchdog);
  app.exit(1);
});
