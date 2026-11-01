/* Per-scene density overlays; existing editing owns preview, save and rollback. */
(()=>{
  const bar=$('#layoutPresetBar'),workspace=$('#workspace');
  const preset=()=>['relaxed','compact'].includes(current().layout.viewportPreset)?current().layout.viewportPreset:'custom';
  const previewing=()=>editing&&preset()!=='custom';
  function sync(){
    const selected=preset(),density=selected==='custom'?'custom':selected==='compact'||innerWidth<1450||innerHeight<850?'compact':'relaxed';
    workspace.dataset.density=density;bar.hidden=!editing;
    document.body.classList.toggle('layout-preset-preview',previewing());
    for(const button of bar.querySelectorAll('[data-viewport-preset]')){button.setAttribute('aria-pressed',String(button.dataset.viewportPreset===selected));button.disabled=layoutSaveInFlight;}
    $('#layoutPresetHint').textContent=selected==='custom'?'自定义：沿用你设置的高度与间距。':`${state.scene} · ${selected==='relaxed'?'舒展':'紧凑'}预览${selected==='relaxed'&&density==='compact'?' · 当前窗口较小，自动收紧留白':''}。仅保存当前场景的预设；内容多时卡片内可滚动。`;
  }
  const previous=renderLayout;
  renderLayout=function(){sync();previous();};
  bar.addEventListener('click',event=>{
    const button=event.target.closest('[data-viewport-preset]');if(!button||!editing||layoutSaveInFlight)return;
    current().layout.viewportPreset=button.dataset.viewportPreset;renderLayout();
  });
  window.layoutPresets={previewing};
  let frame=0;const resize=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;sync();window.taskAssistant?.renderLayout();});};
  window.addEventListener('resize',resize);window.addEventListener('pagehide',()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',resize);},{once:true});
  sync();
})();
