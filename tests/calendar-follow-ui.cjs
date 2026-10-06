'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const output = path.resolve(__dirname, '../test-results/calendar-follow');
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let session = null;
let readyCount = 0;
let saveCalls = 0;
const errors = [];
const checks = [];
let phase = 'initialization';
const watchdog = setTimeout(() => { console.error('calendar follow test timed out'); app.exit(1); }, 60000);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message) => { assert.ok(condition, message); checks.push(message); };

ipcMain.handle('test:load', () => ({ config: null, recovered: false }));
ipcMain.handle('test:save', () => { saveCalls++; return true; });
ipcMain.handle('test:fail-save', () => true);
ipcMain.handle('test:calendar-state', () => session);
ipcMain.on('test:calendar-state', (_event, value) => { session = value.follow ? null : value; });
ipcMain.on('test:page-ready', () => readyCount++);
ipcMain.on('test:page-error', (_event, message) => errors.push(message));
ipcMain.on('test:music-state', () => {});

async function createPage(desktop = false) {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: {
    preload: path.join(__dirname, 'ui-smoke-preload.cjs'), sandbox: true, contextIsolation: true,
    nodeIntegration: false, backgroundThrottling: false
  } });
  win.webContents.on('did-fail-load', (_event, code, description) => errors.push(`${code}: ${description}`));
  win.webContents.on('render-process-gone', (_event, detail) => errors.push(detail.reason));
  win.webContents.on('console-message', detail => { if (detail.level === 'error' && !detail.message.includes('Electron Security Warning')) errors.push(`console: ${detail.message}`); });
  const before = readyCount;
  await win.loadFile(path.resolve(__dirname, '../src/index.html'), { query: desktop ? { desktop: '1', calendarTest: '1' } : { calendarTest: '1' } });
  for (let i = 0; i < 100 && readyCount === before; i++) await wait(50);
  check(readyCount > before, 'page initialized through normal load flow');
  return win;
}

async function run() {
  await fs.mkdir(output, { recursive: true });
  await app.whenReady();
  let win = await createPage();
  phase = 'synthetic clock setup';
  let js = source => win.webContents.executeJavaScript(source, true);
  const fake = async (year, month, day, hour = 12, minute = 0) => {
    await js(`calendarNow=()=>new Date(${year},${month - 1},${day},${hour},${minute});scheduleClock()`);
  };
  const snapshot = () => js(`({follow:calendarFollowToday,cursor:localCalendarDay(calendarCursor),selected:localCalendarDay(calendarSelected),label:$('#calendarLabel').textContent,footer:$('#calendarSelected').textContent,today:$$('#calendarGrid .today').map(node=>node.dataset.calendarDay),selectedCells:$$('#calendarGrid .selected').map(node=>node.dataset.calendarDay),ariaCurrent:$$('#calendarGrid [aria-current="date"]').map(node=>node.dataset.calendarDay),manualButton:!$('#calendarFollowBtn').hidden})`);

  await fake(2026, 9, 30, 23, 59);
  phase = 'cross-month';
  await fake(2026, 10, 1, 0, 0);
  let view = await snapshot();
  check(view.follow && view.cursor === '2026-10-01' && view.selected === '2026-10-01' && view.today[0] === '2026-10-01' && view.ariaCurrent[0] === '2026-10-01' && view.footer.includes('跟随今天'), 'cross-month rollover follows today in every calendar field');
  await fake(2026, 10, 2, 0, 0);
  check((await snapshot()).cursor === '2026-10-01' && (await snapshot()).selected === '2026-10-02', 'same-month rollover updates selected day');

  await fake(2026, 12, 31, 23, 59); await fake(2027, 1, 1, 0, 0);
  phase = 'cross-year';
  view = await snapshot();
  check(view.cursor === '2027-01-01' && view.selected === '2027-01-01' && view.label.includes('2027年1月'), 'cross-year rollover follows the new year');
  await fake(2024, 2, 28, 23, 59); await fake(2024, 2, 29, 0, 0); view = await snapshot();
  phase = 'leap day';
  check(view.selected === '2024-02-29' && view.today[0] === '2024-02-29', 'leap-day rollover');
  await fake(2024, 3, 1, 0, 0);
  check((await snapshot()).cursor === '2024-03-01', 'leap February to March rollover');
  await fake(2026, 10, 3);
  phase = 'manual browsing';
  await js(`$('#search').value='保留搜索';window.__audioBefore=$('#musicAudio');document.querySelector('[data-calendar-nav="prev"]').click()`);
  view = await snapshot();
  check(!view.follow && view.cursor === '2026-09-01' && view.selected === '2026-10-03' && view.manualButton, 'manual month navigation pauses follow mode');
  await fake(2026, 10, 4);
  view = await snapshot();
  check(view.cursor === '2026-09-01' && view.selected === '2026-10-03' && view.today[0] === '2026-10-04', 'manual browsing stays put while today marking advances');
  await js(`state.scene='🔬 科研';render();state.scene='🏠 生活';render()`);
  check(!(await snapshot()).follow && (await snapshot()).cursor === '2026-09-01', 'scene switching shares the same browse state');
  check(await js(`$('#search').value==='保留搜索' && window.__audioBefore===$('#musicAudio')`), 'calendar updates do not replace search input or player');
  await js(`$('#calendarFollowBtn').click()`);
  view = await snapshot();
  check(view.follow && view.cursor === '2026-10-01' && view.selected === '2026-10-04' && !view.manualButton, 'today button restores automatic follow and selects today');
  await fake(2026, 10, 5);
  check((await snapshot()).selected === '2026-10-05', 'follow mode keeps advancing after today button');
  const writesBeforeRecovery = saveCalls;
  await js(`calendarNow=()=>new Date(2026,9,8,9,0);true`);
  win.webContents.send('test:calendar-check');await wait(50);
  check((await snapshot()).selected === '2026-10-08', 'simulated resume after multiple days checks the date immediately');
  await js(`calendarNow=()=>new Date(2026,9,2,9,0);window.dispatchEvent(new Event('focus'))`);
  check((await snapshot()).selected === '2026-10-02', 'window focus handles a backward system-date change');
  await fake(2026, 10, 4, 0, 10);
  check(await js(`localCalendarDay(calendarNow())==='2026-10-04' && localCalendarDay(calendarNow())!==calendarNow().toISOString().slice(0,10)`), 'local midnight uses local calendar fields even while UTC is on the previous date');
  check(saveCalls === writesBeforeRecovery, 'date and resume checks do not write configuration');

  await js(`document.querySelector('[data-calendar-day="2026-10-03"]').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  view = await snapshot();
  check(!view.follow && view.selected === '2026-10-03' && await js(`document.activeElement?.dataset?.calendarDay==='2026-10-03'`), 'keyboard date selection enters browse mode and preserves focus');
  await js(`calendarZone='synthetic/old|0';calendarCursor=new Date(2026,8,1);calendarSelected=new Date(2026,9,2);renderCalendar()`);
  view = await snapshot();
  check(view.cursor === '2026-10-01' && view.selected === '2026-10-03', 'time-zone change preserves manual date-only anchors');
  check(session?.follow === false && session.selected === '2026-10-03', 'manual state is handed off in memory');
  const old = win; win = await createPage(true); js = source => win.webContents.executeJavaScript(source, true); old.destroy();
  phase = 'desktop handoff';
  view = await snapshot();
  check(!view.follow && view.selected === '2026-10-03', 'desktop-mode page restores in-memory manual selection');
  await js(`$('#calendarFollowBtn').click()`);
  check(session === null, 'returning to today clears transient handoff state');
  win.destroy(); win = await createPage(); js = source => win.webContents.executeJavaScript(source, true);
  view = await snapshot();
  check(view.follow && view.selected === await js(`localCalendarDay(new Date())`), 'new page defaults to current local date');
  check(errors.length === 0, `renderer errors: ${errors.join('; ')}`);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ pageLoaded: true, checks, errors, limits: ['synthetic time and IPC', 'no physical sleep, tray or native desktop attachment', 'no Windows system clock changed'] }, null, 2));
  await wait(180);
  await win.webContents.capturePage().then(image => fs.writeFile(path.join(output, 'auto-follow.png'), image.toPNG()));
  await js(`document.querySelector('[data-calendar-nav="prev"]').click()`);
  await wait(180);
  await win.webContents.capturePage().then(image => fs.writeFile(path.join(output, 'manual-browse.png'), image.toPNG()));
  await js(`$('#calendarFollowBtn').click()`);
  await wait(180);
  await win.webContents.capturePage().then(image => fs.writeFile(path.join(output, 'back-to-today.png'), image.toPNG()));
  console.log(JSON.stringify({ passed: checks.length, report: path.join(output, 'report.json') }));
  clearTimeout(watchdog); win.destroy(); app.exit(0);
}
run().catch(error => { console.error(`PHASE=${phase}`, error, errors); clearTimeout(watchdog); app.exit(1); });
