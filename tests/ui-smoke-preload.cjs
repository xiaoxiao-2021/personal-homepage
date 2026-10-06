'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const completionTest=new URLSearchParams(window.location.search).has('completionTest');
window.addEventListener('error', event => ipcRenderer.send('test:page-error', event.message));
window.addEventListener('unhandledrejection', event => ipcRenderer.send('test:page-error', String(event.reason)));
contextBridge.exposeInMainWorld('testControl', { failNextSave: () => ipcRenderer.invoke('test:fail-save') });
contextBridge.exposeInMainWorld('homeApi', {
  loadConfig: () => ipcRenderer.invoke('test:load'),
  saveConfig: (config) => ipcRenderer.invoke('test:save', config),
  backupConfig: async () => ({ canceled: true }),
  restoreConfig: async () => ({ canceled: true }),
  chooseLocalEntry: async () => ({ canceled: true }),
  validateEntry: async (entry) => ({ ok: true, ...entry }),
  entryIcon: async () => ({ ok: true, kind: 'fallback' }),
  chooseWallpaper: async () => ({ canceled: true }),
  launchEntry: (entry) => ipcRenderer.invoke('test:launch-entry', entry),
  didaStatus: () => completionTest ? ipcRenderer.invoke('test:dida-status') : Promise.resolve({ state: 'unconnected', message: '隔离测试：未连接' }),
  didaDashboard: () => completionTest ? ipcRenderer.invoke('test:dida-dashboard') : Promise.resolve({ source: 'none', tasks: [], projects: [] }),
  completeDidaTask: (projectId,taskId,occurrence) => ipcRenderer.invoke('test:dida-complete',projectId,taskId,occurrence),
  connectDida: (write=false) => completionTest ? ipcRenderer.invoke('test:dida-connect',write) : Promise.resolve({ started: false }),
  disconnectDida: async () => ({}),
  setHotkey: async () => ({ ok: true }),
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
