'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const output = path.resolve(__dirname, '../test-results/visual-polish');
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const watchdog = setTimeout(() => { console.error('FAIL: visual page test timed out'); app.exit(1); }, 40000);

app.whenReady().then(async () => {
  await fs.mkdir(output, { recursive: true });
  let isolatedConfig = null;
  let failNextSave = false;
  ipcMain.handle('test:load', () => ({ config: isolatedConfig, recovered: false }));
  ipcMain.handle('test:save', (_event, config) => {
    if (failNextSave) { failNextSave = false; throw new Error('synthetic save failure'); }
    isolatedConfig = JSON.parse(JSON.stringify(config));
    return true;
  });
  ipcMain.handle('test:fail-save', () => { failNextSave = true; return true; });
  const win = new BrowserWindow({
    show: false, width: 1440, height: 950,
    webPreferences: {
      preload: path.join(__dirname, 'ui-smoke-preload.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
    }
  });
  const gone = [];
  win.webContents.on('render-process-gone', (_event, detail) => gone.push(detail.reason));
  await win.loadFile(path.resolve(__dirname, '../src/index.html'));
  const run = code => win.webContents.executeJavaScript(code, true);
  const settle = () => new Promise(resolve => setTimeout(resolve, 120));
  await settle();
  assert.equal(await run(`document.querySelector('#workspace') !== null && document.querySelector('#sceneNav').children.length === 5`), true, 'normal initialization completed');

  const measure = async () => run(`(() => {
    const shell = document.querySelector('.shell').getBoundingClientRect();
    const workspace = document.querySelector('#workspace').getBoundingClientRect();
    const buttons = [...document.querySelectorAll('.btn')].filter(node => getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().height > 0);
    return {
      bodyOverflow: document.documentElement.scrollWidth > innerWidth + 2,
      shellWidth: shell.width,
      workspaceWidth: workspace.width,
      minButtonHeight: Math.min(...buttons.map(node => node.getBoundingClientRect().height)),
      displaySettings: document.querySelectorAll('.display-settings').length,
      workspaceStyle: getComputedStyle(document.querySelector('#workspace')).gridTemplateColumns,
      cards: [...document.querySelectorAll('#workspace > .card')].filter(node => !node.hidden).map(node => ({ card: node.dataset.card, width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth })),
      overflowNodes: [...document.querySelectorAll('*')].filter(node => node.scrollWidth > node.clientWidth + 2).slice(0, 6).map(node => ({ tag: node.tagName, id: node.id, className: node.className, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }))
    };
  })()`);
  const checks = [];
  for (const width of [1440, 900, 590]) {
    win.setContentSize(width, 950);
    await settle();
    const geometry = await measure();
    assert.equal(geometry.bodyOverflow, false, `horizontal overflow at ${width}px: ${JSON.stringify(geometry)}`);
    assert(geometry.workspaceWidth <= geometry.shellWidth + 1, `workspace exceeds shell at ${width}px`);
    assert(geometry.minButtonHeight >= 28, `visible buttons are too small at ${width}px`);
    checks.push(`warm ${width}px`);
  }

  win.setContentSize(1440, 950);
  await run(`state.scene='总览';render();`);
  await settle();
  await fs.writeFile(path.join(output, 'overview.png'), (await win.webContents.capturePage()).toPNG());
  await run(`state.scene='🏠 生活';render();`);
  await fs.writeFile(path.join(output, 'life.png'), (await win.webContents.capturePage()).toPNG());
  await run(`document.querySelector('#editBtn').click();`);
  await settle();
  assert.equal(await run(`document.querySelectorAll('.display-settings').length`), 3);
  await run(`document.querySelector('.display-settings summary').click();`);
  await settle();
  assert.equal(await run(`(() => { const d=document.querySelector('.display-settings-body'); const r=d.getBoundingClientRect(); return r.width>0 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1; })()`), true, 'display settings stays inside the card viewport');
  await fs.writeFile(path.join(output, 'edit.png'), (await win.webContents.capturePage()).toPNG());
  await run(`document.querySelector('#cancelEditBtn').click();`);
  await settle();
  await run(`document.querySelector('#settingsBtn').click();`);
  await settle();
  await fs.writeFile(path.join(output, 'settings.png'), (await win.webContents.capturePage()).toPNG());
  await run(`document.querySelector('#settingsDialog').close();document.querySelector('#editBtn').click();`);
  await settle();
  await run(`(() => { const s=document.querySelector('[data-layout-setting="spacing"]'); s.value='spacious'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await run(`(async()=>{await testControl.failNextSave();document.querySelector('#editBtn').click();})()`);
  await settle();
  assert.equal(await run(`editing===true && document.querySelector('#editBtn').textContent==='保存布局'`), true, 'failed layout save keeps the edit draft');
  await run(`document.querySelector('#cancelEditBtn').click();`);
  await settle();
  await run(`document.querySelector('#editBtn').click();`);
  await settle();
  await run(`(() => { const s=document.querySelector('[data-layout-setting="spacing"]'); s.value='spacious'; s.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#editBtn').click(); })()`);
  await settle();
  await win.loadFile(path.resolve(__dirname, '../src/index.html'));
  await settle();
  await run(`document.querySelector('#editBtn').click();`);
  await settle();
  assert.equal(await run(`document.querySelector('[data-layout-setting="spacing"]').value==='spacious'`), true, 'saved layout survives a renderer restart');
  await run(`document.querySelector('#cancelEditBtn').click();`);
  await settle();

  for (const theme of ['peach', 'night']) {
    await run(`editing=false;state.scene='总览';state.theme='${theme}';render();`);
    await settle();
    const geometry = await measure();
    assert.equal(geometry.bodyOverflow, false, `${theme} theme overflow`);
    checks.push(theme);
  }
  assert.equal(gone.length, 0, gone.join(','));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, pageLoaded: true, themes: ['warm', 'peach', 'night'], screenshots: ['overview.png', 'life.png', 'edit.png', 'settings.png'] }, null, 2));
  console.log(JSON.stringify({ passed: checks.length + 4, report: path.join(output, 'report.json') }));
  clearTimeout(watchdog);
  win.destroy();
  app.exit(0);
}).catch(error => {
  console.error(error);
  clearTimeout(watchdog);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 0);
});
