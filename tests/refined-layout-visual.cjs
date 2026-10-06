'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const output = path.resolve(__dirname, '../test-results/refined-layout/after');
const configFile = path.join(output, 'isolated-config.json');
const scenes = ['总览', '🏥 临床', '🔬 科研', '📚 学习', '🏠 生活'];

const entry = (name, icon, type = '软件') => ({
  name, icon, type, description: '合成测试入口', kind: 'website', target: 'https://example.invalid/'
});
const library = {
  zotero: entry('Zotero', 'Z'), obsidian: entry('Obsidian', '◆'), prism: entry('Prism 数据绘图', '△'), browser: entry('浏览器', '◎', '网站'),
  word: entry('Word 文档写作', 'W'), dida: entry('滴答清单', '✓'), vpn: entry('VPN', '▣'), chat: entry('ChatGPT', '✦', '网站'),
  project: entry('合成研究项目', '◇', '项目'), literature: entry('合成本周文献清单', '▤', '资料')
};
const apps = {
  '总览': ['zotero', 'obsidian', 'prism', 'browser', 'word', 'dida'],
  '🏥 临床': ['word', 'browser', 'dida', 'chat'],
  '🔬 科研': ['zotero', 'obsidian', 'prism', 'browser', 'vpn', 'chat'],
  '📚 学习': ['obsidian', 'browser', 'word', 'chat'],
  '🏠 生活': ['dida', 'browser', 'chat', 'vpn']
};
const layout = () => ({
  order: ['tasks', 'apps', 'side'], focus: 'normal',
  heights: { tasks: 'medium', apps: 'content', side: 'content' },
  entrySize: 'medium', spacing: 'comfortable', entryStyle: 'tiles', showUnsetEntries: true,
  modules: {
    visible: { tasks: true, apps: true, side: false, time: true, calendar: true, music: true },
    order: ['tasks', 'apps', 'side', 'time', 'calendar', 'music'],
    sizes: { tasks: 'medium', apps: 'medium', side: 'medium', time: 'medium', calendar: 'medium', music: 'medium' }
  }
});
const config = {
  version: 1, scene: '总览', theme: 'warm', shortcut: 'Control+Alt+H',
  appearance: { wallpaper: '', glass: 'frosted', dim: 8, fit: 'cover', position: 'center', renderQuality: 'smooth' },
  didaListIds: { clinical: 'clinical', research: 'research', study: 'study', life: 'life' },
  taskView: { range: 'scene', dates: 'all', inboxProjectId: '' },
  taskViews: Object.fromEntries(scenes.map(scene => [scene, { range: 'scene', dates: 'all', inboxProjectId: '' }])),
  tools: {
    version: 2, visible: { time: true, calendar: true, music: true }, order: ['time', 'calendar', 'music'],
    sizes: { time: 'medium', calendar: 'medium', music: 'medium' }, musicCollapsed: false,
    accent: 'mist', clockFormat: '24', clockSize: 'large', calendarDensity: 'compact'
  },
  music: {
    tracks: [
      { id: 'song-a', name: '合成歌名 · 湖畔晨光', target: 'X:\\synthetic-audio\\lake-morning.wav' },
      { id: 'song-b', name: '合成歌名 · 专注阅读白噪声（较长名称）', target: 'X:\\synthetic-audio\\focus.wav' },
      { id: 'song-c', name: '合成歌名 · 夜间散步', target: 'X:\\synthetic-audio\\night-walk.wav' }
    ],
    volume: .68, lastTrackId: 'song-a', lastTime: 0
  },
  library,
  scenes: Object.fromEntries(scenes.map(scene => [scene, {
    apps: apps[scene], side: [['合成项目', 'project'], ['合成资料', 'literature']], layout: layout()
  }]))
};

const projects = [
  { id: 'clinical', name: '🏥 临床（合成）' }, { id: 'research', name: '🔬 科研（合成）' },
  { id: 'study', name: '📚 学习（合成）' }, { id: 'life', name: '🏠 生活（合成）' }
];
const tasks = [
  { id: 'c1', projectId: 'clinical', title: '[合成] 感染科报到', dueDate: '2026-09-27T00:00:00+08:00', isAllDay: true, status: 0 },
  { id: 'c2', projectId: 'clinical', title: '[合成] 整理交班要点', dueDate: '2026-09-29T00:30:00Z', isAllDay: false, status: 0 },
  { id: 'r1', projectId: 'research', title: '[合成] 整理实验结果图', dueDate: '2026-09-28T00:00:00+08:00', isAllDay: true, status: 0 },
  { id: 'r2', projectId: 'research', title: '[合成] 阅读一篇方法学文献', dueDate: '2026-10-02T12:00:00Z', isAllDay: false, repeatFlag: true, status: 0 },
  { id: 's1', projectId: 'study', title: '[合成] 日语复习 30 分钟', dueDate: '2026-09-30T00:00:00+08:00', isAllDay: true, status: 0 },
  { id: 'l1', projectId: 'life', title: '[合成] 补充本周生活用品', dueDate: '2026-10-03T00:00:00+08:00', isAllDay: true, status: 0 }
];

app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const watchdog = setTimeout(() => { console.error('FAIL: refined layout visual test timed out'); app.exit(1); }, 60000);

async function main() {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(configFile, JSON.stringify(config, null, 2));
  await app.whenReady();

  let ready = 0;
  const errors = [];
  ipcMain.handle('test:load', async () => ({ config: JSON.parse(await fs.readFile(configFile, 'utf8')), recovered: false }));
  ipcMain.handle('test:save', async (_event, value) => { await fs.writeFile(configFile, JSON.stringify(value, null, 2)); return true; });
  ipcMain.handle('test:fail-save', () => false);
  ipcMain.handle('test:launch-entry', () => ({ ok: true, launchRequested: true }));
  ipcMain.handle('test:hide', () => true);
  ipcMain.on('test:page-ready', () => ready++);
  ipcMain.on('test:music-state', () => {});
  ipcMain.on('test:page-error', (_event, message) => errors.push(String(message)));

  const win = new BrowserWindow({
    show: false, width: 1440, height: 1000,
    webPreferences: {
      preload: path.join(__dirname, 'ui-smoke-preload.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
    }
  });
  win.webContents.on('did-fail-load', (_event, code, description) => errors.push(`load ${code}: ${description}`));
  win.webContents.on('render-process-gone', (_event, detail) => errors.push(`renderer: ${detail.reason}`));
  const run = source => win.webContents.executeJavaScript(source, true);
  const until = async expression => {
    for (let attempt = 0; attempt < 80; attempt++) { if (await run(expression)) return; await wait(50); }
    throw new Error(`Timed out: ${expression}`);
  };

  await win.loadFile(path.resolve(__dirname, '../src/index.html'));
  await until(`document.querySelectorAll('#sceneNav [data-scene]').length===5`);
  assert(ready > 0, 'normal initialization must emit pageReady');
  await run(`(() => {
    dida={state:'connected',message:'合成任务，仅用于视觉测试。'};
    didaDashboard={source:'live',projects:${JSON.stringify(projects)},tasks:${JSON.stringify(tasks)},lastSuccessfulAt:'2026-09-26T08:00:00Z',message:'合成任务，仅用于视觉测试。'};
    renderTasks();renderStatus();
  })()`);

  async function viewport(width, height) {
    win.setContentSize(width, height);
    await wait(220);
  }
  async function shot(name, width = 1440, height = 1000) {
    await viewport(width, height);
    await run(`scrollTo(0,0);document.querySelector('#toast').classList.remove('show')`);
    await wait(100);
    const image = await win.webContents.capturePage();
    await fs.writeFile(path.join(output, `${name}.png`), image.toPNG());
  }
  async function scene(name) {
    await run(`state.scene=${JSON.stringify(name)};render();renderTasks();renderStatus();`);
    await wait(120);
  }

  await scene('总览');
  await shot('overview');
  await scene('🔬 科研');
  await shot('research');
  await scene('🏠 生活');
  await shot('life');

  // Expanded and compact music use the same synthetic playlist; no file is opened.
  await run(`state.tools.musicCollapsed=false;renderModules()`);
  await shot('music-expanded', 1100, 980);
  await run(`state.tools.musicCollapsed=true;renderModules()`);
  await shot('music-compact', 1100, 900);

  // Personalization controls are reached through the real edit and module-manager buttons.
  await run(`document.querySelector('#editBtn').click();document.querySelector('#moduleManagerBtn').click()`);
  await until(`document.querySelector('#moduleDialog').open===true`);
  await shot('tool-personalization-dialog', 1100, 950);
  await run(`document.querySelector('#moduleCancel').click();document.querySelector('#cancelEditBtn').click()`);

  await scene('🔬 科研');
  await shot('narrow', 590, 1500);

  await run(`state.theme='night';render();renderTasks();renderStatus()`);
  await shot('night', 1440, 1000);

  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  const files = ['overview.png', 'research.png', 'life.png', 'narrow.png', 'music-compact.png', 'music-expanded.png', 'tool-personalization-dialog.png', 'night.png'];
  const report = {
    pageLoaded: true, errors, screenshots: files,
    syntheticData: true,
    limits: ['mock system APIs', 'synthetic tasks/entries/song names', 'no native desktop attachment', 'BrowserWindow resizing is not Windows DPI validation']
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
