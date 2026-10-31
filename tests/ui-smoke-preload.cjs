'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const completionTest=new URLSearchParams(window.location.search).has('completionTest');
const assistantTest=new URLSearchParams(window.location.search).has('assistantTest');
const pomodoroTest=new URLSearchParams(window.location.search).has('pomodoroTest');
const quotaTest=new URLSearchParams(window.location.search).has('quotaTest');
window.addEventListener('error', event => ipcRenderer.send('test:page-error', event.message));
window.addEventListener('unhandledrejection', event => ipcRenderer.send('test:page-error', String(event.reason)));
contextBridge.exposeInMainWorld('testControl', { failNextSave: () => ipcRenderer.invoke('test:fail-save') });
contextBridge.exposeInMainWorld('homeApi', {
  helpMetadata:()=>ipcRenderer.invoke('test:help-meta'),
  checkUpdates:()=>ipcRenderer.invoke('test:help-check'),
  diagnosticSummary:()=>ipcRenderer.invoke('test:help-diagnostic'),
  copyDiagnostic:()=>ipcRenderer.invoke('test:help-copy'),
  openHelp:key=>ipcRenderer.invoke('test:help-open',key),
  guideState:()=>new URLSearchParams(window.location.search).has('guideTest')?ipcRenderer.invoke('test:guide-state'):Promise.resolve({ok:true,show:false}),
  dismissGuide:()=>ipcRenderer.invoke('test:guide-dismiss'),
  codexQuota: force => quotaTest ? ipcRenderer.invoke('test:quota-read',force===true) : Promise.resolve({status:'missing',message:'隔离测试：未连接 Codex。',windows:[],resetCredits:{availableCount:null,expirations:[]},fetchedAt:null,stale:true}),
  pomodoroState: () => pomodoroTest ? ipcRenderer.invoke('test:pomo-state') : Promise.resolve({phase:'focus',status:'idle',remainingMs:1500000,settings:{focus:25,break:5},revision:0}),
  pomodoroCommand: action => ipcRenderer.invoke('test:pomo-command',action),
  pomodoroFocusTask:value=>ipcRenderer.invoke('test:pomo-focus-task',value),
  pomodoroSettings: value => ipcRenderer.invoke('test:pomo-settings',value),
  onPomodoroState: callback => {if(!pomodoroTest)return ()=>{};const handler=(_event,value)=>callback(value);ipcRenderer.on('test:pomo-state',handler);return ()=>ipcRenderer.removeListener('test:pomo-state',handler);},
  assistantRecover: value => ipcRenderer.invoke('test:assistant-recover',value),
  onAssistantDraftStorage: callback => {const handler=(_e,value)=>callback(value);ipcRenderer.on('test:assistant-draft-storage',handler);return ()=>ipcRenderer.removeListener('test:assistant-draft-storage',handler);},
  assistantStatus: () => ipcRenderer.invoke('test:assistant-status'),
  assistantManualDraft:value=>ipcRenderer.invoke('test:assistant-manual-draft',value),
  assistantSettings: value => ipcRenderer.invoke('test:assistant-settings',value),
  assistantTest: () => ipcRenderer.invoke('test:assistant-test'),
  assistantGenerate: value => ipcRenderer.invoke('test:assistant-generate',value),
  assistantCreate: value => ipcRenderer.invoke('test:assistant-create',value),
  assistantCancel: () => ipcRenderer.invoke('test:assistant-cancel'),
  assistantClear: () => ipcRenderer.invoke('test:assistant-clear'),
  assistantResolve: () => ipcRenderer.invoke('test:assistant-resolve'),
  assistantSession: () => assistantTest ? ipcRenderer.invoke('test:assistant-session') : Promise.resolve(null),
  assistantInput: value => {if(assistantTest)ipcRenderer.send('test:assistant-input',value);},
  assistantPreview: value => {if(assistantTest)ipcRenderer.send('test:assistant-preview',value);},
  loadConfig: () => ipcRenderer.invoke('test:load'),
  saveConfig: (config) => ipcRenderer.invoke('test:save', config),
  backupConfig: async () => ({ canceled: true }),
  restoreConfig: async () => ({ canceled: true }),
  chooseLocalEntry: async () => ({ canceled: true }),
  validateEntry: async (entry) => ({ ok: true, ...entry }),
  entryIcon: async () => new URLSearchParams(window.location.search).has('searchTest') ? ipcRenderer.invoke('test:search-icon') : ({ ok: true, kind: 'fallback' }),
  chooseWallpaper: async () => ({ canceled: true }),
  launchEntry: (entry) => ipcRenderer.invoke('test:launch-entry', entry),
  didaStatus: () => completionTest ? ipcRenderer.invoke('test:dida-status') : Promise.resolve({ state: 'unconnected', message: '隔离测试：未连接' }),
  didaDashboard: () => completionTest ? ipcRenderer.invoke('test:dida-dashboard') : Promise.resolve({ source: 'none', tasks: [], projects: [] }),
  completeDidaTask: (projectId,taskId,occurrence) => ipcRenderer.invoke('test:dida-complete',projectId,taskId,occurrence),
  completeDidaCheckItem:(projectId,taskId,itemId,occurrence,item)=>ipcRenderer.invoke('test:dida-complete-item',projectId,taskId,itemId,occurrence,item),
  connectDida: (write=false) => completionTest ? ipcRenderer.invoke('test:dida-connect',write) : Promise.resolve({ started: false }),
  disconnectDida: async () => ({}),
  setHotkey: value => new URLSearchParams(window.location.search).has('settingsTest') ? ipcRenderer.invoke('test:hotkey',value) : Promise.resolve({ok:true}),
  startupSettings: async () => ({ supported: true, state: 'absent', registered: false, enabled: false, preferences: { mode: 'window', delayMs: 0 } }),
  saveStartupSettings: async (settings) => settings.mode === 'desktop'
    ? ({ supported:true, ok: false, state: 'enabled', registered: true, enabled: true, error: '合成写入失败；系统仍保持已开启。', preferences: settings })
    : ({ supported:true, ok: true, state: settings.enabled ? 'enabled' : 'absent', registered: Boolean(settings.enabled), enabled: Boolean(settings.enabled), preferences: settings }),
  about: async () => ({ version: 'test', buildId: 'test', appPath: 'C:\\synthetic', workingDirectory: 'C:\\synthetic', executablePath: 'C:\\synthetic\\electron.exe', localPageReadyMs: 20, firstDidaDashboardDurationMs: 35, lastDidaDashboardDurationMs: 35, desktopAttachDurationMs: 12, runningForSeconds: 1, desktopAttached: false, metrics: [] }),
  pageReady: () => ipcRenderer.send('test:page-ready'),
  reportMusicState: (value) => ipcRenderer.send('test:music-state', value),
  hide: () => ipcRenderer.invoke('test:hide'),
  performTransition: async () => ({ ok: true }),
  onRequestTransition: () => {},
  onNotice: () => {},
  onDesktopTrialAttached: () => {},
  calendarState: () => new URLSearchParams(window.location.search).has('calendarTest') ? ipcRenderer.invoke('test:calendar-state') : Promise.resolve(null),
  reportCalendarState: (value) => ipcRenderer.send('test:calendar-state', value),
  onCalendarCheck: (callback) => ipcRenderer.on('test:calendar-check', () => callback()),
  windowState: async () => ({ maximized: false })
});
