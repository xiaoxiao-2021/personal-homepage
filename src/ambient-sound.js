/* Small local sound engine: no downloads, audio samples or per-frame JS work. */
(()=>{
  function createEngine({Context=window.AudioContext||window.webkitAudioContext,random=Math.random}={}){
    let context=null,source=null,filter=null,gain=null,volume=.25,mode='rain';
    const buffers=new Map();
    function bufferFor(kind){
      if(buffers.has(kind))return buffers.get(kind);
      const rate=context.sampleRate,length=rate*6,buffer=context.createBuffer(1,length,rate),data=buffer.getChannelData(0);
      let brown=0;
      for(let i=0;i<length;i++){
        const white=random()*2-1;
        brown=(brown+.02*white)/1.02;
        data[i]=kind==='white'?white*.45:kind==='wind'?brown*3.5:(white*.25+brown*2)*(0.8+0.2*Math.sin(i/rate*2*Math.PI/6));
      }
      // Smooth the loop join using equal end values, without silent gaps.
      const edge=Math.min(256,length/2),first=data[0],last=data[length-1];
      for(let i=0;i<edge;i++){const mix=i/edge;data[i]=first*mix+data[i]*(1-mix);data[length-1-i]=first*(1-mix)+data[length-1-i]*mix;}
      buffers.set(kind,buffer);return buffer;
    }
    function stopSource(){if(source){source.stop();source.disconnect();source=null;}if(filter){filter.disconnect();filter=null;}}
    function connect(){stopSource();source=context.createBufferSource();source.buffer=bufferFor(mode);source.loop=true;filter=context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=mode==='white'?9000:mode==='wind'?700:3000;source.connect(filter);filter.connect(gain);source.start();}
    async function play(){
      if(!Context)throw Error('当前设备无法开启环境声。');
      if(!context){context=new Context();gain=context.createGain();gain.gain.value=volume;gain.connect(context.destination);}
      if(!source)connect();await context.resume();
      if(context.state!=='running')throw Error('声音尚未开启，请再次点击。');
    }
    async function pause(){if(context&&context.state!=='closed')await context.suspend();}
    function setVolume(next){volume=Math.max(0,Math.min(1,Number(next)||0));if(context&&gain)gain.gain.setTargetAtTime(volume,context.currentTime,.04);}
    function setMode(next){if(!['rain','white','wind'].includes(next))return;mode=next;if(source)connect();}
    async function dispose(){stopSource();buffers.clear();if(context&&context.state!=='closed')await context.close();context=null;gain=null;}
    return {play,pause,setVolume,setMode,dispose,inspect:()=>({state:context?.state||'idle',mode,volume,buffers:buffers.size,sourceCount:source?1:0})};
  }
  window.AmbientSound={createEngine};
})();
