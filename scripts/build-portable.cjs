'use strict';
// Offline, allowlisted Electron prebuilt-binary packaging. No install/download/hooks.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),root=path.resolve(__dirname,'..'),releaseRoot=path.resolve(root,'../releases');
const SOURCE_FILES=['main.cjs','preload.cjs','preload-trial.cjs','portable-runtime.cjs','startup-settings.cjs','startup-record.cjs','read-startup-record.ps1','desktop-bridge.ps1','local-entry.cjs','entry-icon.cjs','dida-completion.cjs','dida-check-items.cjs','task-assistant.cjs','pomodoro.cjs','codex-quota.cjs',
  ...['index.html','desktop-trial.html','renderer.js','task-view.js','visual-polish.css','shared-tools.css','life-modules.css','layout-uniform.css','task-assistant.js','task-assistant.css','pomodoro.js','pomodoro.css','codex-quota.js','codex-quota.css'].map(file=>'src/'+file)];
const RUNTIME_FILES=['electron.exe','chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll','dxcompiler.dll','dxil.dll','ffmpeg.dll','icudtl.dat','libEGL.dll','libGLESv2.dll','LICENSE','LICENSES.chromium.html','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin','version','vk_swiftshader_icd.json','vk_swiftshader.dll','vulkan-1.dll'];
async function assertOrdinary(target){
  const absolute=path.resolve(target),normalized=absolute.replace(/\//g,'\\').toLowerCase(),forbidden='d:\\k science\\r 软件资料';
  if(normalized===forbidden||normalized.startsWith(forbidden+'\\'))throw Error('Protected path rejected');
  let current=path.parse(absolute).root;
  for(const segment of absolute.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,segment);const stat=await fs.lstat(current);if(stat.isSymbolicLink())throw Error('Links are not package inputs');}
  return fs.lstat(absolute);
}
async function copyFile(source,destination){if(!(await assertOrdinary(source)).isFile())throw Error('Expected a regular input file');await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(source,destination,require('node:fs').constants.COPYFILE_EXCL);}
function checkSource(text,file){
  const patterns=[/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,/\b[A-Za-z]:[\\/]+Users[\\/]+13469\b/];
  if(patterns.some(pattern=>pattern.test(text)))throw Error('Sensitive signature in allowlisted source: '+file);
}
async function hashFile(file){return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');}
async function inventory(directory,prefix=''){
  const result=[];for(const item of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const relative=prefix+item.name,target=path.join(directory,item.name);if(item.isSymbolicLink())throw Error('Output link rejected');
    if(item.isDirectory())result.push(...await inventory(target,relative+'/'));
    else if(item.isFile())result.push({path:relative,bytes:(await fs.stat(target)).size,sha256:await hashFile(target)});
    else throw Error('Unsupported output file');
  }return result;
}
async function buildPortable({outputName,archive=true}={}){
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('This offline bundle targets Windows x64 only');
  await assertOrdinary(root);await assertOrdinary(path.join(root,'package.json'));await assertOrdinary(path.join(root,'main.cjs'));
  const manifest=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  const mainSource=await fs.readFile(path.join(root,'main.cjs'),'utf8'),buildId=mainSource.match(/const BUILD_ID = '([\d.]+)'/)?.[1];
  if(!buildId)throw Error('Missing build identifier');
  const name=outputName||`personal-homepage-${manifest.version}-${buildId}-win32-x64`;
  if(!/^[a-zA-Z0-9._-]+$/.test(name)||name==='.'||name==='..')throw Error('Unsafe release name');
  await assertOrdinary(path.dirname(releaseRoot));await fs.mkdir(releaseRoot,{recursive:true});await assertOrdinary(releaseRoot);
  const destination=path.join(releaseRoot,name);await fs.mkdir(destination); // Refuse to overwrite any existing build.
  const runtimeRoot=path.join(root,'node_modules/electron/dist');await assertOrdinary(runtimeRoot);
  const runtimeVersion=(await fs.readFile(path.join(runtimeRoot,'version'),'utf8')).trim();
  if(runtimeVersion!=='39.8.10')throw Error('Unexpected installed Electron runtime; review before packaging');
  for(const file of RUNTIME_FILES)await copyFile(path.join(runtimeRoot,file),path.join(destination,file==='electron.exe'?'个人首页.exe':file==='LICENSE'?'LICENSE.electron.txt':file));
  // Locales are runtime-only .pak files, not a recursively copied user directory.
  const localeRoot=path.join(runtimeRoot,'locales');await assertOrdinary(localeRoot);
  for(const file of await fs.readdir(localeRoot)){if(!/^[a-zA-Z0-9_-]+\.pak$/.test(file))throw Error('Unexpected locale input');await copyFile(path.join(localeRoot,file),path.join(destination,'locales',file));}
  const appRoot=path.join(destination,'resources/app');
  for(const file of SOURCE_FILES){await assertOrdinary(path.join(root,file));checkSource(await fs.readFile(path.join(root,file),'utf8'),file);await copyFile(path.join(root,file),path.join(appRoot,file));}
  const packaged={name:'personal-homepage-portable-preview',productName:'个人首页 · 免安装测试版',version:manifest.version,description:manifest.description,main:'main.cjs',private:true,homepageDistribution:'portable-preview'};
  await fs.writeFile(path.join(appRoot,'package.json'),JSON.stringify(packaged,null,2)+'\n',{flag:'wx'});
  await copyFile(path.join(root,'PORTABLE.md'),path.join(destination,'使用说明.txt'));
  const files=await inventory(destination);
  await fs.writeFile(path.join(destination,'portable-manifest.json'),JSON.stringify({version:manifest.version,buildId,electron:runtimeVersion,platform:'win32',arch:'x64',distribution:'portable-preview',files},null,2)+'\n',{flag:'wx'});
  const result={directory:destination,files:files.length+1,version:manifest.version,buildId,electron:runtimeVersion};
  if(archive){
    const zip=destination+'.zip';try{await fs.lstat(zip);throw Error('Archive already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
    const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    await run(powershell,['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:HOMEPAGE_ARCHIVE_SOURCE,$env:HOMEPAGE_ARCHIVE_TARGET,[System.IO.Compression.CompressionLevel]::Optimal,$true)"],{windowsHide:true,timeout:300000,env:{...process.env,HOMEPAGE_ARCHIVE_SOURCE:destination,HOMEPAGE_ARCHIVE_TARGET:zip}});
    result.zip=zip;result.zipBytes=(await fs.stat(zip)).size;result.sha256=await hashFile(zip);
    await fs.writeFile(zip+'.sha256',`${result.sha256}  ${path.basename(zip)}\n`,{flag:'wx'});
  }
  return result;
}
module.exports={SOURCE_FILES,RUNTIME_FILES,checkSource,inventory,buildPortable};
if(require.main===module)buildPortable({outputName:process.argv[2]}).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
