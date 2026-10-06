'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const report = [];
const check = (condition, message) => { assert.ok(condition, message); report.push(message); };
const work = path.resolve(__dirname, '../../..', 'work/ui-layout-smoke-build4');
app.setPath('userData', path.join(work, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  await fs.mkdir(path.join(work, 'profile'), { recursive: true });
  const configFile=path.join(work,'synthetic-config.json');
  await fs.writeFile(configFile,'null');
  let failNextSave=false;
  ipcMain.handle('test:load',async()=>({config:JSON.parse(await fs.readFile(configFile,'utf8')),recovered:false}));
  ipcMain.handle('test:fail-save',()=>{failNextSave=true;});
  ipcMain.handle('test:save',async(_event,config)=>{
    if(failNextSave){failNextSave=false;throw new Error('synthetic save failure');}
    await fs.writeFile(configFile,JSON.stringify(config));return true;
  });
  const win = new BrowserWindow({
    show: false,
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'ui-smoke-preload.cjs'),
      contextIsolation: true,
      sandbox: true
    }
  });
  win.setMinimumSize(0,0);
  win.webContents.on('console-message', (event) => { if(event.level===3)console.error('renderer:',event.messageText); });
  await win.loadFile(path.resolve(__dirname, '../src/index.html'));
  const js = (source) => win.webContents.executeJavaScript(source, true).catch((error) => { console.error('executeJavaScript failed:',source,error); throw error; });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 80));
  await tick();

  // A stale empty DOM must never override stable IDs loaded from disk.
  await js(`(async()=>{state.didaListIds={clinical:'saved-c',research:'saved-r',study:'saved-s',life:'saved-l'};await persist();render()})()`);
  await win.loadFile(path.resolve(__dirname, '../src/index.html'));await tick();
  await js(`$('#settingsBtn').click()`);
  check(await js(`$('[data-dida-map="clinical"]').value==='saved-c'`),'saved mapping survives renderer reload before lists arrive');
  await js(`(()=>{didaDashboard={source:'live',projects:[{id:'saved-c',name:'临床'},{id:'chosen',name:'自选'}],tasks:[]};renderDidaMapping();const sel=$('[data-dida-map="clinical"]');sel.value='chosen';sel.dispatchEvent(new Event('change'));renderDidaMapping()})()`);
  check(await js(`$('[data-dida-map="clinical"]').value==='chosen'`),'refresh preserves active unsaved mapping choice');
  await js(`(async()=>{await testControl.failNextSave();await saveSettings()})()`);
  check(await js(`$('#settingsDialog').open && state.didaListIds.clinical==='saved-c' && $('[data-dida-map="clinical"]').value==='chosen'`),'save failure preserves draft and does not falsely change committed mapping');
  await js(`saveSettings()`);
  const stored=JSON.parse(await fs.readFile(configFile,'utf8'));
  check(stored.didaListIds.clinical==='chosen' && stored.didaListIds.research==='saved-r','explicit save writes chosen ID and preserves unavailable lists');
  await win.loadFile(path.resolve(__dirname, '../src/index.html'));await tick();
  await js(`$('#settingsBtn').click()`);
  check(await js(`$('[data-dida-map="clinical"]').value==='chosen'`),'saved association remains selected after second renderer restart');
  await js(`(async()=>{const sel=$('[data-dida-map="clinical"]');sel.value='';sel.dispatchEvent(new Event('change'));await saveSettings();inferDidaMapping([{id:'auto',name:'临床'}])})()`);
  check(await js(`state.didaListIds.clinical==='' && state.didaListIds.research==='saved-r'`),'explicit unlink is not silently re-inferred; missing saved lists are preserved');
  await js(`(async()=>{state=clone(defaults);await persist();render()})()`);

  const oldConfig = await js(`(()=>{const old=clone(defaults);for(const scene of SCENES){delete old.scenes[scene].layout.heights;delete old.scenes[scene].layout.entrySize;delete old.scenes[scene].layout.spacing;}return normalize(old)})()`);
  check(oldConfig.scenes['总览'].layout.heights.tasks === 'medium' && oldConfig.scenes['总览'].layout.entrySize === 'medium', 'legacy layout gains safe defaults without losing scenes');

  await js(`$('#settingsBtn').click()`); await tick();
  await js(`$('#startupSettingsBtn').click()`); await tick();
  check(await js(`$('#startupDialog').open && !$('#startupEnabled').checked && $('#aboutInfo').textContent.includes('test')`), 'startup and about controls show the mocked disabled-by-default state and build info');
  await js(`$('#startupEnabled').checked=true;$('#startupApply').click()`); await tick();
  check(await js(`$('#startupStatus').textContent.includes('已开启')`), 'mocked startup setting reports the adapter result');
  await js(`$('#startupMode').value='desktop';$('#startupMode').dispatchEvent(new Event('change',{bubbles:true}))`);
  check(await js(`$('#startupStatus').textContent.includes('尚未应用')`), 'startup mode edits are marked as unapplied');
  await js(`$('#startupApply').click()`); await tick();
  check(await js(`$('#startupStatus').textContent.includes('合成写入失败') && $('#startupEnabled').checked`), 'failed write restores the actual confirmed checkbox state and shows the failure');
  check(await js(`startupStatusText({supported:true,state:'unknown',registered:null,error:'read failed'}).includes('状态未知')`), 'unknown Windows state is not presented as disabled');
  await js(`$('#startupDialog').close();$('#settingsDialog').close()`);

  await js(`state.library.synthetic={id:'synthetic',name:'Synthetic Editor',type:'软件',icon:'⌘',description:'合成入口',kind:'application',target:'C:\\\\synthetic\\\\editor.exe'};state.scenes['总览'].apps.push('synthetic');render()`);
  await js(`startEdit();current().layout.heights.apps='tall';current().layout.entrySize='large';current().layout.spacing='spacious';renderLayout()`);
  check(await js(`$('#appGrid').querySelector('[data-entry="synthetic"]')?.dataset.entry==='synthetic'`), 'entry renders with stable ID');

  await js(`$('#search').value='synthetic';renderApps();openEntryMenu('synthetic','apps',innerWidth-2,innerHeight-2)`);
  check(await js(`!$('#entryContextMenu').hidden && $('#entryContextMenu').getBoundingClientRect().right<=innerWidth && $('#entryContextMenu').getBoundingClientRect().bottom<=innerHeight`), 'right-click menu is bounded by window after filtering');
  check(await js(`$('#contextOpen').disabled`), 'open action is disabled while layout is being edited');
  await js(`$('#entryContextMenu [data-context-action="edit"]').click()`);
  check(await js(`editing && $('#entryDialog').open && !$('#entrySharedNote').hidden`), 'menu edit opens explicit editor with shared-entry disclosure');
  await js(`$('#entryDialog').close();stopEdit(false)`);

  await js(`$('#search').value='synthetic';renderApps();openEntryMenu('synthetic','apps',50,50);$('#contextScenes [data-context-scene="🏥 临床"]').click()`);
  check(await js(`editing && state.scenes['🏥 临床'].apps.includes('synthetic') && state.scenes['总览'].apps.includes('synthetic')`), 'locked menu add enters edit flow and reuses shared ID');
  await js(`current().layout.heights.apps='tall';current().layout.entrySize='large';current().layout.spacing='spacious';renderLayout()`);
  await js('stopEdit(true)');
  check(await js(`state.scenes['总览'].layout.heights.apps==='tall' && state.scenes['总览'].layout.entrySize==='large' && state.scenes['总览'].layout.spacing==='spacious'`), 'per-scene height, entry size, spacing persist after save');

  await js(`state.scene='🏥 临床';render();openEntryMenu('synthetic','apps',60,60);$('#entryContextMenu [data-context-action="remove"]').click()`);
  check(await js(`editing && !state.scenes['🏥 临床'].apps.includes('synthetic') && state.scenes['总览'].apps.includes('synthetic')`), 'remove affects only the current scene reference');
  await js('stopEdit(false)');
  check(await js(`state.scenes['🏥 临床'].apps.includes('synthetic')`), 'cancel restores the removed reference');

  await js(`state.scene='总览';render();const node=$('#appGrid [data-entry="synthetic"]');node.dispatchEvent(new KeyboardEvent('keydown',{key:'F10',shiftKey:true,bubbles:true}))`);
  check(await js(`!$('#entryContextMenu').hidden`), 'Shift+F10 opens the entry menu');
  await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  check(await js(`$('#entryContextMenu').hidden`), 'Escape closes the entry menu');

  const fixtureResult=await js(`(()=>{try{const shift=(n)=>{const d=new Date(todayKey()+'T12:00:00+08:00');d.setDate(d.getDate()+n);return HomeTaskView.dateKey(d.toISOString())};state.scene='总览';state.didaListIds={clinical:'clinical',research:'research',study:'study',life:'life'};state.taskView={range:'scene',dates:'all',inboxProjectId:''};const day=shift(0);dida={state:'connected'};didaDashboard={source:'live',projects:[{id:'clinical',name:'临床清单'},{id:'research',name:'科研清单'},{id:'inbox',name:'用户命名的清单'}],tasks:[{id:'late',title:'昨天逾期',projectId:'clinical',dueDate:shift(-1),isAllDay:true,status:0},{id:'today-timed',title:'今天定时',projectId:'clinical',dueDate:day+'T09:00:00+08:00',isAllDay:false,status:0},{id:'today-all',title:'今天全天',projectId:'research',dueDate:day,isAllDay:true,status:0},{id:'tomorrow',title:'明天报到',projectId:'inbox',dueDate:shift(1),isAllDay:true,status:0,repeatFlag:'FREQ=DAILY',checkItems:[{id:'open-check',title:'未完成检查项',status:0},{id:'done-check',title:'已完成检查项',status:2}]},{id:'next-week',title:'下周任务',projectId:'research',dueDate:shift(7),isAllDay:true,status:0},{id:'start-only',title:'过去开始但不逾期',projectId:'clinical',startDate:shift(-2),isAllDay:true,status:0},{id:'undated',title:'没有日期',projectId:'research',status:0},{id:'bad-date',title:'坏日期',projectId:'research',dueDate:'bad-date',status:0},{id:'done',title:'已完成隐藏',projectId:'clinical',dueDate:shift(1),status:2},{id:'inbox-other',title:'收集箱其他任务',projectId:'clinical',dueDate:shift(2),isAllDay:true,status:0}]};renderTasks();return 'ok'}catch(error){return error.stack}})()`);if(fixtureResult!=='ok')throw new Error(fixtureResult);
  let taskText=await js(`$('#tasks').textContent`);
  check(taskText.indexOf('昨天逾期')<taskText.indexOf('今天全天') && taskText.indexOf('今天全天')<taskText.indexOf('今天定时') && taskText.indexOf('今天定时')<taskText.indexOf('明天报到') && taskText.indexOf('明天报到')<taskText.indexOf('下周任务'),'all-date view orders tasks by date and places all-day before timed');
  check(taskText.includes('逾期') && taskText.includes('开始于') && taskText.includes('未设日期') && taskText.includes('日期待确认') && taskText.includes('临床清单') && taskText.includes('科研清单'),'all-date view labels overdue/start-only/undated/invalid and task list');
  check(!taskText.includes('已完成隐藏'),'completed tasks remain excluded');
  check(taskText.includes('重复')&&taskText.includes('未完成检查项')&&!taskText.includes('已完成检查项'),'repeat marker and open check items are retained without completed checks');
  await js(`lastTaskDayKey='1900-01-01';refreshTaskDayIfNeeded()`);
  check(await js(`lastTaskDayKey===todayKey() && $('#tasks').textContent.includes('明天报到')`),'Shanghai day-label refresh rerenders locally without dropping task data');
  await js(`state.taskView={range:'inbox',dates:'all',inboxProjectId:''};renderTasks()`);
  check(await js(`$('#tasks').textContent.includes('请选择要显示的指定清单') && $('#inboxProject').hidden===false`),'specified-list scope needs an explicit stable project selection');
  await js(`state.taskView.inboxProjectId='inbox';renderTasks()`);
  taskText=await js(`$('#tasks').textContent`);
  check(taskText.includes('明天报到')&&!taskText.includes('收集箱其他任务')&&!taskText.includes('昨天逾期'),'inbox scope filters by explicitly selected stable project ID');
  await js(`state.taskView={range:'scene',dates:'all',inboxProjectId:''};state.scene='🏥 临床';renderTasks()`);
  check(await js(`$('#tasks').textContent.includes('昨天逾期')&&!$('#tasks').textContent.includes('明天报到')`),'non-overview scene includes only its mapped project');
  await js(`state.taskView={range:'scene',dates:'today',inboxProjectId:''};state.scene='总览';renderTasks()`);
  check(await js(`!$('#tasks').textContent.includes('明天报到')&&$('#taskCardTitle').textContent==='今天'`),'today-only view remains available');
  await js(`didaDashboard={source:'partial',failedCount:1,failedProjectIds:['inbox'],projects:[{id:'inbox',name:'任意名称'}],tasks:[]};state.taskView={range:'inbox',dates:'all',inboxProjectId:'inbox'};renderTasks()`);
  check(await js(`$('#tasks').textContent.includes('读取失败')&&!$('#tasks').textContent.includes('暂无未完成任务')`),'failed inbox project is never reported empty');
  await js(`(async()=>{didaDashboard={source:'live',projects:[{id:'inbox',name:'任意名称'}],tasks:[]};state.taskView={range:'inbox',dates:'all',inboxProjectId:'inbox'};await saveTaskView({dates:'today'})})()`);
  const taskViewSaved=JSON.parse(await fs.readFile(configFile,'utf8'));
  check(taskViewSaved.taskView.range==='inbox'&&taskViewSaved.taskView.dates==='today'&&taskViewSaved.taskView.inboxProjectId==='inbox','scope/date/list selection persists to local config');
  await js(`state=normalize(defaults);state.didaListIds={};state.scene='总览';state.taskView={range:'scene',dates:'all',inboxProjectId:''};state.scenes['总览'].layout.heights.apps='tall';render()`);
  check(await js(`normalize({...clone(defaults),didaListIds:{clinical:'preserve-id'}}).taskView.dates==='all'`),'legacy config defaults to all dates');
  win.webContents.debugger.attach('1.3');
  const columns = async (width) => { await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await tick();return js(`getComputedStyle($('#workspace')).gridTemplateColumns.trim().split(/\\s+/).length`); };
  check(await columns(1400) === 3, 'wide window uses three columns');
  check(await columns(800) === 2, 'medium window uses two columns');
  check(await columns(500) === 1, 'narrow window uses one column');
  check(await js(`getComputedStyle($('#tasks')).overflowY==='auto'`), 'task list remains internally scrollable');
  await js(`state.scene='总览';render();startEdit();current().layout.heights.apps='compact';renderLayout();stopEdit(false)`);
  check(await js(`state.scenes['总览'].layout.heights.apps==='tall'`), 'cancel fully restores the pre-edit layout');
  win.webContents.debugger.detach();

  console.log(`isolated UI checks passed (${report.length}):\n- ${report.join('\n- ')}`);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
