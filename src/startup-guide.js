/* Optional local setup guide. No authorization or model request is started here. */
(()=>{
  const api=window.homeApi,dialog=document.querySelector('#guideDialog');
  const get=id=>document.getElementById(id);let busy=false,opener=null,openSequence=0;
  const status=text=>get('guideStatus').textContent=text;
  function update(){
    const facts=window.homepageGuideContext?.();if(!facts)return;
    get('guideEntryState').textContent=facts.hasEntries?'已有入口 · 可以继续添加':'还没有设置入口';
    get('guideDidaState').textContent=facts.dida;
  }
  async function open(){
    if(busy||dialog.open)return;
    if(window.homepageGuideContext?.().editing){toast('请先保存或取消布局编辑，再打开使用入门。');return;}
    if(window.homepageGuideContext?.().settingsDirty){toast('请先保存或取消设置中的修改，再打开使用入门。');return;}
    if(document.querySelector('dialog[open]:not(#settingsDialog)')){toast('请先关闭当前窗口，再打开使用入门。');return;}
    opener=document.activeElement;get('settingsDialog').close();update();
    status('以后可在「设置 → 使用入门」继续。');dialog.showModal();get('guideClose').focus({preventScroll:true});dialog.scrollTop=0;
    const sequence=++openSequence;get('guideAiState').textContent='正在检查本机配置…';
    try{const value=await api.assistantStatus();if(sequence!==openSequence)return;get('guideAiState').textContent=value.configured?'密钥已保存 · 未发起连接测试':'尚未配置 · 不影响其他功能';}
    catch{if(sequence===openSequence)get('guideAiState').textContent='配置暂时无法读取 · 可稍后重试';}
  }
  async function leave(action){
    if(busy)return;busy=true;const buttons=[...dialog.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    try{
      const result=await api.dismissGuide();if(!result?.ok)throw Error('save');
      dialog.close();openSequence++;
      if(action==='entry')window.homepageGuideAction('entry');
      else if(action==='dida')window.homepageGuideAction('dida');
      else if(action==='ai')get('aiSettings').click();
      else (opener?.isConnected&&opener.getClientRects().length?opener:get('settingsBtn')).focus({preventScroll:true});
    }catch{status('入门偏好未能保存，请重试；现有设置没有改变。');}
    finally{busy=false;buttons.forEach(b=>b.disabled=false);}
  }
  for(const [id,action]of [['guideEntry','entry'],['guideDida','dida'],['guideAi','ai'],['guideSkip',null],['guideClose',null]])get(id).onclick=()=>void leave(action);
  dialog.addEventListener('cancel',event=>{event.preventDefault();void leave(null);});
  get('guideOpen').onclick=()=>void open();
  window.addEventListener('homepage-connection-state',update);
  async function initialize(){
    if(!api.guideState)return;
    try{const value=await api.guideState();if(value.ok&&value.show&&!document.querySelector('dialog[open]'))await open();}catch{/* Still accessible from Settings; no repeated popup or poll. */}
  }
  if(window.homepageReady)void initialize();else window.addEventListener('homepage-ready',initialize,{once:true});
})();
