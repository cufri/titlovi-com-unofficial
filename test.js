'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {MANIFEST,checkManifestUrl,encodeConfig,decodeConfig,configKey,parseRoute,sourceUrl,filterSubs,makeServer}=require('./server');
const key=configKey('a'.repeat(40));const url='https://stremio.titlovi.com/private-example/manifest.json';
test('configurable manifest',()=>{assert.equal(MANIFEST.name,'Titlovi.com unofficial');assert.equal(MANIFEST.behaviorHints.configurationRequired,true);});
test('validates upstream and excludes SSRF endpoints',()=>{assert.equal(checkManifestUrl(url),url);for(const bad of ['http://stremio.titlovi.com/x/manifest.json','https://evil.example/x/manifest.json','https://stremio.titlovi.com.evil.test/x/manifest.json','https://stremio.titlovi.com/x/manifest.json?token=1'])assert.throws(()=>checkManifestUrl(bad));});
test('encrypted config roundtrip and rejects tampering',()=>{const t=encodeConfig({url,langs:['eng','mkd']},key),o=decodeConfig(t,key);assert.deepEqual(o,{url,langs:['eng','mkd']});assert.ok(!t.includes('private-example'));assert.throws(()=>decodeConfig(t.slice(0,-3)+'AAA',key));});
test('episode ids accept URL encoded colons and correct videoID',()=>{const route=parseRoute('/c/abc/subtitles/series/tt0903747%3A1%3A1.json');assert.equal(route.id,'tt0903747:1:1');assert.match(sourceUrl('https://stremio.titlovi.com/demo','series',route.id),/videoID=tt0903747%3A1%3A1/);});
test('keeps original five language codes and labels',()=>{const subs=filterSubs([{id:'s',lang:'hrv',label:'1080p BluRay',url:'https://example.com/s.srt'},{id:'x',lang:'mac',label:'MK label',url:'https://example.com/m.srt'},{id:'z',lang:'fr',url:'https://example.com/f.srt'}],['hrv','mkd']);assert.deepEqual(subs.map(s=>s.lang),['hrv','mac']);assert.equal(subs[0].label,'1080p BluRay');});
test('HTTP end-to-end configuration and subtitle response',async()=>{const fakeFetch=async()=>({ok:true,json:async()=>({subtitles:[{id:'1',lang:'eng',url:'https://example.com/1.srt',label:'WEB-DL'},{id:'2',lang:'bos',url:'https://example.com/2.srt'}]})});const srv=makeServer({secret:'b'.repeat(42),fetcher:fakeFetch});await new Promise(r=>srv.listen(0,'127.0.0.1',r));try{const base=`http://127.0.0.1:${srv.address().port}`;const manifest=await (await fetch(base+'/manifest.json')).json();assert.equal(manifest.behaviorHints.configurable,true);const confResp=await fetch(base+'/api/configure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,langs:['eng','bos']})});assert.equal(confResp.status,200);const conf=await confResp.json();const p=new URL(conf.manifest).pathname.replace('/manifest.json','/subtitles/series/tt0903747%3A1%3A1.json');const subResp=await fetch(base+p);assert.equal(subResp.status,200);const subs=await subResp.json();assert.equal(subs.subtitles.length,2);assert.equal(subs.subtitles[0].label,'WEB-DL');}finally{await new Promise(r=>srv.close(r));}});

test('Android TV shows release name in id and keeps Serbian script markers',()=>{
  const subs=filterSubs([
    {id:'one',lang:'srp',label:'Episode.1080p.WEB-DL.cyr',url:'https://example.com/one.srt'},
    {id:'two',lang:'srp',label:'Episode.1080p.WEB-DL.lat',url:'https://example.com/two.srt'},
    {id:'three',lang:'srp',label:'Episode.1080p.WEB-DL.lat',url:'https://example.com/three.srt'}
  ],['srp']);
  assert.equal(subs.length,3);
  assert.match(subs[0].id,/Episode\.1080p\.WEB-DL\.cyr/);
  assert.match(subs[1].id,/Episode\.1080p\.WEB-DL\.lat/);
  assert.equal(subs[0].lang,'srp');
  assert.equal(subs[1].lang,'srp');
  assert.equal(subs[1].label,'Episode.1080p.WEB-DL.lat');
  assert.equal(new Set(subs.map(s=>s.id)).size,3);
});
