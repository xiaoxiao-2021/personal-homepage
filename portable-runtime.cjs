'use strict';
const fs=require('node:fs'),path=require('node:path');
const PREVIEW_PROFILE='personal-homepage-portable-preview';
// Chromium also creates longer temporary names beneath sessionData on Windows.
const MAX_SESSION_PATH=200;
function isolatedProfile(executable,temp){
  const id=require('node:crypto').createHash('sha256').update(path.resolve(executable).toLowerCase()).digest('hex').slice(0,20);
  return path.join(temp,'homepage-isolated',id);
}
function assertSessionPath(directory,platform=process.platform){
  if(platform==='win32'&&path.resolve(directory).length>MAX_SESSION_PATH)throw Error('本机数据目录过长，无法可靠保存加密数据。请使用较短的 Windows 用户数据路径；原有数据未移动或删除。');
}
function prepareDirectory(directory){
  const absolute=path.resolve(directory),normalized=absolute.replace(/\//g,'\\').toLowerCase();
  const forbidden='d:\\k science\\r 软件资料';
  if(normalized===forbidden||normalized.startsWith(forbidden+'\\'))throw Error('拒绝受保护的数据目录。');
  let current=path.parse(absolute).root;
  for(const part of absolute.slice(current.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    try{const stat=fs.lstatSync(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('数据目录包含链接或非目录。');}
    catch(error){if(error.code!=='ENOENT')throw error;break;}
  }
  fs.mkdirSync(absolute,{recursive:true});return absolute;
}
function configureRuntime(app,manifest,{argv=process.argv,executable=process.execPath}={}){
  const preview=app.isPackaged===true&&manifest.homepageDistribution==='portable-preview';
  const isolatedTest=preview&&argv.includes('--personal-homepage-isolated-test');
  if(preview){
    // Executable depth must not determine Chromium's key-storage path in diagnostics.
    // Stable across process restarts; distinct for each extracted test executable.
    const directory=isolatedTest?isolatedProfile(executable,app.getPath('temp')):path.join(app.getPath('appData'),PREVIEW_PROFILE);
    assertSessionPath(path.join(directory,'chromium'));
    const profile=prepareDirectory(directory);
    app.setPath('userData',profile);
    app.setPath('sessionData',prepareDirectory(path.join(profile,'chromium')));
    app.setAppLogsPath(prepareDirectory(path.join(profile,'logs')));
  }
  assertSessionPath(app.getPath('sessionData'));
  return {preview,isolatedTest,appId:preview?'com.personalhome.portablepreview':'com.personalhome.desktop'};
}
module.exports={PREVIEW_PROFILE,configureRuntime,prepareDirectory,isolatedProfile,assertSessionPath,MAX_SESSION_PATH};
