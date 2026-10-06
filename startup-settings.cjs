'use strict';
const { inspectStartupRecord, readOwnedStartupRecord } = require('./startup-record.cjs');

const STARTUP_ARGUMENT = '--personal-homepage-login';
const STARTUP_NAME = '个人首页';
const ALLOWED_MODES = new Set(['window', 'desktop']);
const ALLOWED_DELAYS = new Set([0, 10_000, 30_000]);

function normalizeStartupPreferences(value = {}) {
  return {
    mode: ALLOWED_MODES.has(value.mode) ? value.mode : 'window',
    delayMs: ALLOWED_DELAYS.has(Number(value.delayMs)) ? Number(value.delayMs) : 0
  };
}

function startupArguments(appPath) {
  // Electron 39.8.10 quotes arguments in FormatCommandLineString itself.
  return ['--disable-gpu', appPath, STARTUP_ARGUMENT];
}


function decideLoginItemChange(status, desiredEnabled) {
  if (status?.error || status?.state === 'unknown' || status?.registered === null) return 'unknown';
  if (status?.commandMismatch && Boolean(desiredEnabled) === Boolean(status.registered)) return 'mismatch';
  return Boolean(desiredEnabled) === Boolean(status?.registered) ? 'unchanged' : 'change';
}

function createLoginItemAdapter({ app, platform = process.platform, executablePath, appPath, name = STARTUP_NAME, readRecord = readOwnedStartupRecord }) {
  const args = startupArguments(appPath);
  const expected = { name, path: executablePath, appPath, args, platform };

  async function read() {
    if (platform !== 'win32') return { supported: false, registered: false, enabled: false, disabledByWindows: false, name, path: executablePath };
    try {
      return inspectStartupRecord(await readRecord(), expected);
    } catch {
      return { supported: true, state: 'unknown', registered: null, enabled: null, disabledByWindows: false, commandMismatch: false, error: '无法读取 Windows 登录启动项状态。', name, path: executablePath };
    }
  }

  async function setEnabled(enabled) {
    if (platform !== 'win32') return { ok: false, ...await read(), error: '登录自启动仅支持 Windows。' };
    try {
      app.setLoginItemSettings({
        openAtLogin: Boolean(enabled),
        path: executablePath,
        args,
        name,
        enabled: Boolean(enabled)
      });
      const status = await read();
      const ok = enabled ? status.state === 'enabled' : status.state === 'absent';
      return { ok, ...status, error: ok ? undefined : status.error || (status.commandMismatch
        ? '启动项已存在，但路径或参数与当前程序不一致；Windows 未确认更改成功。'
        : 'Windows 未确认登录启动项已更新。') };
    } catch {
      const status = await read();
      return { ok: false, ...status, error: status.state === 'unknown'
        ? 'Windows 未能更新启动项，且无法读取更新后的状态；当前状态未知。'
        : 'Windows 未能更新本软件的登录启动项。' };
    }
  }

  return { read, setEnabled, expected };
}

module.exports = {
  STARTUP_ARGUMENT,
  STARTUP_NAME,
  normalizeStartupPreferences,
  startupArguments,
  decideLoginItemChange,
  createLoginItemAdapter
};
