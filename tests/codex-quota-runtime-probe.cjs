'use strict';
// Local executable discovery only. No authentication files or account requests.
const {app}=require('electron'),fs=require('node:fs/promises'),path=require('node:path');
const quota=require('../codex-quota.cjs');
const {validateEntry}=require('../local-entry.cjs');
const output=path.resolve(__dirname,'../test-results/codex-quota/runtime-probe.json');
app.setPath('userData',path.join(path.dirname(output),'runtime-probe-profile'));
app.disableHardwareAcceleration();
(async()=>{
  await app.whenReady();
  const report={electron:process.versions.electron,arch:process.arch,hasAppData:!!process.env.APPDATA,hasPath:!!(process.env.PATH||process.env.Path),found:false,scope:'Isolated Electron main-process executable discovery only; no account query, token access, app startup or system changes.'};
  const desktopOnly=process.argv.includes('--desktop-only');
  const appData=app.getPath('appData'),localAppData=process.env.LOCALAPPDATA||path.join(path.dirname(appData),'Local');
  const find=()=>quota.locateExecutable({...(desktopOnly?{env:{},appData:null,localAppData}:{appData,localAppData})});
  try{const located=await find();report.found=true;report.source=located.source;}catch(error){report.code=error.quotaCode||'unknown';}
  if(process.argv.includes('--query')){
    const service=quota.createService({find}),state=await service.read();service.dispose();
    report.query={status:state.status,programFound:state.programFound,programSource:state.programSource,windows:state.windows.map(w=>({durationMins:w.windowDurationMins,hasRemaining:w.remainingPercent!==null,hasReset:w.resetsAt!==null})),hasResetCount:state.resetCredits.availableCount!==null};
    report.scope='Real isolated Electron main process; installed Codex read-only rate-limits query. No model/thread/login/reset calls, raw reply, quota values, identities or credential file access by homepage code.';
  }
  // Diagnose only a known npm installation candidate, not directories or files.
  if(process.env.APPDATA){
    const target=path.join(process.env.APPDATA,'npm','node_modules','@openai','codex','node_modules','@openai',`codex-win32-${process.arch}`,'vendor',`${process.arch==='arm64'?'aarch64':'x86_64'}-pc-windows-msvc`,'bin','codex.exe');
    const checked=await validateEntry({kind:'application',target});
    report.knownCandidateValid=checked.ok;report.validationMessage=checked.ok?null:checked.error;
    try{const stat=await fs.lstat(target);report.candidateIsFile=stat.isFile();report.candidateIsLink=stat.isSymbolicLink();}catch(error){report.candidateStatError=error.code;}
  }
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2));app.exit(0);
})().catch(()=>app.exit(1));
