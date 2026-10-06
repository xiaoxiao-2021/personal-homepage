'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const output = path.resolve(__dirname, '../test-results/clean-layout-tools');
const configFile = path.join(output, 'isolated-config.json');
const scenes = ['总览', '🏥 临床', '🔬 科研', '📚 学习', '🏠 生活'];
const clone = value => JSON.parse(JSON.stringify(value));
const layout = () => ({
  order: ['tasks', 'apps', 'side'], focus: 'normal',
  heights: { tasks: 'medium', apps: 'tall', side: 'medium' },
  entrySize: 'large', spacing: 'comfortable', entryStyle: 'tiles', showUnsetEntries: true,
  modules: {
    visible: { tasks: true, apps: true, side: true, time: true, calendar: true, music: true },
    order: ['tasks', 'apps', 'side', 'time', 'calendar', 'music'],
    sizes: { tasks: 'medium', apps: 'medium', side: 'medium', time: 'medium', calendar: 'medium', music: 'medium' }
  }
});
const initialConfig = {
  version: 1, scene: '总览', theme: 'warm', shortcut: 'Control+Alt+H', didaListIds: {},
  appearance: { wallpaper: '', glass: 'frosted', dim: 8, fit: 'cover', position: 'center', renderQuality: 'smooth' },
  taskView: { range: 'scene', dates: 'all', inboxProjectId: '' },
  taskViews: Object.fromEntries(scenes.map(scene => [scene, { range: 'scene', dates: 'all', inboxProjectId: '' }])),
  tools: { version: 1, visible: { time: true, calendar: true, music: true }, order: ['time', 'calendar', 'music'], sizes: { time: 'medium', calendar: 'medium', music: 'medium' }, musicCollapsed: false },
  music: { tracks: [], volume: .8, lastTrackId: '', lastTime: 0 },
  library: {
    tool: { name: '合成工具', type: '软件', icon: '▣', description: '隔离测试入口' },
    sharedProject: { name: '合成项目资料', type: '项目', icon: '◈', description: '验证同一入口 ID', kind: 'website', target: 'https://example.invalid/' }
  },
  scenes: Object.fromEntries(scenes.map(scene => [scene, {
    apps: ['tool'], side: [['当前项目', 'sharedProject']], layout: layout()
  }]))
};

app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const watchdog = setTimeout(() => { console.error('FAIL: clean layout/tools UI test timed out'); app.exit(1); }, 60000);

async function main() {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(configFile, JSON.stringify(initialConfig, null, 2));
  await app.whenReady();

  let ready = 0;
  let saveCount = 0;
  const errors = [];
  ipcMain.handle('test:load', async () => ({ config: JSON.parse(await fs.readFile(configFile, 'utf8')), recovered: false }));
  ipcMain.handle('test:save', async (_event, config) => {
    saveCount++;
    await fs.writeFile(configFile, JSON.stringify(config, null, 2));
    return true;
  });
  ipcMain.handle('test:fail-save', () => false);
  ipcMain.handle('test:launch-entry', () => ({ ok: true, launchRequested: true }));
  ipcMain.handle('test:hide', () => true);
  ipcMain.on('test:page-ready', () => ready++);
  ipcMain.on('test:music-state', () => {});
  ipcMain.on('test:page-error', (_event, message) => errors.push(String(message)));

  const win = new BrowserWindow({
    show: false, width: 1440, height: 1050,
    webPreferences: {
      preload: path.join(__dirname, 'ui-smoke-preload.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
    }
  });
  win.webContents.on('did-fail-load', (_event, code, description) => errors.push(`load ${code}: ${description}`));
  win.webContents.on('render-process-gone', (_event, detail) => errors.push(`renderer: ${detail.reason}`));
  const run = code => win.webContents.executeJavaScript(code, true);
  const until = async (expression, message = expression) => {
    for (let index = 0; index < 80; index++) {
      if (await run(expression)) return;
      await wait(50);
    }
    throw new Error(`Timed out: ${message}`);
  };
  const load = async () => {
    const previous = ready;
    await win.loadFile(path.resolve(__dirname, '../src/index.html'));
    for (let index = 0; index < 80 && ready === previous; index++) await wait(50);
    assert(ready > previous, 'pageReady must be emitted after normal initialization');
    await until(`document.querySelectorAll('#sceneNav [data-scene]').length===5`, 'scene navigation ready');
  };

  await load();
  assert.equal(await run(`document.querySelector('.apps-card h2').textContent.trim()`), '常用入口');
  const initialOverview = await run(`JSON.stringify(state.scenes['总览'])`);
  const initialClinical = await run(`JSON.stringify(state.scenes['🏥 临床'])`);
  const initialTools = await run(`JSON.stringify(state.tools)`);
  const initialMusic = await run(`JSON.stringify(state.music)`);

  // Clean-layout preview is a real edit draft: cancel must restore every field.
  await run(`document.querySelector('#editBtn').click()`);
  await until(`editing===true && !document.querySelector('#cleanLayoutBtn').hidden`, 'clean layout action visible in edit mode');
  await run(`document.querySelector('#cleanLayoutBtn').click()`);
  assert.equal(await run(`state.scenes['总览'].layout.modules.visible.side===false`), true, 'clean preview hides only the current scene side module');
  assert.equal(await run(`state.scenes['总览'].layout.heights.apps`), 'content', 'clean preview makes apps follow content');
  assert.equal(await run(`state.scenes['总览'].layout.heights.tasks`), 'medium', 'clean preview preserves task height');
  assert.equal(await run(`state.scenes['总览'].layout.entrySize`), 'large', 'clean preview preserves entry size');
  assert.equal(await run(`JSON.stringify(state.scenes['🏥 临床'])`), initialClinical, 'another scene is not changed by current-scene preview');
  await run(`document.querySelector('#cancelEditBtn').click()`);
  assert.equal(await run(`JSON.stringify(state.scenes['总览'])`), initialOverview, 'cancel restores the whole current scene');
  assert.equal(await run(`JSON.stringify(state.tools)`), initialTools, 'cancel restores global tool draft');
  assert.equal(await run(`JSON.stringify(state.music)`), initialMusic, 'layout cancel does not alter the independently stored playlist');

  // Save to a real isolated JSON file and reload the renderer.
  await run(`document.querySelector('#editBtn').click();document.querySelector('#cleanLayoutBtn').click();document.querySelector('#editBtn').click()`);
  await until(`editing===false && !layoutSaveInFlight`, 'clean layout save completed');
  let stored = JSON.parse(await fs.readFile(configFile, 'utf8'));
  assert.equal(stored.scenes['总览'].layout.modules.visible.side, false);
  assert.equal(stored.scenes['总览'].layout.heights.apps, 'content');
  assert.equal(stored.scenes['🏥 临床'].layout.modules.visible.side, true);
  await load();
  assert.equal(await run(`state.scenes['总览'].layout.modules.visible.side===false && document.querySelector('.side-card').hidden`), true, 'saved clean layout survives reload');

  // A project/material reference joins apps with exactly the same stable ID.
  await run(`document.querySelectorAll('#sceneNav [data-scene]')[1].click()`);
  await until(`state.scene==='🏥 临床' && document.querySelector('[data-entry="sharedProject"][data-entry-area="side"]')`, 'clinical side entry rendered');
  const libraryCount = await run(`Object.keys(state.library).length`);
  await run(`(() => { const node=document.querySelector('[data-entry="sharedProject"][data-entry-area="side"]'); const rect=node.getBoundingClientRect(); node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.left+8,clientY:rect.top+8})); })()`);
  assert.equal(await run(`!document.querySelector('#contextAddToApps').hidden`), true, 'side menu exposes add-to-apps for a missing app reference');
  await run(`document.querySelector('#contextAddToApps').click()`);
  assert.equal(await run(`editing && state.scenes['🏥 临床'].apps.filter(id=>id==='sharedProject').length===1`), true, 'same ID is added once to apps');
  assert.equal(await run(`state.scenes['🏥 临床'].side.some(([,id])=>id==='sharedProject')`), true, 'original side reference is retained');
  assert.equal(await run(`Object.keys(state.library).length`), libraryCount, 'joining apps does not clone the library entry');
  await run(`(() => { const node=document.querySelector('[data-entry="sharedProject"][data-entry-area="side"]'); const rect=node.getBoundingClientRect(); node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.left+8,clientY:rect.top+8})); })()`);
  assert.equal(await run(`document.querySelector('#contextAddToApps').disabled`), true, 'menu cannot add a duplicate app reference');
  await run(`document.querySelector('#entryContextMenu').hidden=true;document.querySelector('#editBtn').click()`);
  await until(`editing===false && !layoutSaveInFlight`);

  // Tool personalization is one global draft: cancel once, then save and reload.
  const customizeTools = () => run(`(() => {
    document.querySelector('#moduleManagerBtn').click();
    const set=(id,value)=>{const node=document.querySelector(id);node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));};
    set('#toolAccent','mist');set('#toolClockFormat','12');set('#toolClockSize','large');set('#toolCalendarDensity','compact');set('#toolMusicMode','compact');
    document.querySelector('#moduleSave').click();
  })()`);
  await run(`document.querySelector('#editBtn').click()`);
  await customizeTools();
  assert.equal(await run(`state.tools.accent==='mist' && state.tools.clockFormat==='12' && state.tools.clockSize==='large' && state.tools.calendarDensity==='compact' && state.tools.musicCollapsed===true`), true, 'tool controls update the global layout draft');
  await run(`document.querySelectorAll('#sceneNav [data-scene]')[4].click()`);
  assert.equal(await run(`state.tools.accent==='mist' && document.querySelector('#moduleCard').dataset.toolAccent==='mist'`), true, 'the same tool draft is visible in another scene');
  await run(`document.querySelector('#cancelEditBtn').click()`);
  assert.equal(await run(`JSON.stringify(state.tools)`), initialTools, 'cancel restores global tool personalization');

  await run(`document.querySelector('#editBtn').click()`);
  await customizeTools();
  await run(`document.querySelector('#editBtn').click()`);
  await until(`editing===false && !layoutSaveInFlight`);
  stored = JSON.parse(await fs.readFile(configFile, 'utf8'));
  assert.equal(stored.tools.version, 2);
  assert.equal(stored.tools.accent, 'mist');
  assert.equal(stored.tools.clockFormat, '12');
  assert.equal(stored.tools.clockSize, 'large');
  assert.equal(stored.tools.calendarDensity, 'compact');
  assert.equal(stored.tools.musicCollapsed, true);
  await load();
  assert.equal(await run(`state.tools.version===2 && state.tools.accent==='mist' && state.tools.musicCollapsed===true`), true, 'tool personalization survives a renderer reload');

  // Shared-tool reset is a separate, explicit layout draft and never touches playlist data.
  await run(`document.querySelector('#editBtn').click();document.querySelector('#moduleManagerBtn').click();window.confirm=()=>true;document.querySelector('#toolReset').click()`);
  assert.equal(await run(`document.querySelector('#toolAccent').value==='theme' && document.querySelector('#toolClockFormat').value==='24' && document.querySelector('#toolMusicMode').value==='expanded'`), true, 'reset places defaults in the manager form');
  assert.equal(await run(`state.tools.accent==='mist' && state.tools.musicCollapsed===true`), true, 'reset does not apply before the explicit module action');
  await run(`document.querySelector('#moduleSave').click()`);
  assert.equal(await run(`state.tools.accent==='theme' && state.tools.musicCollapsed===false`), true, 'module action applies shared-tool defaults to the layout draft');
  assert.equal(await run(`JSON.stringify(state.music)`), initialMusic, 'shared-tool reset never changes the playlist or volume');
  await run(`document.querySelector('#cancelEditBtn').click()`);
  assert.equal(await run(`state.tools.accent==='mist' && state.tools.musicCollapsed===true`), true, 'layout cancel restores the saved shared-tool settings');

  // Empty music is deliberately compact; time formatting is checked with a fixed input.
  assert.equal(await run(`document.querySelector('[data-module="music"]').classList.contains('is-empty')`), true);
  assert.equal(await run(`getComputedStyle(document.querySelector('.music-controls')).display==='none' && getComputedStyle(document.querySelector('#musicProgress')).display==='none' && getComputedStyle(document.querySelector('.music-meta')).display==='none'`), true, 'empty music hides meaningless controls');
  assert.equal(await run(`!document.querySelector('#musicAdd').hidden && document.querySelector('#musicCurrent').textContent.includes('添加')`), true, 'empty music keeps a clear add action');
  assert.equal(await run(`!formatClockTime(new Date(2026,0,1,13,5)).startsWith('13')`), true, '12-hour preference affects the formatter');

  // Shared DOM identity must survive all scene changes.
  await run(`document.querySelector('#editBtn').click()`);
  assert.equal(await run(`(() => { const clock=document.querySelector('#moduleTimeNow'), calendar=document.querySelector('#calendarGrid'), audio=document.querySelector('#musicAudio'); for(const button of document.querySelectorAll('#sceneNav [data-scene]'))button.click(); return clock===document.querySelector('#moduleTimeNow') && calendar===document.querySelector('#calendarGrid') && audio===document.querySelector('#musicAudio'); })()`), true);
  await run(`document.querySelector('#cancelEditBtn').click()`);

  // Responsive geometry: three columns, two columns with tools below, then one column.
  win.webContents.debugger.attach('1.3');
  const geometry = async width => {
    let metricWidth = width;
    for (let attempt = 0; attempt < 3; attempt++) {
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: metricWidth, height: 650, deviceScaleFactor: 1, mobile: false });
      await wait(160);
      const viewportWidth = await run(`innerWidth`);
      if (Math.abs(viewportWidth - width) <= 2) break;
      metricWidth = Math.round(metricWidth * width / viewportWidth);
    }
    await wait(100);
    const result = await run(`(() => {
      const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
      const task=box(document.querySelector('.task-card')),apps=box(document.querySelector('.apps-card')),tools=box(document.querySelector('.modules-card'));
      const overlap=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
      return {innerWidth,task,apps,tools,overflow:document.documentElement.scrollWidth>innerWidth+1,overlaps:[overlap(task,apps),overlap(task,tools),overlap(apps,tools)]};
    })()`);
    result.nativeContentSize=win.getContentSize();
    result.nativeMinimumSize=win.getMinimumSize();
    return result;
  };
  const wide = await geometry(1440);
  assert.equal(wide.overflow, false); assert.deepEqual(wide.overlaps, [false, false, false]);
  assert(wide.task.left < wide.apps.left && wide.apps.left < wide.tools.left, `1440px uses task/apps/tools columns: ${JSON.stringify(wide)}`);
  const medium = await geometry(900);
  assert.equal(medium.overflow, false); assert.deepEqual(medium.overlaps, [false, false, false]);
  assert(medium.task.left < medium.apps.left && medium.tools.top >= Math.min(medium.task.bottom, medium.apps.bottom) - 1, `900px moves tools below the two-column row: ${JSON.stringify(medium)}`);
  const narrow = await geometry(590);
  assert.equal(narrow.overflow, false); assert.deepEqual(narrow.overlaps, [false, false, false]);
  assert(narrow.task.top < narrow.apps.top && narrow.apps.top < narrow.tools.top, `590px uses task/apps/tools vertical order: ${JSON.stringify(narrow)}`);
  await win.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
  win.webContents.debugger.detach();

  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  const report = {
    pageLoaded: true, saveCount, errors,
    checks: ['clean cancel', 'clean save/reload', 'side-to-apps stable ID', 'global tools cancel/save/reload', 'separate shared-tool reset', 'empty music', 'three/two/one-column geometry'],
    limits: ['mock system APIs', 'no native desktop attachment', 'no real task or user music data', 'CSS pixels are not Windows DPI validation']
  };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  clearTimeout(watchdog);
  win.destroy();
  app.exit(0);
}

main().catch(async error => {
  console.error(error);
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'failure.txt'), String(error.stack || error));
  clearTimeout(watchdog);
  app.exit(1);
});
