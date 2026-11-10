'use strict';
const assert=require('node:assert/strict'),{parseBili}=require('../bili-source.cjs');
const bvid='BV1B7411m7LV';
assert.equal(parseBili(bvid).web,parseBili(`https://www.bilibili.com/video/${bvid}/?spm_id_from=private#tracking`).web);
assert.equal(parseBili(`https://m.bilibili.com/video/${bvid}?p=2`).web,`https://www.bilibili.com/video/${bvid}/?p=2`);
assert(parseBili('https://www.bilibili.com/video/av123?p=2').embed.includes('aid=123'));
assert.equal(parseBili(`https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=1&muted=1`).embed,parseBili(bvid).embed);
for(const input of [null,'','BVbad','file:///C:/private','javascript:alert(1)','http://www.bilibili.com/video/'+bvid,'https://127.0.0.1/','https://www.bilibili.com.evil.test/video/'+bvid,'https://u:p@www.bilibili.com/video/'+bvid,'https://www.bilibili.com:999/video/'+bvid,'https://www.bilibili.com/','https://b23.tv/abc','https://www.bilibili.com/video/'+bvid+'?p=-1','https://www.bilibili.com/video/'+bvid+'?p=1.2'])assert.throws(()=>parseBili(input));
console.log('PASS 18 Bili source parsing cases; arbitrary URLs, private endpoints, credentials and short links rejected.');
