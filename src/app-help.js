/* Settings-only help. Public release text is rendered as text, never HTML. */
(()=>{
  const api=window.homeApi,get=id=>document.getElementById(id);let metadataLoaded=false,busy=false;
  const messages={NETWORK_ERROR:'网络暂时不可用，请稍后重试。',TIMEOUT:'连接超时，请稍后重试。',RATE_LIMIT:'GitHub 请求受限，请稍后重试或查看发布页。',NOT_FOUND:'暂时找不到公开发布，请查看发布页。',HTTP_ERROR:'发布服务暂不可用，请稍后重试。',INVALID_RESPONSE:'发布信息格式无法识别，请查看发布页。',ISOLATED:'隔离测试模式未连接更新服务。'};
  async function metadata(){if(metadataLoaded||!api.helpMetadata)return;try{const r=await api.helpMetadata();if(r.version&&r.build){get('helpVersion').textContent=`${r.version} 测试版 · ${r.build}`;metadataLoaded=true;}}catch{get('helpVersion').textContent='版本暂不可读';}}
  new MutationObserver(()=>{if(get('settingsDialog').open)void metadata();}).observe(get('settingsDialog'),{attributes:true,attributeFilter:['open']});
  get('helpCheck').onclick=async()=>{
    if(busy)return;busy=true;get('helpCheck').disabled=true;get('helpCheck').setAttribute('aria-busy','true');get('helpUpdateStatus').textContent='正在检查公开发布…';get('helpRelease').hidden=true;
    try{const r=await api.checkUpdates();
      const text={available:'有新版本可下载。',current:'已是当前发布版本。',ahead:'当前版本比公开发布更新。',empty:'暂时没有可识别的公开版本。'}[r.state]||messages[r.code]||'检查未完成，请稍后重试。';
      get('helpUpdateStatus').textContent=text+(r.cached?'（最近检查结果）':'');
      if(r.tag){get('helpReleaseTitle').textContent=r.tag+(r.prerelease?' · 测试版':' · 正式版');get('helpReleaseNotes').textContent=r.notes||'此版本暂未提供更新说明。';get('helpRelease').hidden=false;}
      if(get('helpDiagnosticDetails').open)await summary();
    }catch{get('helpUpdateStatus').textContent='检查未完成，请稍后重试。';}
    finally{busy=false;get('helpCheck').disabled=false;get('helpCheck').removeAttribute('aria-busy');}
  };
  async function summary(){get('helpCopy').disabled=true;get('helpCopyStatus').textContent='';try{const r=await api.diagnosticSummary();if(!r?.ok||typeof r.text!=='string')throw Error();get('helpDiagnosticText').value=r.text;get('helpCopy').disabled=false;}catch{get('helpDiagnosticText').value='摘要暂时无法读取，请重试。';}}
  get('helpDiagnosticDetails').addEventListener('toggle',()=>{if(get('helpDiagnosticDetails').open)void summary();});
  get('helpCopy').onclick=async()=>{get('helpCopy').disabled=true;try{const r=await api.copyDiagnostic();get('helpCopyStatus').textContent=r?.ok?'已复制，可粘贴到反馈中。':'复制失败，可手动选取上方摘要。';}catch{get('helpCopyStatus').textContent='复制失败，可手动选取上方摘要。';}finally{get('helpCopy').disabled=false;}};
  document.querySelectorAll('[data-help-link]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const r=await api.openHelp(button.dataset.helpLink);if(!r?.ok)throw Error();}catch{get('helpUpdateStatus').textContent='链接暂时无法打开，请稍后重试。';}finally{button.disabled=false;}});
})();
