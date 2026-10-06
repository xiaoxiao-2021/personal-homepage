'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const fs = require('node:fs/promises');
const run = promisify(execFile);

// Parse without executing. Chromium GetArgs() omits switches, so it cannot
// verify our entire login command. Registry reads below target one owned name.
function parseWindowsCommand(command) {
  if (typeof command !== 'string' || command.length > 32768) throw new Error('Invalid command');
  const args = [];let i = 0;
  while (i < command.length) {
    while (i < command.length && /[ \t]/.test(command[i])) i++;
    if (i === command.length) break;
    let value = '', quoted = false;
    while (i < command.length && (quoted || !/[ \t]/.test(command[i]))) {
      let slashes = 0;
      while (command[i] === '\\') { slashes++;i++; }
      if (command[i] === '"') {
        value += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2) value += '"'; else quoted = !quoted;
        i++;
      } else {
        value += '\\'.repeat(slashes);
        if (i < command.length) value += command[i++];
      }
    }
    if (quoted) throw new Error('Unclosed quote');
    args.push(value);
  }
  return args;
}
function samePath(a,b) { return typeof a==='string' && typeof b==='string' && path.win32.normalize(a).toLowerCase()===path.win32.normalize(b).toLowerCase(); }
function inspectStartupRecord(record, expected) {
  const base = { supported:true, name:expected.name, path:expected.path };
  const unknown = { ...base, state:'unknown', registered:null, enabled:null, error:'无法确认 Windows 登录启动项状态。' };
  if (!record || typeof record.registered!=='boolean') return unknown;
  if (!record.registered) return { ...base, state:'absent', registered:false, enabled:false, commandMismatch:false };
  let argv;try { argv=parseWindowsCommand(record.command); } catch { argv=[]; }
  const matched=argv.length===4 && samePath(argv[0],expected.path) && argv[1]==='--disable-gpu'
    && samePath(argv[2],expected.appPath) && argv[3]==='--personal-homepage-login';
  if (!matched) return { ...base, state:'mismatch', registered:true, enabled:false, commandMismatch:true };
  const approval=record.approval;
  if (approval!==null && (!Array.isArray(approval) || approval.length<4 || ![0,2,3,6,7].includes(approval[0]))) return { ...unknown, registered:true };
  const disabled=approval!==null && [3,7].includes(approval[0]);
  return { ...base, state:disabled?'disabled':'enabled', registered:true, enabled:!disabled, disabledByWindows:disabled, commandMismatch:false };
}
async function readOwnedStartupRecord() {
  const executable=path.join(process.env.SystemRoot || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  // Fixed, project-owned read-only query; no interpolated user input and no
  // change to Windows execution policy. This also works with Restricted policy.
  const query=await fs.readFile(path.join(__dirname,'read-startup-record.ps1'),'utf8');
  const {stdout}=await run(executable,['-NoProfile','-NonInteractive','-Command',query],
    {windowsHide:true,timeout:10000,maxBuffer:128*1024,encoding:'utf8'});
  return JSON.parse(stdout.replace(/^\uFEFF/,'').trim());
}
module.exports={parseWindowsCommand,inspectStartupRecord,readOwnedStartupRecord};
