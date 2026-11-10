(()=>{
  const $=id=>document.getElementById(id),api=window.ambientApi,engine=window.AmbientSound.createEngine(),video=$('video'),audio=$('localAudio'),frame=$('biliPlayer');
  const icons={
    play:'<path d="m9 5 11 7-11 7Z"/>',pause:'<path d="M9 5v14M15 5v14"/>',
    sound:'<path d="m11 5-6 5H2v4h3l6 5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    mute:'<path d="m11 5-6 5H2v4h3l6 5Z"/><path d="m16 9 6 6m0-6-6 6"/>',
    favorite:'<path d="M6 3h12v18l-6-4-6 4Z"/>',expand:'<path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5"/>',
    pin:'<path d="m8 3 8 0-1 6 4 4H5l4-4Zm4 10v8"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>'
  };
  function iconButton(id,icon,label){
    const button=$(id);
    if(button.dataset.icon===icon&&button.getAttribute('aria-label')===label)return;
    button.dataset.icon=icon;button.classList.add('icon-button');
    button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[icon]+'</svg>';
    const text=document.createElement('span');text.className='control-label';text.textContent=label;button.append(text);
    button.setAttribute('aria-label',label);button.title=label;
  }
  iconButton('quickFavorites','favorite','切换收藏');iconButton('expandPanel','expand','展开声音设置 · Esc');
  iconButton('top','pin','窗口置顶');iconButton('hide','close','收起小窗，声音继续');
  let playing=false,busy=false,visible=true,disposed=false,generation=0,mode='local',file=null,biliLoaded=false,autoCompact=false,viewBusy=false;
  let playbackError=false,focusChanged=false;
  let loadedBiliUrl=null,muted=false,biliLoading=false,muteBusy=false,volumeChanged=false;
  function applyView(value){
    const compact=value?.compact===true;
    document.body.classList.toggle('video-only',compact);
    $('expandPanel').hidden=$('quickControls').hidden=!compact;
    if(!compact)$('quickList').hidePopover();
  }
  async function view(compact){if(viewBusy)return;viewBusy=true;try{const result=await api.action(compact?'video-only':'panel');if(result?.ok)applyView(result);else $('status').textContent=result?.message||'窗口切换未成功，请重试。';}catch{$('status').textContent='窗口切换未成功，请重试。';}finally{viewBusy=false;}}
  function maybeCompact(){if(playing&&mode==='bili'&&biliLoaded&&autoCompact&&!document.querySelector('dialog[open]')){autoCompact=false;void view(true);}}
  $('videoOnly').onclick=()=>{autoCompact=false;void view(true);};$('expandPanel').onclick=()=>{autoCompact=false;void view(false);};
  const offEscape=api.onEscape(()=>{
    if($('quickList').matches(':popover-open'))$('quickList').hidePopover();
    else {autoCompact=false;void view(false);}
  });
  const offView=api.onView(applyView);
  const volume=()=>Number($('volume').value);
  function render(){
    $('videoOnly').disabled=!biliLoaded;
    iconButton('quickPlay',playing?'pause':'play',playing?'暂停':'播放');
    $('quickPlay').disabled=busy||biliLoading;
    iconButton('quickMute',muted?'mute':'sound',muted?'取消静音':'静音');
    $('quickMute').setAttribute('aria-pressed',String(muted));
    $('quickMute').disabled=muteBusy||biliLoading;
    $('quickFavorites').disabled=favoriteBusy||biliLoading||busy||!favorites.length;
    $('sourceMode').disabled=biliLoading;
    $('biliLoad').disabled=biliLoading||busy;
    $('play').textContent=playing?'暂停声音':'开始聆听';$('play').setAttribute('aria-pressed',String(playing));$('play').disabled=busy||biliLoading;
    $('badge').textContent=playing?'正在陪伴':'未播放';document.body.classList.toggle('playing',playing&&visible);document.body.dataset.source=mode;
    $('synthSounds').hidden=mode!=='synth';$('biliControls').hidden=mode!=='bili';
    $('choose').textContent=mode==='local'?'＋ 选择音频 / 视频':'＋ 本地视频画面';$('sourceHint').textContent=mode==='local'?'播放原声':'视频原声静音';
    frame.hidden=mode!=='bili';video.hidden=mode==='bili'||file?.kind!=='video';$('landscape').hidden=mode==='bili'||!video.hidden;
    $('clear').hidden=!file;$('clear').textContent=mode==='local'?'移除素材':'移除画面';$('scene').classList.toggle('has-video',mode==='bili'||!video.hidden);
  }
  async function syncVideo(){
    if(mode==='synth'){video.muted=true;if(playing&&visible&&!video.hidden){try{await video.play();}catch{$('status').textContent='视频暂时无法播放，可以换一个；合成声仍可使用。';}}else video.pause();}
    // Original local media stays playing while hidden so its audio continues.
  }
  async function stopLocal(){video.pause();audio.pause();try{await engine.pause();}catch{}}
  async function pause(){generation++;playing=false;render();await stopLocal();if(mode==='bili')await api.bili({action:'pause'}).catch(()=>{});render();}
  async function togglePlayback(){
    if(busy)return;if(playing){await pause();return;}busy=true;const attempt=++generation;render();
    try{
      if(mode==='local'){
        if(!file)throw Error('先选择一段喜欢的本地音频或视频吧。');
        const media=file.kind==='video'?video:audio;media.muted=false;media.volume=volume();await media.play();
      }else if(mode==='synth')await engine.play();
      else{if(!biliLoaded)throw Error('先粘贴 B 站视频链接，再点击载入。');await api.bili({action:'volume',volume:volume()});const result=await api.bili({action:'play'});if(!result?.ok||!result.playing)throw Error(result?.message||'请点击播放器内的播放按钮。');muted=result.muted===true;}
      if(disposed||attempt!==generation){await stopLocal();return;}
      const result=await api.action('playing');if(!result?.ok)throw Error('暂时无法开始，请重试。');
      if(disposed||attempt!==generation){await stopLocal();return;}playing=true;$('status').textContent=mode==='bili'?'正在使用 B 站官方播放器，画面内也可以调节音量。':'收起小窗，声音继续。想停下来时点击暂停。';await syncVideo();showQuickStatus('');
      if(mode==='bili')rememberCurrent();
      maybeCompact();
    }catch(error){
      await pause();$('status').textContent=error.message||'声音暂时无法播放，请重试。';
      if(mode==='bili')failure($('status').textContent);
    }finally{busy=false;render();}
  }
  $('play').onclick=$('quickPlay').onclick=()=>togglePlayback();
  function showQuickStatus(message){$('quickStatus').textContent=message;$('quickStatus').hidden=!message;}
  async function updateMute(action){
    const source=loadedBiliUrl;
    if(!source||biliLoading||muteBusy)return;
    if(action==='mute'){muteBusy=true;render();}
    try{
      const result=await api.bili({action});
      if(source!==loadedBiliUrl||biliLoading||(action==='state'&&muteBusy))return;
      if(result?.ok){muted=result.muted===true;if(action==='mute')showQuickStatus('');}
      else if(action==='mute')showQuickStatus('播放器尚未就绪，请稍后再试。');
    }catch{if(action==='mute')showQuickStatus('静音切换未成功，请重试。');}
    finally{if(action==='mute')muteBusy=false;render();}
  }
  $('quickMute').onclick=()=>updateMute('mute');
  document.querySelector('header').addEventListener('pointerenter',()=>{
    if(document.body.classList.contains('video-only'))void updateMute('state');
  });
  document.querySelectorAll('[data-sound]').forEach(button=>button.onclick=()=>{engine.setMode(button.dataset.sound);document.querySelectorAll('[data-sound]').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));});
  function applyVolume(value){
    engine.setVolume(value);video.volume=audio.volume=value;
    $('level').textContent=Math.round(value*100)+'%';
  }
  $('volume').oninput=()=>{
    volumeChanged=true;const value=volume();applyVolume(value);
    if(mode==='bili'&&biliLoaded)void api.bili({action:'volume',volume:value}).catch(()=>{});
  };
  $('volume').onchange=()=>{
    volumeChanged=true;
    void api.favorites({action:'remember',volume:volume()}).then(result=>{
      if(!result?.ok)$('status').textContent='音量已调整，未能保存到下次启动。';
    }).catch(()=>{$('status').textContent='音量已调整，未能保存到下次启动。';});
  };
  $('top').onclick=async()=>{try{const result=await api.action('top');if(result?.ok){$('top').setAttribute('aria-pressed',String(result.top));iconButton('top','pin',result.top?'取消置顶':'窗口置顶');}}catch{$('status').textContent='置顶设置未成功，请重试。';}};
  $('hide').onclick=()=>api.action('hide').catch(()=>{});
  function clearMedia(){video.pause();audio.pause();for(const media of [video,audio]){media.removeAttribute('src');media.load();}file=null;}
  $('sourceMode').onchange=async()=>{
    const next=$('sourceMode').value;loadId++;await pause();if(mode==='bili'){frame.removeAttribute('src');biliLoaded=false;loadedBiliUrl=null;await api.bili({action:'clear'}).catch(()=>{});}
    clearMedia();await api.action('clear').catch(()=>{});mode=next;render();$('status').textContent=mode==='bili'?'粘贴 B 站完整视频链接或 BV 号，载入后由你开始播放。':mode==='local'?'播放你选择的音频或视频原声。':'内置为合成环境声，也可选择静音视频作画面。';
  };
  $('choose').onclick=async()=>{
    $('choose').disabled=true;const chosenMode=mode;
    try{const result=await (mode==='local'?api.chooseMedia():api.chooseVideo());if(!result?.ok){if(!result?.canceled)$('status').textContent=result?.message||'未能选择素材，请重试。';return;}
      if(mode!==chosenMode)return;await pause();if(mode!==chosenMode)return;clearMedia();file={kind:result.kind||'video'};const media=file.kind==='video'?video:audio;media.src=result.url;media.muted=mode==='synth';media.volume=volume();media.load();render();$('status').textContent=mode==='local'?'素材已就绪，点击开始聆听原声。':'视频仅作画面，原声静音；点击开始聆听合成声。';
    }catch{$('status').textContent='素材选择失败，请重试。';}finally{$('choose').disabled=false;}
  };
  $('clear').onclick=async()=>{try{await pause();const result=await api.action('clear');if(!result?.ok)return;clearMedia();render();$('status').textContent='已移除本地素材。';}catch{$('status').textContent='移除失败，请重试。';}};
  let loadId=0;
  function failure(message){
    playbackError=true;$('recovery').hidden=false;
    $('status').textContent=message;showQuickStatus(message);
  }
  $('retry').onclick=()=>{if(!biliLoading&&!busy)void loadBili(true);};
  $('retryExternal').onclick=()=>$('biliExternal').click();
  async function loadBili(autoPlay=false){
    if(biliLoading||busy)return;
    const attempt=++loadId,token=++generation;
    biliLoading=true;playbackError=false;$('recovery').hidden=true;render();showQuickStatus('正在载入视频…');
    try{
      const result=await api.bili({action:'load',url:$('biliLink').value,muted});
      if(!result?.ok){failure(result?.message||'链接无效，请检查后重试。');return;}
      if(disposed||mode!=='bili'||attempt!==loadId)return;
      await stopLocal();
      if(disposed||mode!=='bili'||attempt!==loadId)return;
      playing=false;biliLoaded=true;loadedBiliUrl=result.web;
      autoCompact=!document.body.classList.contains('video-only');
      frame.src=result.url;render();
      $('status').textContent='正在载入官方播放器；就绪后点击开始，或点击画面内播放。';

      const start=Date.now();
      while(!disposed&&mode==='bili'&&loadId===attempt&&generation===token&&Date.now()-start<15000){
        const state=await api.bili({action:'state'});
        if(disposed||loadId!==attempt||generation!==token)return;
        if(state?.ok&&state.ready>=2){
          if(autoPlay&&!playing)await togglePlayback();
          return;
        }
        await new Promise(resolve=>setTimeout(resolve,150));
      }
      if(loadId===attempt&&generation===token)failure('加载超时，请重试当前视频，或在浏览器打开。');
    }catch{failure('播放器未能载入，请检查网络后重试，或在浏览器打开。');}
    finally{biliLoading=false;showQuickStatus(playing?'':$('status').textContent);render();}
  }
  $('biliLoad').onclick=()=>loadBili(false);
  let favorites=[],favoriteBusy=false,userInteracted=false;
  function rememberCurrent(){
    if(!loadedBiliUrl||!favorites.some(item=>item.url===loadedBiliUrl))return;
    void api.favorites({action:'remember',url:loadedBiliUrl}).catch(()=>{});
  }
  const quickList=$('quickList');
  quickList.addEventListener('beforetoggle',event=>{
    if(event.newState!=='open')return;
    quickList.replaceChildren();
    for(const item of favorites){
      const button=document.createElement('button');
      button.type='button';button.textContent=item.name;button.title=item.name;
      if(item.url===loadedBiliUrl)button.setAttribute('aria-current','true');
      button.onclick=()=>{quickList.hidePopover();void playFavorite(item);};
      quickList.append(button);
    }
  });
  quickList.addEventListener('toggle',()=>$('quickFavorites').setAttribute('aria-expanded',String(quickList.matches(':popover-open'))));
  for(const type of ['pointerdown','keydown'])document.addEventListener(type,()=>{userInteracted=true;},{once:true,capture:true});
  function renderFavorites(selected=$('favoriteSelect').value){
    const host=$('favoriteSelect');host.replaceChildren();
    if(!favorites.length){const option=document.createElement('option');option.value='';option.textContent='暂无收藏';host.append(option);}
    for(const item of favorites){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;host.append(option);}
    if(favorites.some(item=>item.id===selected))host.value=selected;
    $('favoritePlay').disabled=favoriteBusy||!favorites.length;$('favoriteRemove').disabled=favoriteBusy||!favorites.length;$('favoriteAdd').disabled=favoriteBusy;
    render();
  }
  $('favoriteAdd').onclick=()=>{const item=favorites.find(item=>item.id===$('favoriteSelect').value);$('favoriteName').value=item&&item.url===$('biliLink').value?item.name:'';$('favoriteStatus').textContent='';$('favoriteDialog').showModal();$('favoriteName').focus();};
  $('favoriteCancel').onclick=()=>{if(!favoriteBusy)$('favoriteDialog').close();};
  $('favoriteDialog').addEventListener('close',maybeCompact);
  $('favoriteDialog').addEventListener('cancel',e=>{if(favoriteBusy)e.preventDefault();});
  $('favoriteForm').onsubmit=async e=>{
    e.preventDefault();if(favoriteBusy)return;favoriteBusy=true;renderFavorites();$('favoriteSave').disabled=$('favoriteCancel').disabled=true;
    try{const result=await api.favorites({action:'add',url:$('biliLink').value,name:$('favoriteName').value});if(!result?.ok){$('favoriteStatus').textContent=result?.message||'收藏未保存，请重试。';return;}favorites=result.items;renderFavorites(result.id);if(playing)rememberCurrent();$('favoriteDialog').close();$('status').textContent=result.duplicate?'收藏已更新，没有重复添加。':'已收藏，下次打开可以直接选来播放。';}
    catch{$('favoriteStatus').textContent='收藏未保存，请重试。';}finally{favoriteBusy=false;renderFavorites();$('favoriteSave').disabled=$('favoriteCancel').disabled=false;}
  };
  $('favoriteRemove').onclick=async()=>{
    if(favoriteBusy)return;favoriteBusy=true;const id=$('favoriteSelect').value;renderFavorites();try{const result=await api.favorites({action:'remove',id});if(!result?.ok){$('status').textContent=result?.message||'移除失败，请重试。';return;}favorites=result.items;renderFavorites();$('status').textContent='已移除所选收藏。';}catch{$('status').textContent='移除失败，请重试。';}finally{favoriteBusy=false;renderFavorites();}
  };
  async function playFavorite(item){
    if(!item||favoriteBusy||biliLoading||busy)return;
    favoriteBusy=true;renderFavorites(item.id);
    try{
      $('biliLink').value=item.url;
      if(item.url===loadedBiliUrl){if(!playing)await togglePlayback();}
      else await loadBili(true);
    }finally{favoriteBusy=false;renderFavorites();}
  }
  $('favoritePlay').onclick=()=>playFavorite(favorites.find(item=>item.id===$('favoriteSelect').value));
  api.favorites({action:'list'}).then(result=>{
    if(disposed)return;
    if(!result?.ok){$('status').textContent=result?.message||'收藏暂时无法读取。';return;}
    favorites=result.items;
    if(!focusChanged)for(const key of ['focusStart','focusEnd'])$(key).checked=result.playback?.[key]===true;
    if(!volumeChanged&&Number.isFinite(result.playback?.volume)){
      $('volume').value=result.playback.volume;applyVolume(volume());
    }
    const last=favorites.find(item=>item.id===result.playback?.lastId)??favorites[0];
    renderFavorites(last?.id);
    if(last&&!userInteracted){
      mode='bili';$('sourceMode').value=mode;$('biliLink').value=last.url;render();
      $('status').textContent='收藏已保留，选一项后点击播放。';
    }
  }).catch(()=>{$('status').textContent='收藏暂时无法读取，请重新打开小窗。';});
  for(const key of ['focusStart','focusEnd'])$(key).onchange=async()=>{
    focusChanged=true;const checked=$(key).checked;
    const result=await api.favorites({action:'remember',[key]:checked}).catch(()=>null);
    if(!result?.ok){$(key).checked=!checked;$('status').textContent='联动设置未能保存，请重试。';}
  };
  const offTop=api.onTop(value=>{$('top').setAttribute('aria-pressed',String(value));iconButton('top','pin',value?'取消置顶':'窗口置顶');});
  const offFocus=api.onFocusPlay(async item=>{
    if(biliLoading||busy||playing)return;
    userInteracted=true;
    if(mode!=='bili'){
      await pause();clearMedia();mode='bili';$('sourceMode').value=mode;
    }
    await playFavorite(item);
  });
  $('biliLink').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();$('biliLoad').click();}});
  $('biliExternal').onclick=async()=>{try{const r=await api.bili({action:'external'});if(!r?.ok)$('status').textContent='请先载入一个有效视频链接。';}catch{$('status').textContent='浏览器未能打开，请重试。';}};
  frame.addEventListener('load',()=>{if(biliLoaded&&mode==='bili'&&!playbackError){void api.bili({action:'volume',volume:volume()}).catch(()=>{});$('status').textContent='播放器页面已载入；若视频无法播放，可在浏览器打开。';}});
  for(const media of [video,audio]){
    media.addEventListener('error',()=>{if(media.getAttribute('src')){playing=false;render();$('status').textContent='这个素材无法解码，请更换音频或视频文件。';}});
    media.addEventListener('pause',()=>{if(mode==='local'&&playing&&media.getAttribute('src')){playing=false;render();}});
  }
  video.addEventListener('canplay',()=>{if(playing)void syncVideo();});
  const offPause=api.onPause(pause),offRemote=api.onRemotePlaying?.(async value=>{
    if(mode!=='bili'||value?.url!==loadedBiliUrl)return;
    await stopLocal();
    if(mode!=='bili'||value.url!==loadedBiliUrl)return;
    playing=value.playing===true;muted=value.muted===true;
    if(playing){playbackError=false;$('recovery').hidden=true;showQuickStatus('');rememberCurrent();}
    render();maybeCompact();
    void api.bili({action:'volume',volume:volume()}).catch(()=>{});
  }),offVisible=api.onVisible(next=>{visible=next;render();void syncVideo();});
  window.addEventListener('pagehide',()=>{disposed=true;generation++;loadId++;offTop?.();offFocus?.();offEscape?.();offView?.();offPause?.();offRemote?.();offVisible?.();clearMedia();frame.removeAttribute('src');void engine.dispose();},{once:true});render();
})();
