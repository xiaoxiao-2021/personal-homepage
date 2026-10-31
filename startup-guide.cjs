'use strict';
// UI preference only; never stores connection details, keys, or task data.
function createGuide({fs,path,file,fresh}){
  let tail=Promise.resolve();
  async function ordinary(target){try{if((await fs.lstat(target)).isSymbolicLink())throw Error('Guide link rejected');}catch(e){if(e.code!=='ENOENT')throw e;}}
  async function read(){
    try{await ordinary(file);if((await fs.stat(file)).size>1024)throw Error('Invalid guide');const value=JSON.parse(await fs.readFile(file,'utf8'));if(value.version!==1||typeof value.dismissed!=='boolean')throw Error('Invalid guide');return {ok:true,show:!value.dismissed};}
    catch(e){return e.code==='ENOENT'?{ok:true,show:fresh}:{ok:false,show:false,message:'入门偏好暂时无法读取，可从设置中重新打开。'};}
  }
  function dismiss(){
    const write=tail.then(async()=>{await ordinary(file);await ordinary(file+'.tmp');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify({version:1,dismissed:true}),'utf8');await fs.rename(file+'.tmp',file);return {ok:true,show:false};});tail=write.catch(()=>{});return write;
  }
  return {read,dismiss};
}
module.exports={createGuide};
