// Titlovi.com unofficial v2.2.2 — Cloudflare Workers port (no Render dependency).
// Uses each user's own private official stremio.titlovi.com addon.
const ID = 'community.titlovi.unofficial';
const manifest = {
  id: ID, name: 'Titlovi.com unofficial', version: '2.3.0',
  description: 'Unofficial Titlovi.com subtitle relay: English, Macedonian, Serbian, Croatian and Bosnian.',
  resources: ['subtitles'], types: ['movie','series'], idPrefixes: ['tt'], catalogs: [],
  behaviorHints: { configurable: true, configurationRequired: true }
};
const langMap = { en:'eng',eng:'eng',english:'eng',mk:'mkd',mkd:'mkd',mac:'mkd',mak:'mkd',sr:'srp',srp:'srp',serbian:'srp',hr:'hrv',hrv:'hrv',croatian:'hrv',bs:'bos',bos:'bos',bosnian:'bos' };
const normLang = (value) => langMap[String(value || '').trim().toLowerCase()] || null;
const cors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, HEAD, POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function fromBase64url(s) { const value=s.replace(/-/g,'+').replace(/_/g,'/'); return Uint8Array.from(atob(value+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0)); }
function json(obj,status=200,cache='no-store') { return new Response(JSON.stringify(obj),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':cache}}); }
function text(data,status=200,contentType='text/html; charset=utf-8') { return new Response(data,{status,headers:{...cors,'Content-Type':contentType,'Cache-Control':'no-store'}}); }
function validSource(value) {
  if(typeof value!=='string'||value.length>1500)throw Error('Invalid manifest URL');
  const u=new URL(value);
  if(u.protocol!=='https:'||u.hostname!=='stremio.titlovi.com'||u.port||u.username||u.password||u.search||u.hash||!/^\/(?:[^/]+\/)*manifest\.json$/.test(u.pathname))throw Error('Only private https://stremio.titlovi.com/.../manifest.json links are supported');
  return u.toString();
}
function validateSecret(env) { if(!env.CONFIG_SECRET || env.CONFIG_SECRET.length<32)throw Error('CONFIG_SECRET must contain at least 32 characters'); }
async function aesKey(secret){ const hash=await crypto.subtle.digest('SHA-256',encoder.encode(secret));return crypto.subtle.importKey('raw',hash,'AES-GCM',false,['encrypt','decrypt']); }
// Exactly compatible with v2.0 Node AES-256-GCM: IV (12) | auth tag (16) | ciphertext.
async function encodeConfig(data,secret) {
 const iv=crypto.getRandomValues(new Uint8Array(12)); const key=await aesKey(secret);
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,tagLength:128},key,encoder.encode(JSON.stringify(data))));
 const output=new Uint8Array(12+16+encrypted.length-16);output.set(iv,0);output.set(encrypted.slice(-16),12);output.set(encrypted.slice(0,-16),28);
 return base64url(output);
}
async function decodeConfig(token,secret) {
 if(!/^[a-zA-Z0-9_-]{35,3500}$/.test(token))throw Error('Bad token');
 const buf=fromBase64url(token); if(buf.length<30)throw Error('Bad token');
 const joined=new Uint8Array(buf.length-12);joined.set(buf.slice(28));joined.set(buf.slice(12,28),joined.length-16);
 const key=await aesKey(secret);
 const value=JSON.parse(decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:buf.slice(0,12),tagLength:128},key,joined)));
 const url=validSource(value.url);const langs=[...new Set((Array.isArray(value.langs)?value.langs:[]).map(normLang).filter(Boolean))];
 if(!langs.length)throw Error('No languages');return {url,langs,detectScript:value.detectScript===true,transliteration:value.transliteration==='both'?'both':'off',translitLangs:(Array.isArray(value.translitLangs)?value.translitLangs:[]).map(normLang).filter(x=>['srp','hrv','bos'].includes(x))};
}
async function decodeConversion(token,secret){
 if(!/^[a-zA-Z0-9_-]{35,3500}$/.test(token))throw Error('Invalid conversion token');
 const b=fromBase64url(token);if(b.length<30)throw Error('Invalid conversion token');
 const cipher=new Uint8Array(b.length-12);cipher.set(b.slice(28));cipher.set(b.slice(12,28),cipher.length-16);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:b.slice(0,12),tagLength:128},await aesKey(secret),cipher);
 const o=JSON.parse(decoder.decode(plain));
 if(!['srp','hrv','bos'].includes(o.l)||typeof o.u!=='string'||o.u.length>1800||!allowedForInspection(o.u))throw Error('Invalid conversion source');
 return o;
}
function mediaId(type,id){return type==='movie'?/^tt\d+$/.test(id):type==='series'&&/^tt\d+:\d+:\d+$/.test(id);}
function upstreamUrl(base,type,id,extra=''){
 const params=new URLSearchParams(extra);if(type==='series')params.set('videoID',id);
 const encoded=encodeURIComponent(id);return `${base}/subtitles/${type}/${encoded}${params.size?'/'+params.toString():''}.json`;
}
function safeSubtitle(url){try {const u=new URL(url);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password;}catch{return false;}}
function filterSubs(input,langs){
 const subs=[],seen=new Set(),names=new Set(),wanted=new Set(langs);
 for(const s of (Array.isArray(input)?input:[]).slice(0,300)){
  const lang=normLang(s?.lang);if(!s||!safeSubtitle(s.url)||!wanted.has(lang))continue;
  // Titlovi may return a login placeholder for expired or invalid private access.
  const subtitleUrl=new URL(s.url);
  if(subtitleUrl.hostname==='stremio.titlovi.com' && /\/files\/login\.vtt$/i.test(subtitleUrl.pathname))continue;
  const identifier=`${lang}\0${s.id||''}\0${s.url}`;if(seen.has(identifier))continue;seen.add(identifier);
  const label=typeof s.label==='string'?s.label.trim().slice(0,240):'';
  const originalId=typeof s.id==='string'?s.id.slice(0,180):'Titlovi subtitle';
  const base=label||originalId;let display=base;
  for(let i=2;names.has(display);i++)display=`${base} (${i})`;
  names.add(display);
  const result={id:display,lang:String(s.lang).trim(),url:s.url};if(label)result.label=label;
  subs.push(result);
 }return subs;
}
// Experimental opt-in: inspect *only* directly served UTF-8 SRT/VTT/plain text.
// Never guess when the upstream returns ZIP/RAR, redirects, or undecodable content.
// Classify cue text, not SRT/VTT headers, cue identifiers or formatting metadata.
// A Latin-heavy release title, URLs and markup should never imply MIX.
export function detectSerbianScript(content) {
 if(typeof content!=='string')return null;
 const normalized=content.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 // Reject accidental login pages / non-subtitle text.
 if(!/(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->|^WEBVTT/m.test(normalized))return null;
 const cues=normalized.split(/\n\s*\n/);
 let cyr=0,lat=0,cyrCues=0,latCues=0;
 for(const cue of cues){
  const lines=cue.split('\n').filter(line=>{
   const t=line.trim();
   return t && !/^WEBVTT(?:\s|$)/i.test(t) && !/^NOTE(?:\s|$)/i.test(t) &&
    !/^STYLE(?:\s|$)/i.test(t) && !/^REGION(?:\s|$)/i.test(t) &&
    !/^(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->/.test(t) &&
    !/^\d+$/.test(t) && !/^(?:X-TIMESTAMP-MAP|Kind:|Language:)/i.test(t) &&
    !/^(?:https?:\/\/|www\.)/i.test(t);
  });
  let dialog=lines.join(' ').replace(/<[^>]*>/g,' ').replace(/\{\\[^}]*\}/g,' ')
    .replace(/\[[^\]]{0,80}\]/g,' ').replace(/\([^)]{0,60}\)/g,' ')
    .replace(/https?:\/\/\S+/g,' ');
  // Serbian Cyrillic and Serbian Latin letter repertoires, including accented letters.
  const cc=(dialog.match(/[А-Ша-шЉљЊњЋћЂђЏџЈј]/g)||[]).length;
  const ll=(dialog.match(/[A-Za-zČĆĐŠŽčćđšž]/g)||[]).length;
  if(cc+ll<5)continue;
  cyr+=cc;lat+=ll;
  if(cc/(cc+ll)>=0.8)cyrCues++;
  if(ll/(cc+ll)>=0.8)latCues++;
 }
 const total=cyr+lat;
 if(total<35)return null;
 const cyrShare=cyr/total,latShare=lat/total;
 // Primary rule: classify by the script used in most actual dialogue.
 // Even 60/40 is LAT/CYR, not MIX. Small foreign-language fragments do not
 // change the script of the subtitle as a whole.
 if(cyrShare>=0.60)return 'CYR';
 if(latShare>=0.60)return 'LAT';
 // For near-even material, MIX requires several *mostly monographic* cues
 // in EACH alphabet. A few Cyrillic names in Latin cues are not enough.
 if(cyrCues>=3 && latCues>=3)return 'MIX';
 // Ambiguous near-even text without separate substantial dialogue is unknown.
 return null;
}
// Serbian-standard Latin -> Cyrillic is used for the three regional subtitle languages.
// Transliteration is orthographic, NOT translation of Croatian/Bosnian to Serbian.
const singleLetters={a:'а',b:'б',c:'ц',č:'ч',ć:'ћ',d:'д',đ:'ђ',e:'е',f:'ф',g:'г',h:'х',i:'и',j:'ј',k:'к',l:'л',m:'м',n:'н',o:'о',p:'п',r:'р',s:'с',š:'ш',t:'т',u:'у',v:'в',z:'з',ž:'ж'};
function convertWord(word){
 let result='';
 for(let i=0;i<word.length;){
  const pair=word.slice(i,i+2).toLowerCase();
  if(['lj','nj','dž'].includes(pair)){
   const next=word.slice(i,i+2),letter={lj:'љ',nj:'њ','dž':'џ'}[pair];
   const allUpper=next===next.toUpperCase(),initialUpper=next[0]===next[0].toUpperCase();
   result+=allUpper?letter.toUpperCase():(initialUpper?letter.toUpperCase():letter);i+=2;continue;
  }
  const ch=word[i],mapped=singleLetters[ch.toLowerCase()];
  result+=mapped?(ch===ch.toUpperCase()?mapped.toUpperCase():mapped):ch;i++;
 }
 return result;
}
export function transliterateText(input){
 // Keep URLs, tags and common subtitle markup unchanged.
 return String(input).split(/(<[^>]*>|\{\\[^}]*\}|https?:\/\/\S+|www\.\S+)/g)
  .map(part=>part.startsWith('<')||part.startsWith('{\\')||/^(?:https?:\/\/|www\.)/.test(part)?part:
   part.replace(/[A-Za-zČĆĐŠŽčćđšž]+/g,convertWord)).join('');
}
export function transliterateSubtitle(input){
 const normalized=String(input).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 if(!/(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->/.test(normalized))throw Error('Not an SRT/VTT subtitle');
 const lines=normalized.split('\n');
 const result=lines.map((line,i)=>{
  const t=line.trim();
  if(!t || /^WEBVTT(?:\s|$)/.test(t) || /^\d+$/.test(t) || /^NOTE(?:\s|$)/.test(t) || /^STYLE(?:\s|$)/.test(t) || /^REGION(?:\s|$)/.test(t) || /^X-TIMESTAMP-MAP/.test(t) || /(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->/.test(t))return line;
  return transliterateText(line);
 });
 // Serve the transformed content as WebVTT; WebVTT accepts numeric cue identifiers.
 const body=result.join('\n').replace(/(\d{2}:\d{2}:\d{2}),([0-9]{3})/g,'$1.$2');
 return (body.startsWith('WEBVTT')?'':'WEBVTT\n\n')+body;
}
async function getConvertibleSubtitle(url,fetchFn=fetch){
 if(!allowedForInspection(url))throw Error('Unsupported subtitle URL');
 const r=await fetchFn(url,{headers:{Accept:'text/vtt, text/plain, application/x-subrip'},redirect:'manual',signal:AbortSignal.timeout(11000)});
 if(!r.ok || r.status>=300 || !r.body)throw Error('Source unavailable');
 const contentType=(r.headers.get('content-type')||'').toLowerCase();
 if(/zip|rar|7z|gzip|pdf|html/.test(contentType))throw Error('Unsupported subtitle format');
 if(Number(r.headers.get('content-length')||0)>1024*1024)throw Error('Subtitle too large');
 const reader=r.body.getReader();let chunks=[],total=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;
  if(total>1024*1024){await reader.cancel();throw Error('Subtitle too large');}chunks.push(value);
 }}finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let off=0;for(const c of chunks){bytes.set(c,off);off+=c.byteLength;}
 if(bytes.length<20||(bytes[0]===0x50&&bytes[1]===0x4b)||(bytes[0]===0x52&&bytes[1]===0x61&&bytes[2]===0x72))throw Error('Archive or empty subtitle');
 let decoded;
 try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
 catch{decoded=new TextDecoder('windows-1250').decode(bytes);}
 if(/^\s*(?:<!doctype|<html|\{\s*"error")/i.test(decoded))throw Error('Source is not subtitle content');
 return transliterateSubtitle(decoded);
}
async function appendCyrillicVersions(subs,config,token,origin,secret){
 if(config.transliteration!=='both')return;
 const wanted=new Set(config.translitLangs);const originals=[...subs];
 for(const s of originals){
  const lang=normLang(s.lang);if(!wanted.has(lang)||!safeSubtitle(s.url)||!allowedForInspection(s.url))continue;
  const payload={u:s.url,l:lang};
  const subtoken=await encodeConfig(payload,secret); // AES-GCM bearer URL, never expose upstream URL.
  subs.push({id:`[CYR] ${s.id}`,lang:s.lang,url:`${origin}/convert/${subtoken}.vtt`,label:`[CYR] ${s.label||s.id}`});
 }
}

function allowedForInspection(raw) {
 if(!safeSubtitle(raw))return false;
 const url=new URL(raw);
 const host=url.hostname.toLowerCase();
 // Avoid fetching internal/private/network-local hosts in the Workers runtime.
 if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.test')||host.endsWith('.invalid')||host.endsWith('.onion'))return false;
 if(/^[0-9.]+$/.test(host)||host.includes(':')||!host.includes('.'))return false;
 return true;
}
async function inspectSubtitle(url,fetchFn=fetch){
 if(!allowedForInspection(url))return null;
 try{
  const r=await fetchFn(url,{method:'GET',redirect:'manual',headers:{Accept:'text/plain, text/vtt, application/x-subrip'},signal:AbortSignal.timeout(2500)});
  if(!r.ok||r.status>=300||!r.body)return null;
  const mime=(r.headers.get('content-type')||'').toLowerCase();
  if(/zip|rar|octet-stream|gzip|7z|pdf/.test(mime)) {await r.body.cancel();return null;}
  const length=Number(r.headers.get('content-length')||0);
  if(length>160000){await r.body.cancel();return null;}
  const reader=r.body.getReader();let chunks=[],total=0;
  try{
   for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;
    if(total>160000){await reader.cancel();return null;}chunks.push(value);
   }
  }finally{reader.releaseLock();}
  const data=new Uint8Array(total);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
  if(data.length<30||data[0]===0x50&&data[1]===0x4b||data[0]===0x52&&data[1]===0x61&&data[2]===0x72)return null;
  const body=new TextDecoder('utf-8',{fatal:true}).decode(data);
  if(!/\d{2}:\d{2}:\d{2}[.,]\d{3}|WEBVTT/.test(body))return null;
  return detectSerbianScript(body);
 }catch{return null;}
}
async function annotateScripts(subtitles,env){
 // Process more candidates, but cap external requests so Nuvio isn't held indefinitely.
 const items=subtitles.filter(x=>normLang(x.lang)==='srp').slice(0,24);
 const concurrency=8;
 let next=0;
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
  while(next<items.length){
   const s=items[next++];
   let script=null;
   const key='script/v223/'+base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s.url)))).slice(0,44)+'.txt';
   if(env.SUBTITLE_CACHE){try{const hit=await env.SUBTITLE_CACHE.get(key);if(hit)script=(await hit.text()).trim();}catch{}}
   if(!script){script=await inspectSubtitle(s.url);if(script&&env.SUBTITLE_CACHE){try{await env.SUBTITLE_CACHE.put(key,script);}catch{}}}
   if(['CYR','LAT','MIX'].includes(script)){
    const original=s.label||s.id;
    s.id=`[${script}] ${s.id}`;
    s.label=`[${script}] ${original}`;
   }
  }
 }));
}
async function getSubtitles(cfg,type,id,extra,fetchFn=fetch){
 const base=cfg.url.slice(0,-'/manifest.json'.length).replace(/\/$/,'');
 const paths=[upstreamUrl(base,type,id,extra)];if(type==='series')paths.push(`${base}/subtitles/${type}/${encodeURIComponent(id)}.json`);
 for(const target of paths){
  try {
   const response=await fetchFn(target,{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(8500)});
   if(!response.ok)continue;
   const payload=await response.json();if(!Array.isArray(payload?.subtitles))continue;
   const found=filterSubs(payload.subtitles,cfg.langs);if(found.length||target===paths.at(-1))return found;
  }catch(error){console.warn('Titlovi upstream unavailable',error?.name||'Error');}
 }return [];
}
const configurationPage=`<!doctype html><html lang="mk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Titlovi.com unofficial — Cloudflare</title><style>body{font:16px system-ui,sans-serif;background:#f3f7fb;color:#162739;padding:28px}main{max-width:690px;margin:auto;background:white;padding:25px;border-radius:14px}input[type=url]{width:100%;padding:10px;box-sizing:border-box}label{display:block;margin:10px 0}button{padding:12px;background:#1f4e79;color:#fff;border:0;border-radius:8px}#out{overflow-wrap:anywhere}</style></head><body><main><h2>Titlovi.com unofficial</h2><p>Неофицијален додаток. Внеси ја својата приватна Titlovi.com manifest.json адреса. Приватниот инсталациски URL не го споделувај.</p><form id="f"><label>Приватна адреса на официјалниот Titlovi.com додаток<input name="url" type="url" required placeholder="https://stremio.titlovi.com/.../manifest.json"></label><fieldset><legend>Јазици</legend><label><input type="checkbox" name="lang" value="eng" checked> Англиски</label><label><input type="checkbox" name="lang" value="mkd" checked> Македонски</label><label><input type="checkbox" name="lang" value="srp" checked> Српски (латиница и кирилица)</label><label><input type="checkbox" name="lang" value="hrv" checked> Хрватски</label><label><input type="checkbox" name="lang" value="bos" checked> Босански</label></fieldset><label><input type="checkbox" name="detectScript"> Препознај српско писмо [CYR]/[LAT] (пробно; може да го забави вчитувањето)</label><fieldset><legend>Дополнителни кирилични верзии</legend><label><input type="checkbox" name="transliteration" checked> Прикажи оригинални + кирилични верзии</label><label><input type="checkbox" name="translitLang" value="srp" checked> Српски</label><label><input type="checkbox" name="translitLang" value="hrv" checked> Хрватски</label><label><input type="checkbox" name="translitLang" value="bos" checked> Босански</label></fieldset><button>Создај приватен линк</button></form><div id="out"></div></main><script>document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();let f=e.target,out=document.getElementById('out');out.textContent='';try{const r=await fetch('/api/configure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:f.elements.namedItem('url').value,langs:[...f.querySelectorAll('[name=lang]:checked')].map(x=>x.value),detectScript:f.elements.namedItem('detectScript').checked,transliteration:f.elements.namedItem('transliteration').checked?'both':'off',translitLangs:[...f.querySelectorAll('[name=translitLang]:checked')].map(x=>x.value)})});const j=await r.json();if(!r.ok)throw Error(j.error);const a=document.createElement('a');a.href=j.manifest;a.textContent=j.manifest;out.append('Приватен линк за инсталација: ',a);}catch(e){out.textContent=e.message}})</script></body></html>`;
export default {
 async fetch(request,env,ctx){
  try{validateSecret(env);}catch(e){return json({error:e.message},503);}
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const uri=new URL(request.url);const p=uri.pathname;
  if(request.method==='GET'&&p==='/health')return json({ok:true,host:'cloudflare',version:'2.3.0'});
  if(request.method==='GET'&&(p==='/'||p==='/configure'))return text(configurationPage,200);
  if(request.method==='GET'&&p==='/manifest.json')return json(manifest);
  if(request.method==='POST'&&p==='/api/configure'){
   try{
    if(Number(request.headers.get('content-length')||0)>5000)return json({error:'Request too large'},413);
    const raw=await request.text();if(raw.length>5000)return json({error:'Request too large'},413);
    const data=JSON.parse(raw),url=validSource(data.url),langs=[...new Set((Array.isArray(data.langs)?data.langs:[]).map(normLang).filter(Boolean))];
    if(!langs.length)throw Error('Select at least one language');
    const token=await encodeConfig({url,langs,detectScript:data.detectScript===true,transliteration:data.transliteration==='both'?'both':'off',translitLangs:(Array.isArray(data.translitLangs)?data.translitLangs:[]).map(normLang).filter(x=>['srp','hrv','bos'].includes(x))},env.CONFIG_SECRET),base=uri.origin;
    const result=`${base}/c/${token}/manifest.json`;return json({manifest:result,stremio:result.replace(/^https?:\/\//,'stremio://')});
   }catch(error){return json({error:error.message||'Invalid configuration'},400);}
  }
  const manifestMatch=/^\/c\/([a-zA-Z0-9_-]+)\/manifest\.json$/.exec(p);
  if(request.method==='GET'&&manifestMatch){
   try{await decodeConfig(manifestMatch[1],env.CONFIG_SECRET);return json({...manifest,behaviorHints:{configurable:true,configurationRequired:false}})}catch{return json({error:'Invalid configuration'},404)}
  }
  const convertMatch=/^\/convert\/([a-zA-Z0-9_-]{35,3500})\.vtt$/.exec(p);
  if(request.method==='GET'&&convertMatch){
   try{const cfg=await decodeConversion(convertMatch[1],env.CONFIG_SECRET);
    const key='translit/v230/'+base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(cfg.u)))).slice(0,44)+'.vtt';
    if(env.SUBTITLE_CACHE){const hit=await env.SUBTITLE_CACHE.get(key);if(hit)return new Response(hit.body,{headers:{...cors,'content-type':'text/vtt; charset=utf-8','cache-control':'public, max-age=86400'}});}
    const converted=await getConvertibleSubtitle(cfg.u);
    if(env.SUBTITLE_CACHE)ctx?.waitUntil?.(env.SUBTITLE_CACHE.put(key,converted,{httpMetadata:{contentType:'text/vtt; charset=utf-8'}}));
    return text(converted,200,'text/vtt; charset=utf-8');
   }catch(e){console.warn('Transliteration unavailable',e?.message||'Error');return text('Subtitle unavailable',502,'text/plain; charset=utf-8');}
  }
  const subMatch=/^\/c\/([a-zA-Z0-9_-]+)\/subtitles\/(movie|series)\/([^/]+?)(?:\/(.*))?\.json$/.exec(p);
  if(request.method==='GET'&&subMatch){
   let id;try{id=decodeURIComponent(subMatch[3]);}catch{return json({subtitles:[]})}
   if(!mediaId(subMatch[2],id))return json({subtitles:[]});
   try{
    const cfg=await decodeConfig(subMatch[1],env.CONFIG_SECRET);
    const cacheKey=`titles/v230/${subMatch[2]}/${encodeURIComponent(id)}/${await crypto.subtle.digest('SHA-256',encoder.encode(subMatch[1]+'|'+(subMatch[4]||''))).then(b=>base64url(new Uint8Array(b)).slice(0,32))}.json`;
    if(env.SUBTITLE_CACHE){const cached=await env.SUBTITLE_CACHE.get(cacheKey);if(cached){const data=await cached.json();return json(data,200,'public,max-age=90');}}
    const subtitles=await getSubtitles(cfg,subMatch[2],id,subMatch[4]||'');
    if(cfg.detectScript)await annotateScripts(subtitles,env);
    await appendCyrillicVersions(subtitles,cfg,subMatch[1],uri.origin,env.CONFIG_SECRET);
    if(subtitles.length&&env.SUBTITLE_CACHE)ctx.waitUntil(env.SUBTITLE_CACHE.put(cacheKey,JSON.stringify({subtitles}),{httpMetadata:{contentType:'application/json'}}));
    return json({subtitles},200,'public,max-age=90');
   }catch{return json({subtitles:[]})}
  }
  return json({error:'Not found'},404);
 }
};