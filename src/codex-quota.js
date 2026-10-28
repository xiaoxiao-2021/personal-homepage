/* Quota-only view. No credentials, model calls, reset redemption or task data. */
(() => {
  const panel=document.querySelector('[data-module="codexQuota"]');
  const get=id=>document.getElementById(id),button=get('quotaRefresh');
  let snapshot=null,busy=false,lastUiRead=0,timer=null,stopped=false;
  const dateFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const fullFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const active=()=>window.homepageReady&&!document.hidden&&!panel.hidden;
  const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const percent=w=>w.remainingPercent===null?'暂不可用':`${w.remainingPercent}%`;
  function label(w){const m=w.windowDurationMins;const duration=m===null?'额度窗口':m===10080?'每周窗口':m%1440===0?`${m/1440}天窗口`:m%60===0?`${m/60}小时窗口`:`${m}分钟窗口`;return (w.bucket==='codex'?'':`${w.bucket} · `)+duration;}
  function relative(timestamp){const minutes=Math.ceil((timestamp-Date.now())/60000);if(minutes<=0)return '已到刷新时间，待确认';const d=Math.floor(minutes/1440),h=Math.floor(minutes%1440/60),m=minutes%60;return `约${d?d+'天 ':''}${h?h+'小时 ':''}${m||(!d&&!h)?m+'分钟':''}后刷新`;}
  function render(){
    const collapsed=state.tools?.codexQuotaCollapsed!==false;
    panel.classList.toggle('is-collapsed',collapsed);
    get('quotaDetails').hidden=collapsed;get('quotaCollapse').textContent=collapsed?'展开':'收起';get('quotaCollapse').setAttribute('aria-expanded',String(!collapsed));
    get('quotaCollapse').disabled=layoutSaveInFlight;button.disabled=busy;
    button.textContent=busy?'读取中…':snapshot?.status==='missing'?'重新检测':'刷新';panel.setAttribute('aria-busy',String(busy));
    if(!snapshot){get('quotaSummary').textContent='尚未读取';return;}
    const windows=Array.isArray(snapshot.windows)?snapshot.windows:[],summary=get('quotaSummary');summary.replaceChildren();
    if(!windows.length)summary.textContent=snapshot.status==='missing'?'未找到查询程序':'额度暂不可用';
    for(const w of windows.slice(0,2))summary.append(node('span','quota-chip',`${label(w).replace(/窗口$/,'')} · ${snapshot.stale||w.resetsAt!==null&&w.resetsAt<=Date.now()?'上次剩余':'剩余'} ${percent(w)}`));
    if(windows.length>2)summary.append(node('span','module-muted',`另 ${windows.length-2} 个窗口，展开查看`));
    const dated=windows.filter(w=>w.resetsAt!==null).sort((a,b)=>a.resetsAt-b.resetsAt),nearest=dated[0];
    get('quotaNearest').textContent=nearest?`${relative(nearest.resetsAt)} · ${dateFormat.format(nearest.resetsAt)}（北京时间）`:windows.length?'自然刷新时间：暂不可用':'';
    const credits=snapshot.resetCredits||{},count=credits.availableCount;
    get('quotaCredits').textContent=`可用重置：${Number.isSafeInteger(count)?count+' 次':'暂不可用'}`+(credits.expirations?.length?` · 最早 ${dateFormat.format(credits.expirations[0])} 到期（北京时间）`:'');
    const host=get('quotaDetails');host.replaceChildren();
    if(!collapsed){
      for(const w of windows){
        const row=node('section','quota-window'),head=node('div','quota-window-head');
        head.append(node('span','',label(w)),node('strong','',percent(w)));row.append(head);
        if(w.remainingPercent!==null){const progress=document.createElement('progress');progress.max=100;progress.value=w.remainingPercent;progress.setAttribute('aria-label',`${label(w)} 剩余 ${w.remainingPercent}%`);row.append(progress);}
        row.append(node('div','module-muted',w.resetsAt===null?'刷新时间：暂不可用':`${fullFormat.format(w.resetsAt)}（北京时间） · ${relative(w.resetsAt)}`));host.append(row);
      }
      host.append(node('p','module-muted quota-explanation','只显示官方返回的额度窗口；不预测提前重置，不自动使用重置机会。接口未返回的字段保持未知。'));
    }
    const expired=windows.some(w=>w.resetsAt!==null&&w.resetsAt<=Date.now());
    get('quotaStatus').textContent=busy?'正在读取本机 Codex 额度…':snapshot.status==='ok'?(expired?'已到刷新时间，正在等待官方新数据；不代表额度已恢复。':'官方查询 · 只读，不消耗重置机会。'):snapshot.message||'额度暂不可用。';
    get('quotaStatus').classList.toggle('quota-warning',snapshot.status!=='ok');
    if(!busy&&snapshot.programFound&&snapshot.status!=='ok')get('quotaStatus').textContent='已找到查询程序 · '+get('quotaStatus').textContent;
    const sources={desktop:'官方桌面版',npm:'命令行版',path:'系统路径',override:'指定程序'};
    if(!busy&&snapshot.status==='ok'&&sources[snapshot.programSource])get('quotaStatus').textContent=sources[snapshot.programSource]+' · '+get('quotaStatus').textContent;
    get('quotaUpdated').textContent=snapshot.fetchedAt?`${snapshot.stale?'上次成功':'更新于'} ${dateFormat.format(snapshot.fetchedAt)}（北京时间）`:'尚无成功记录';
    if(snapshot.status!=='ok'&&/^\d{4}\.\d{2}\.\d{2}\.\d+$/.test(snapshot.build||''))get('quotaUpdated').textContent+=` · 检测构建 ${snapshot.build}`;
  }
  async function read(force=false){
    if(stopped||busy||!active())return;busy=true;lastUiRead=Date.now();render();
    try{snapshot=await window.homeApi.codexQuota(force);}catch{snapshot={...(snapshot||{}),status:'unavailable',stale:true,message:'额度连接失败，请稍后刷新。'};}
    finally{busy=false;if(!stopped)render();}
  }
  button.onclick=()=>read(true);
  get('quotaCollapse').onclick=()=>{
    if(layoutSaveInFlight){toast('布局正在保存，请稍候。');return;}
    if(!editing)startEdit();state.tools=normalizeTools(state.tools);state.tools.codexQuotaCollapsed=!state.tools.codexQuotaCollapsed;
    render();toast('额度卡片折叠设置影响五个场景；保存布局后保留，取消可恢复。');
  };
  function onLayout(){render();if(active()&&(!lastUiRead||Date.now()-lastUiRead>=300000))void read();}
  function onVisible(){if(active()){render();void read();}}
  function tick(){timer=null;if(stopped)return;if(active()){render();const reached=snapshot?.windows?.some(w=>w.resetsAt!==null&&w.resetsAt<=Date.now());if(Date.now()-lastUiRead>=(reached?60000:300000))void read();}timer=setTimeout(tick,60000);}
  window.addEventListener('homepage-tools-rendered',onLayout);window.addEventListener('homepage-ready',onVisible);
  window.addEventListener('focus',onVisible);document.addEventListener('visibilitychange',onVisible);
  window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);window.removeEventListener('homepage-tools-rendered',onLayout);window.removeEventListener('homepage-ready',onVisible);window.removeEventListener('focus',onVisible);document.removeEventListener('visibilitychange',onVisible);},{once:true});
  render();if(window.homepageReady)onVisible();timer=setTimeout(tick,60000);
})();
