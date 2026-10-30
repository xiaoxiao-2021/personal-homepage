'use strict';
(function(root){
  const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase().trim();
  function collect(config,dashboard,scenes){
    const entries=new Map(),tasks=[],projects=new Map((dashboard?.projects||[]).map(p=>[p.id,p.name]));
    for(const scene of scenes){
      const value=config.scenes?.[scene];
      for(const [id,label] of [...(value?.apps||[]).map(id=>[id,'']),...(value?.side||[]).map(([label,id])=>[id,label])]){
        const item=config.library?.[id];if(!item)continue;
        if(!entries.has(id))entries.set(id,{kind:'entry',id,title:String(item.name||'未命名入口'),scenes:[],labels:[],configured:['application','file','folder','website'].includes(item.kind)&&Boolean(item.target?.trim()),description:String(item.description||''),type:String(item.type||'')});
        const row=entries.get(id);if(!row.scenes.includes(scene))row.scenes.push(scene);if(label&&!row.labels.includes(label))row.labels.push(label);
      }
    }
    const failed=new Set(dashboard?.failedProjectIds||[]),seen=new Set();
    if(['live','cache','partial'].includes(dashboard?.source)&&!(dashboard.source==='partial'&&Number(dashboard.failedCount)>0&&!failed.size))for(const task of dashboard.tasks||[]){
      const key=JSON.stringify([task.projectId,task.id]);
      if(!task.id||!task.projectId||Number(task.status)===2||!projects.has(task.projectId)||failed.has(task.projectId)||seen.has(key))continue;
      seen.add(key);
      const base={projectId:task.projectId,taskId:task.id,projectName:projects.get(task.projectId),date:root.HomeTaskView?.taskDay(task)||'',parentTitle:String(task.title||'未命名任务')};
      tasks.push({...base,kind:'task',title:base.parentTitle});
      const children=Array.isArray(task.checkItems)?task.checkItems:task.subtasks||[];
      children.forEach((item,index)=>{if(Array.isArray(task.checkItems)?Number(item.status)!==0:Number(item.status)===2)return;tasks.push({...base,kind:'subtask',itemId:item.id||'',itemIndex:index,title:String(item.title||'未命名小项')});});
    }
    return [...entries.values(),...tasks].map(row=>({...row,search:normalize([row.title,row.kind==='entry'?[row.type,row.description,...row.scenes,...row.labels].join(' '):[row.projectName,row.kind==='subtask'?row.parentTitle:''].join(' ')].join(' '))}));
  }
  function query(index,value,currentScene,limit=60){
    const words=normalize(value).split(/\s+/).filter(Boolean);if(!words.length)return {rows:[],total:0};
    const matches=index.filter(row=>words.every(word=>row.search.includes(word)));
    const score=row=>(normalize(row.title)===normalize(value)?0:normalize(row.title).startsWith(words[0])?1:2)+(row.kind==='entry'&&row.scenes.includes(currentScene)?0:.1);
    matches.sort((a,b)=>score(a)-score(b)||a.title.localeCompare(b.title,'zh-CN'));
    // Both groups remain reachable even when many entries match.
    const rows=[];for(const group of ['entry','task'])rows.push(...matches.filter(row=>group==='entry'?row.kind==='entry':row.kind!=='entry').slice(0,limit));
    return {rows,total:matches.length};
  }
  function sourceMessage(dashboard){
    return ({live:'搜索已加载的未完成任务与小项',cache:'任务结果来自离线缓存；可能不是最新状态',partial:'部分清单读取失败，搜索范围不完整',none:'滴答未连接，当前仅搜索入口',error:'任务读取失败，当前仅搜索入口',expired:'任务授权已过期，当前仅搜索入口'})[dashboard?.source]||'任务尚未读取，当前仅搜索入口';
  }
  root.HomeSearch={collect,query,sourceMessage};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.HomeSearch;
})(globalThis);
