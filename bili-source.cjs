'use strict';
function parseBili(value){
  if(typeof value!=='string'||value.length>2000)throw Error('请粘贴 B 站完整视频链接或 BV 号。');
  const input=value.trim();let bvid='',aid='',page=1;
  if(/^BV[A-Za-z0-9]{10}$/.test(input))bvid=input;
  else{
    let url;try{url=new URL(input);}catch{throw Error('请粘贴 B 站完整视频链接或 BV 号。');}
    if(url.protocol!=='https:'||url.port||url.username||url.password)throw Error('请使用 https 的 B 站视频链接。');
    if(['www.bilibili.com','m.bilibili.com','bilibili.com'].includes(url.hostname)){
      const id=url.pathname.match(/^\/video\/(BV[A-Za-z0-9]{10}|av[1-9]\d{0,15})\/?$/)?.[1];
      if(!id)throw Error('请选择普通视频页面的完整链接。');
      if(id.startsWith('BV'))bvid=id;else aid=id.slice(2);
    }else if(url.hostname==='player.bilibili.com'&&url.pathname==='/player.html'){
      bvid=url.searchParams.get('bvid')||'';aid=bvid?'':url.searchParams.get('aid')||'';
    }else throw Error('仅支持 B 站完整视频链接；短链接请先在浏览器打开后复制完整地址。');
    const p=url.searchParams.get('p');if(p!==null){if(!/^[1-9]\d{0,2}$/.test(p))throw Error('视频分集编号无效。');page=Number(p);}
  }
  if(!(bvid&&/^BV[A-Za-z0-9]{10}$/.test(bvid))&&!(aid&&/^[1-9]\d{0,15}$/.test(aid)))throw Error('视频编号无效。');
  const embed=new URL('https://player.bilibili.com/player.html');embed.searchParams.set(bvid?'bvid':'aid',bvid||aid);embed.searchParams.set('p',String(page));embed.searchParams.set('autoplay','0');embed.searchParams.set('muted','0');embed.searchParams.set('danmaku','0');
  return {embed:embed.href,web:`https://www.bilibili.com/video/${bvid||'av'+aid}/?p=${page}`};
}
module.exports={parseBili};
