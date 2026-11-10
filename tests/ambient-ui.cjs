'use strict';
const {app,BrowserWindow,screen,ipcMain,protocol,net}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {validateEntry}=require('../local-entry.cjs');
const out=path.resolve(__dirname,'../test-results/ambient');app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();app.commandLine.appendSwitch('mute-audio');
protocol.registerSchemesAsPrivileged([{scheme:'home-ambient',privileges:{standard:true,secure:true,supportsFetchAPI:true,stream:true}}]);
app.on('window-all-closed',()=>{});
let controller,other,widget,selection=null,playCalls=0,requests=0;const checks=[],errors=[],validations=[];
const check=(v,label)=>{assert(v,label);checks.push(label);},wait=ms=>new Promise(r=>setTimeout(r,ms));
const run=s=>widget.webContents.executeJavaScript(s,true);
async function until(fn,label){for(let i=0;i<70;i++){if(await fn())return;await wait(70);}throw Error('Timeout '+label);}
async function click(id){const point=await run(`(()=>{const n=document.querySelector('${id}');n.scrollIntoView();const r=n.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);for(const type of ['mouseMove','mouseDown','mouseUp'])widget.webContents.sendInputEvent({type,...point,...(type==='mouseMove'?{}:{button:'left',clickCount:1})});await wait(120);}
const watch=setTimeout(()=>app.exit(1),90000);
(async()=>{
await app.whenReady();await fs.mkdir(out,{recursive:true});other=new BrowserWindow({width:500,height:400,show:true});await other.loadURL('data:text/html,<h1>Synthetic video generator</h1>');
const encoded=await other.webContents.executeJavaScript(`(async()=>{const c=document.createElement('canvas');c.width=320;c.height=180;const ctx=c.getContext('2d');let t=0;const paint=()=>{ctx.fillStyle=t++%2?'#88aa99':'#9cb8ae';ctx.fillRect(0,0,320,180);ctx.fillStyle='#e1d8aa';ctx.fillRect(t*15%280,35,40,40);};paint();const stream=c.captureStream(10),rec=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),parts=[];rec.ondataavailable=e=>parts.push(e.data);const done=new Promise(r=>rec.onstop=r);rec.start();const id=setInterval(paint,100);await new Promise(r=>setTimeout(r,1000));clearInterval(id);rec.stop();await done;stream.getTracks().forEach(t=>t.stop());const bytes=new Uint8Array(await new Blob(parts).arrayBuffer());return btoa(String.fromCharCode(...bytes));})()`);
const fixture=path.join(out,'合成画面.webm');await fs.writeFile(fixture,Buffer.from(encoded,'base64'));
controller=require('../ambient-window.cjs').createAmbientWindow({BrowserWindow,screen,ipcMain,protocol,net:{fetch:async(...args)=>{requests++;return net.fetch(...args);}},dialog:{showOpenDialog:async()=>selection?{canceled:false,filePaths:[selection]}:{canceled:true,filePaths:[]}},validateEntry:async entry=>{validations.push(entry.target);return validateEntry(entry);},onPlay:()=>playCalls++});
check((await controller.show()).ok,'actual ambient page loaded');widget=BrowserWindow.getAllWindows().find(w=>w!==other);widget.webContents.on('console-message',(_e,...args)=>{if(args[0]===3)errors.push(String(args[1]));});
check(widget.isAlwaysOnTop()&&widget.isVisible(),'native small window initially topmost');
check(await run(`typeof require==='undefined'&&typeof homeApi==='undefined'&&typeof ambientApi.chooseVideo==='function'`),'restricted isolated preload');
check(await run(`document.querySelector('#play').getAttribute('aria-pressed')==='false'&&document.querySelector('#video').muted`),'starts paused with video muted');
check(requests===0&&playCalls===0,'opening makes no media request and does not start playback');
await controller.show();check(BrowserWindow.getAllWindows().length===2,'one ambient window reused');other.focus();await wait(70);check(other.isFocused(),'reopening does not steal focus');
// Instrument standard Web Audio before first gesture, while muting only the output device.
await run(`(()=>{const Base=window.AudioContext;window.__contexts=[];window.AudioContext=class extends Base{constructor(...a){super(...a);__contexts.push(this);this.buffers=[];this.sources=[];const cb=this.createBuffer.bind(this),cs=this.createBufferSource.bind(this);this.createBuffer=(...x)=>{const b=cb(...x);this.buffers.push(b);return b;};this.createBufferSource=()=>{const s=cs();this.sources.push(s);return s;};}};return true;})()`);
// Engine class was selected on creation; test actual UI via button plus isolated engine signal.
await run(`document.querySelector('#sourceMode').value='synth';document.querySelector('#sourceMode').dispatchEvent(new Event('change'));true`);await wait(150);
widget.focus();await click('#play');await until(()=>run(`document.querySelector('#play').disabled===false`),'sound gesture completion');check(playCalls===1&&await run(`document.querySelector('#play').getAttribute('aria-pressed')==='true'`),'native gesture starts synthesized sound');
await run(`globalThis.__probe=AmbientSound.createEngine();__probe.setVolume(0);__probe.play()`);
check(await run(`__probe.inspect().state==='running'&&__probe.inspect().sourceCount===1&&__contexts[0].buffers[0].getChannelData(0).some(v=>Math.abs(v)>.001)`),'actual AudioContext runs and PCM contains nonzero samples');
for(const mode of ['white','wind','rain']){await click(`[data-sound=${mode}]`);await run(`__probe.setMode('${mode}')`);check(await run(`__probe.inspect().sourceCount===1&&__probe.inspect().mode==='${mode}'&&Array.from(__contexts[0].buffers.at(-1).getChannelData(0)).every(Number.isFinite)`),'mode switches without duplicate source: '+mode);}
await run(`for(let i=0;i<12;i++)__probe.setMode(['rain','white','wind'][i%3]);true`);check(await run(`__probe.inspect().buffers===3&&__probe.inspect().sourceCount===1`),'repeated switching bounds buffers and live sources');
await run(`document.querySelector('#volume').value='0.12';document.querySelector('#volume').dispatchEvent(new Event('input'));true`);check(await run(`document.querySelector('#level').textContent==='12%'`),'independent volume updates');
await click('#play');check(await run(`document.querySelector('#play').getAttribute('aria-pressed')==='false'`),'pause is explicit');
controller.pause();await run(`__probe.dispose()`);check(await run(`__probe.inspect().sourceCount===0&&__probe.inspect().buffers===0`),'dispose releases synthesized sources and buffers');
selection=fixture;await click('#choose');await until(()=>run(`document.querySelector('#video').readyState>=2`),'video decoded');
const token=await run(`document.querySelector('#video').src`);
check(token.startsWith('home-ambient://clip/')&&!token.includes('合成')&&!token.includes('C:'),'renderer receives opaque video handle without disk path');
check(await run(`document.querySelector('#video').videoWidth===320&&document.querySelector('#video').muted&&document.querySelector('#video').paused`),'real synthetic WebM decodes paused and muted');
await click('#play');await until(()=>run(`!document.querySelector('#video').paused&&document.querySelector('#video').currentTime>0`),'video advances');check(await run(`document.querySelector('#video').loop`),'video loops alongside environment sound');
await fs.writeFile(path.join(out,'video.png'),(await widget.webContents.capturePage()).toPNG());
await click('#hide');await wait(150);check(!widget.isVisible()&&await run(`document.querySelector('#video').paused&&document.querySelector('#play').getAttribute('aria-pressed')==='true'`),'hiding pauses video while sound remains running');await controller.show();await until(()=>run(`!document.querySelector('#video').paused`),'video resumes on reveal');
controller.pause();await until(()=>run(`document.querySelector('#play').getAttribute('aria-pressed')==='false'`),'music mutual exclusion');check(await run(`document.querySelector('#video').paused`),'external music pause request also pauses picture');
selection='D:\\K science\\R 软件资料\\not-accessed.webm';await click('#choose');check(await run(`document.querySelector('#video').src===${JSON.stringify(token)}`),'protected choice rejected and prior clip retained');
selection=null;await click('#choose');check(await run(`document.querySelector('#video').src===${JSON.stringify(token)}`),'cancel preserves current video');
await click('#clear');check(await run(`document.querySelector('#video').hidden&&!document.querySelector('#video').getAttribute('src')`),'remove returns to built-in scene');
const broken=path.join(out,'invalid.webm');await fs.writeFile(broken,'synthetic invalid video');selection=broken;await click('#choose');await until(()=>run(`document.querySelector('#status').textContent.includes('无法解码')`),'decode failure shown');check(await run(`document.querySelector('#play').getAttribute('aria-pressed')==='false'`),'invalid video never auto-starts audio');await click('#clear');
check((await net.fetch(token)).status===404,'removed video token revoked');check((await net.fetch('home-ambient://clip/not-a-token')).status===404,'unknown tokens cannot read files');
const handler=ipcMain._invokeHandlers.get('ambient:action');check(!(await handler({sender:other.webContents,senderFrame:other.webContents.mainFrame},'playing')).ok,'unrelated window cannot trigger audio action');
check(!(await run(`ambientApi.action('delete-task')`)).ok,'unknown actions rejected');
await click('#top');check(!widget.isAlwaysOnTop(),'topmost can be disabled');await click('#top');check(widget.isAlwaysOnTop(),'topmost can be restored');
widget.setPosition(-20000,-20000);screen.emit('display-metrics-changed');const b=widget.getBounds(),a=screen.getDisplayMatching(b).workArea;check(b.x>=a.x&&b.y>=a.y,'window clamped to work area');
await fs.writeFile(path.join(out,'ambient.png'),(await widget.webContents.capturePage()).toPNG());
check(await run(`document.body.scrollHeight<=innerHeight&&document.body.scrollWidth<=innerWidth`),'controls fit native window without overflow');
widget.close();await wait(80);await controller.show();widget=BrowserWindow.getAllWindows().find(w=>w!==other);check(await run(`document.querySelector('#play').getAttribute('aria-pressed')==='false'&&document.querySelector('#video').hidden`),'destroy/reopen starts paused and releases video selection');
controller.dispose();check(widget.isDestroyed()&&!ipcMain._invokeHandlers.has('ambient:choose'),'dispose closes window and unregisters controls');other.destroy();
await fs.writeFile(path.join(out,'report.json'),JSON.stringify({loaded:true,passed:checks.length,checks,errors,mediaRequests:requests,scope:'Real Electron native mouse input and AudioContext/PCM execution with OS output muted; real decode and advancing frames of generated WebM. File dialog substituted with project-local synthetic video. Protected path string rejected by production validator before file access. No production media/account data, audible listening, actual chooser, other codecs, real multi-monitor or desktop mounting.'},null,2));console.log('PASS '+checks.length+' ambient checks');clearTimeout(watch);app.exit(0);
})().catch(async error=>{console.error(error);if(widget&&!widget.isDestroyed()){console.log(await run(`JSON.stringify({status:document.querySelector('#status').textContent,source:document.querySelector('#sourceMode').value,pressed:document.querySelector('#play').getAttribute('aria-pressed'),disabled:document.querySelector('#play').disabled})`));await fs.writeFile(path.join(out,'failure.png'),(await widget.webContents.capturePage()).toPNG());}await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'report.json'),JSON.stringify({checks,errors,failure:error.stack},null,2));clearTimeout(watch);app.exit(1);});
