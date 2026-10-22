'use strict';
const fs=require('node:fs'),path=require('node:path');
const PREVIEW_PROFILE='personal-homepage-portable-preview';
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
    const directory=isolatedTest?path.join(path.dirname(executable),'.isolated-test-profile'):path.join(app.getPath('appData'),PREVIEW_PROFILE);
    const profile=prepareDirectory(directory);
    app.setPath('userData',profile);
    app.setPath('sessionData',prepareDirectory(path.join(profile,'chromium')));
    app.setAppLogsPath(prepareDirectory(path.join(profile,'logs')));
  }
  return {preview,isolatedTest,appId:preview?'com.personalhome.portablepreview':'com.personalhome.desktop'};
}
module.exports={PREVIEW_PROFILE,configureRuntime,prepareDirectory};
