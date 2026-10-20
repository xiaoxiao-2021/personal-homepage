'use strict';
// Narrow check-item completion only; never accepts a renderer-supplied task body.
const {hasWriteScope,occurrenceKey}=require('./dida-completion.cjs');
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const itemKey=item=>JSON.stringify([String(item.id||''),String(item.title||''),Number(item.status??0)]);
function createCheckItemCompletion({getCredential,getDashboard,fetch:request,apiUrl,now=Date.now}){
  const flights=new Map(),fail=(code,message)=>({ok:false,code,message});
  async function perform(projectId,taskId,itemId,expectedOccurrence,expectedItem){
    const credential=await getCredential();
    if(!credential||(credential.expiresAt&&now()>=credential.expiresAt))return fail('expired','授权不可用或已过期，请刷新核对。');
    if(!hasWriteScope(credential))return fail('scope','当前为只读授权，请先启用首页完成任务。');
    const dashboard=getDashboard();
    if(!dashboard||!['live','partial'].includes(dashboard.source))return fail('offline','离线缓存不能同步小项，请联网刷新。');
    if(dashboard.source==='partial'&&(!Array.isArray(dashboard.failedProjectIds)||dashboard.failedProjectIds.includes(projectId)))return fail('unavailable','此清单未成功读取，请先刷新。');
    const known=dashboard.tasks?.find(task=>task.id===taskId&&task.projectId===projectId&&Number(task.status)===0);
    const knownItem=known?.checkItems?.find(item=>item.id===itemId);
    if(!knownItem)return fail('unknown','小项未成功读取或已变化，请刷新后重试。');
    if(occurrenceKey(known)!==expectedOccurrence||itemKey(knownItem)!==expectedItem)return fail('changed','小项或任务已变化，请刷新后重新操作。');
    const url=`${apiUrl}/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`;
    const headers={Authorization:`Bearer ${credential.accessToken}`,Accept:'application/json'};
    let submitted=false;
    const read=async()=>{
      const response=await request(url,{headers,signal:AbortSignal.timeout(15000),redirect:'error'});
      if(!response.ok)throw Object.assign(new Error('read'),{http:response.status});
      const task=await response.json();
      if(task.id!==taskId||task.projectId!==projectId)throw Object.assign(Error('identity'),{checkCode:'mismatch'});
      return task;
    };
    try{
      const current=await read();
      if(Number(current.status)!==0||occurrenceKey(current)!==expectedOccurrence)return fail('changed','父任务或重复安排已变化，请先刷新；未提交小项。');
      if(!Array.isArray(current.items)||current.items.some(item=>!validId(item.id))||new Set(current.items.map(item=>item.id)).size!==current.items.length)return fail('unsupported','检查项标识无法安全确认，未提交修改。');
      const item=current.items.find(item=>item.id===itemId);
      if(!item)return fail('missing','小项已删除或移动，请刷新列表。');
      if(Number(item.status)===1)return {ok:true,alreadyCompleted:true,task:current};
      if(Number(item.status)!==0||itemKey(item)!==expectedItem)return fail('changed','这个小项已被修改，请刷新后重新勾选。');
      // Carry the latest documented editable fields unchanged. Never copy parent
      // status/completedTime or call the parent's /complete endpoint.
      const body={id:taskId,projectId};
      for(const key of ['title','content','desc','isAllDay','startDate','dueDate','timeZone','reminders','tags','repeatFlag','repeatFrom','priority','sortOrder','kind','parentId','assigneeUsername'])if(Object.hasOwn(current,key))body[key]=current[key];
      body.items=current.items.map(value=>value.id===itemId?{...value,status:1,completedTime:new Date(now()).toISOString().replace(/\.\d{3}Z$/,'+0000')}:{...value});
      const encoded=JSON.stringify(body);if(Buffer.byteLength(encoded)>1024*1024)return fail('unsupported','任务内容过大，已停止修改。');
      submitted=true;
      const response=await request(`${apiUrl}/task/${encodeURIComponent(taskId)}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:encoded,signal:AbortSignal.timeout(15000),redirect:'error'});
      if(!response.ok){
        if(response.status===401)return fail('expired','授权已过期，小项完成未确认。');
        if(response.status===403)return fail('permission','滴答拒绝修改此小项，请检查清单写入权限。');
        if(response.status===404)return fail('missing','任务已移动或删除，请刷新。');
        return fail('uncertain','滴答未确认小项修改，请先刷新核对，不要连续重试。');
      }
      // Even an empty 201 is not a verified check mark: read back once.
      const confirmed=await read();
      if(Number(confirmed.status)!==0||occurrenceKey(confirmed)!==expectedOccurrence)return fail('uncertain','任务状态已变化，请到滴答核对父任务；首页不会自动撤销或重建。');
      if(!Array.isArray(confirmed.items))return fail('uncertain','未读到完整的小项列表，请刷新核对。');
      const confirmedIds=new Set(confirmed.items.map(value=>value.id));
      if(confirmedIds.size!==confirmed.items.length||current.items.some(value=>!confirmedIds.has(value.id)))return fail('uncertain','小项列表发生变化，请到滴答核对；首页不会自动重建或撤销。');
      if(!confirmed.items.some(value=>value.id===itemId&&Number(value.status)===1))return fail('uncertain','服务尚未确认这个小项已完成，请刷新核对。');
      return {ok:true,task:confirmed};
    }catch(error){
      if(submitted)return fail('uncertain','小项提交结果尚未确认，请先刷新核对；未自动重试。');
      if(error.checkCode==='mismatch')return fail('mismatch','服务返回的任务身份不一致，未提交修改。');
      if(error.http===401)return fail('expired','授权已过期，请刷新核对。');
      if(error.http===403)return fail('permission','此任务无法访问，请检查清单权限。');
      if(error.http===404)return fail('missing','任务已移动或删除，请刷新。');
      return fail('network','无法核对最新小项状态，未提交修改，请联网后重试。');
    }
  }
  return {complete(projectId,taskId,itemId,occurrence,item){
    if(![projectId,taskId,itemId].every(validId)||typeof occurrence!=='string'||occurrence.length>2048||typeof item!=='string'||item.length>16384)return Promise.resolve(fail('invalid','小项标识无效，已停止操作。'));
    const key=JSON.stringify([projectId,taskId]);
    if(flights.has(key))return Promise.resolve(fail('busy','这个父任务正在同步，请等结果返回后再操作。'));
    const pending=perform(projectId,taskId,itemId,occurrence,item).finally(()=>flights.delete(key));flights.set(key,pending);return pending;
  }};
}
module.exports={createCheckItemCompletion,itemKey};
