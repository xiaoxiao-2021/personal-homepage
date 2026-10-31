'use strict';
// Synthetic encryption only. A fresh process per phase; never reads application profiles.
const fs=require('node:fs'),path=require('node:path');
if(process.versions.electron){
  const {app,safeStorage}=require('electron');
  let profile=process.env.HOMEPAGE_PROBE_PROFILE;const phase=process.env.HOMEPAGE_PROBE_PHASE;
  if(process.env.HOMEPAGE_PROBE_FIXED==='1'){
    require('../portable-runtime.cjs').configureRuntime({isPackaged:true,getPath:key=>app.getPath(key),setPath:(...args)=>app.setPath(...args),setAppLogsPath:value=>app.setAppLogsPath(value)},{homepageDistribution:'portable-preview'},{argv:['--personal-homepage-isolated-test'],executable:path.join(profile,'fake.exe')});
    profile=app.getPath('userData');
  }else{app.setPath('userData',profile);app.setPath('sessionData',path.join(profile,'chromium'));}
  app.disableHardwareAcceleration();
  app.whenReady().then(()=>{
    let recovered=false,encrypted=false;
    try{const file=path.join(profile,'sample.bin');if(phase==='write'){fs.writeFileSync(file,safeStorage.encryptString('synthetic restart check'));encrypted=true;}else recovered=safeStorage.decryptString(fs.readFileSync(file))==='synthetic restart check';}catch{}
    fs.writeFileSync(path.join(process.env.HOMEPAGE_PROBE_PROFILE,phase+'.json'),JSON.stringify({...(phase==='write'?{encrypted}:{recovered}),sessionLength:app.getPath('sessionData').length}));
    setTimeout(()=>app.quit(),1500);
  });
}else{
  const {spawnSync}=require('node:child_process');
  const fixed=process.argv.includes('--fixed');
  const root=path.resolve(__dirname,'../test-results/storage-path-'+(fixed?'fixed':'baseline'));fs.mkdirSync(root,{recursive:true});
  const rows=[];
  for(const length of [180,208,210,230]){
    const profile=path.join(root,'x'.repeat(length-root.length-1));fs.mkdirSync(path.join(profile,'chromium'),{recursive:true});
    for(const phase of ['write','read']){
      const env={...process.env,HOMEPAGE_PROBE_PROFILE:profile,HOMEPAGE_PROBE_PHASE:phase,HOMEPAGE_PROBE_FIXED:fixed?'1':'0'};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
      const result=spawnSync(path.resolve(__dirname,'../node_modules/electron/dist/electron.exe'),[__filename],{env,windowsHide:true,timeout:20000,encoding:'utf8'});
      const record=path.join(profile,phase+'.json');if(result.status!==0||!fs.existsSync(record))throw Error('Probe did not complete: '+length+'/'+phase);
    }
    const actual=fixed?require('../portable-runtime.cjs').isolatedProfile(path.join(profile,'fake.exe'),require('node:os').tmpdir()):profile;
    rows.push({requestedProfileLength:profile.length,encrypted:JSON.parse(fs.readFileSync(path.join(profile,'write.json'))).encrypted,...JSON.parse(fs.readFileSync(path.join(profile,'read.json'))),localStateExists:fs.existsSync(path.join(actual,'chromium','Local State'))});
  }
  fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows));
}
