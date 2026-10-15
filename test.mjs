import assert from 'node:assert/strict';
import addon,{detectSerbianScript} from './src.js';
// Tests run entirely offline: mock the upstream API rather than contacting Titlovi.com.
const originalFetch=globalThis.fetch;
globalThis.fetch=async (url)=>{
 if(String(url).startsWith('https://stremio.titlovi.com/'))return new Response(JSON.stringify({subtitles:[]}),{headers:{'content-type':'application/json'}});
 throw Error('Unexpected external request');
};
const env={CONFIG_SECRET:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'};
let r=await addon.fetch(new Request('https://test.workers.dev/health'),env,{});
assert.equal(r.status,200);
r=await addon.fetch(new Request('https://test.workers.dev/api/configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://stremio.titlovi.com/private/manifest.json',langs:['eng','srp','hrv','bos','mkd']})}),env,{});
const result=await r.json();assert.ok(result.manifest.includes('/c/'),JSON.stringify(result));
r=await addon.fetch(new Request(result.manifest),env,{});assert.equal(r.status,200);
const token=result.manifest.match(/\/c\/([^/]+)\/manifest/)[1];
r=await addon.fetch(new Request(`https://test.workers.dev/c/${token}/subtitles/series/tt3581920%3A2%3A3.json`),env,{waitUntil(){}});assert.equal(r.status,200);assert.deepEqual(await r.json(),{subtitles:[]});
console.log('PASS: health, configure, encrypted manifest, episode route');

assert.equal(detectSerbianScript('00:00:01,000 --> 00:00:03,000\nОво је пример српског текста написаног ћирилицом. Потребно је проверити препознавање писма.'),'CYR');
assert.equal(detectSerbianScript('00:00:01,000 --> 00:00:03,000\nOvo je primer srpskog teksta napisanog latinicom. Potrebno je proveriti prepoznavanje pisma.'),'LAT');
assert.equal(detectSerbianScript('hi'),null);
const makeSrt=(text)=>Array.from({length:8},(_,i)=>`${i+1}\n00:00:${String(i+1).padStart(2,'0')},000 --> 00:00:${String(i+2).padStart(2,'0')},000\n${text}`).join('\n\n');
assert.equal(detectSerbianScript(makeSrt('Ово је пример нормалног српског титла написаног ћирилицом! <i>hello</i>')), 'CYR');
assert.equal(detectSerbianScript(makeSrt('Ovo je primer srpskog titla koji je napisan latinicom.')), 'LAT');
assert.equal(detectSerbianScript(makeSrt('Ово је српски титл ћирилицом.')+'\n\n'+makeSrt('Ovo je srpski titl latinicom.')), 'MIX');
assert.equal(detectSerbianScript('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<html>login</html>'),null);

// Regression: Latin-majority/Cyrillic-minority is LAT, not MIX.
const mixedMajority=(major,minor,majorCount,minorCount)=>{
 let cues=[],i=0;
 for(let k=0;k<majorCount;k++)cues.push(`${++i}\n00:00:01,000 --> 00:00:02,000\n${major}`);
 for(let k=0;k<minorCount;k++)cues.push(`${++i}\n00:00:01,000 --> 00:00:02,000\n${minor}`);
 return cues.join('\n\n');
};
const latin='Ovo je duzi razgovor na srpskom jeziku i pisan je latinicom.';
const cyrillic='Ово је дужи разговор на српском језику и писан је ћирилицом.';
assert.equal(detectSerbianScript(mixedMajority(latin,cyrillic,7,3)),'LAT');
assert.equal(detectSerbianScript(mixedMajority(cyrillic,latin,7,3)),'CYR');
assert.equal(detectSerbianScript(mixedMajority(latin,cyrillic,5,5)),'MIX');
assert.equal(detectSerbianScript(mixedMajority(latin,cyrillic,9,1)),'LAT');
console.log('PASS: majority script [LAT]/[CYR], genuine balanced [MIX]');


const configured=await addon.fetch(new Request('https://test.workers.dev/api/configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://stremio.titlovi.com/private/manifest.json',langs:['srp'],detectScript:true})}),env,{});
assert.equal(configured.status,200);
const cfgUrl=(await configured.json()).manifest;
assert.equal((await addon.fetch(new Request(cfgUrl),env,{})).status,200);
console.log('PASS: script detector and opt-in configuration');

globalThis.fetch=originalFetch;

// v2.3: real converted WebVTT and distinct original + Cyrillic subtitle entries.
import {transliterateText,transliterateSubtitle} from './src.js';
assert.equal(transliterateText('Šta radiš? Njegoš, LJUBAV, DŽEP, đak, čovjek.'),'Шта радиш? Његош, ЉУБАВ, ЏЕП, ђак, човјек.');
assert.equal(transliterateText('Ово је већ ћирилица.'),'Ово је већ ћирилица.');
const fixture='1\n00:00:01,000 --> 00:00:03,000\n<i>Šta radiš?</i> Nisam te očekivao.\n\n2\n00:00:04,000 --> 00:00:05,000\nDobro je!';
const vtt=transliterateSubtitle(fixture);
assert.ok(vtt.startsWith('WEBVTT\n\n'));
assert.ok(vtt.includes('00:00:01.000 --> 00:00:03.000'));
assert.ok(vtt.includes('<i>Шта радиш?</i> Нисам те очекивао.'));
assert.ok(vtt.includes('Добро је!'));
const mockOriginal=globalThis.fetch;
globalThis.fetch=async url=>{
 const u=String(url);
 if(u.includes('/subtitles/')) return new Response(JSON.stringify({subtitles:[
  {id:'sr-1',lang:'srp',url:'https://stremio.titlovi.com/files/sr.vtt',label:'Serbian release'},
  {id:'hr-1',lang:'hrv',url:'https://stremio.titlovi.com/files/hr.vtt',label:'Croatian release'},
  {id:'bs-1',lang:'bos',url:'https://stremio.titlovi.com/files/bs.vtt',label:'Bosnian release'},
  {id:'en-1',lang:'eng',url:'https://stremio.titlovi.com/files/en.vtt',label:'English release'}
 ]}),{headers:{'content-type':'application/json'}});
 if(u.includes('/files/'))return new Response(fixture,{headers:{'content-type':'text/plain'}});
 throw Error('Unexpected URL');
};
const configuredV23=await addon.fetch(new Request('https://test.workers.dev/api/configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://stremio.titlovi.com/private/manifest.json',langs:['srp','hrv','bos','eng'],transliteration:'both',translitLangs:['srp','hrv','bos']})}),env,{});
const v23manifest=(await configuredV23.json()).manifest;
const v23token=v23manifest.match(/\/c\/([^/]+)\/manifest/)[1];
const listing=await addon.fetch(new Request(`https://test.workers.dev/c/${v23token}/subtitles/series/tt3581920%3A2%3A3.json`),env,{waitUntil(){}});
assert.equal(listing.status,200);
const listed=(await listing.json()).subtitles;
assert.equal(listed.length,7);
assert.equal(listed.filter(s=>s.url.includes('/convert/')).length,3);
for(const lang of ['srp','hrv','bos'])assert.equal(listed.filter(s=>s.url.includes('/convert/')&&s.lang===lang).length,1);
const cyr=listed.find(s=>s.url.includes('/convert/')&&s.lang==='srp');
assert.ok(cyr.id.startsWith('[CYR]'));
const converted=await addon.fetch(new Request(cyr.url),env,{waitUntil(){}});
assert.equal(converted.status,200);
assert.equal(converted.headers.get('content-type'),'text/vtt; charset=utf-8');
assert.ok((await converted.text()).includes('Шта радиш?'));
assert.equal(listed.find(s=>s.id==='Serbian release').url,'https://stremio.titlovi.com/files/sr.vtt');
globalThis.fetch=mockOriginal;
console.log('PASS: original + Cyrillic for SRP/HRV/BOS, timings preserved, conversion endpoint');