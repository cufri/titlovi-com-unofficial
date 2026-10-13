'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { URL, URLSearchParams } = require('node:url');

const MANIFEST = Object.freeze({
  id:'community.titlovi.unofficial', name:'Titlovi.com unofficial', version:'2.0.0',
  description:'Unofficial community relay for your own Titlovi.com Stremio addon. English, Macedonian, Serbian, Croatian and Bosnian subtitles.',
  resources:['subtitles'], types:['movie','series'], idPrefixes:['tt'], catalogs:[],
  behaviorHints:{configurable:true,configurationRequired:true}
});
const LANGS = new Map(Object.entries({
  en:'eng',eng:'eng',english:'eng', mk:'mkd',mkd:'mkd',mac:'mkd',mak:'mkd',
  sr:'srp',srp:'srp',serbian:'srp', hr:'hrv',hrv:'hrv',croatian:'hrv',
  bs:'bos',bos:'bos',bosnian:'bos'
}));
const DEFAULT_LANGS=['eng','mkd','srp','hrv','bos'];
function normLang(v){return LANGS.get(String(v||'').toLowerCase().trim())||null;}
function checkManifestUrl(s){
  const u=new URL(s);
  if(u.protocol!=='https:'||u.hostname!=='stremio.titlovi.com'||u.port||u.username||u.password||u.search||u.hash||!/^\/(?:[^/]+\/)*manifest\.json$/.test(u.pathname)) throw Error('Only private https://stremio.titlovi.com/.../manifest.json links are supported');
  if(s.length>1500) throw Error('Manifest URL is too long');
  return u.toString();
}
function configKey(secret){if(!secret||secret.length<32)throw Error('CONFIG_SECRET must contain at least 32 characters');return crypto.createHash('sha256').update(secret).digest();}
function encodeConfig(data,key){const iv=crypto.randomBytes(12);const c=crypto.createCipheriv('aes-256-gcm',key,iv);const enc=Buffer.concat([c.update(JSON.stringify(data),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),enc]).toString('base64url');}
function decodeConfig(token,key){if(!/^[a-zA-Z0-9_-]{35,3500}$/.test(token))throw Error('Invalid configuration token');const buf=Buffer.from(token,'base64url');if(buf.length<30)throw Error('Invalid token');const dec=crypto.createDecipheriv('aes-256-gcm',key,buf.subarray(0,12));dec.setAuthTag(buf.subarray(12,28));const o=JSON.parse(Buffer.concat([dec.update(buf.subarray(28)),dec.final()]).toString('utf8'));const url=checkManifestUrl(o.url);const langs=[...new Set((Array.isArray(o.langs)?o.langs:[]).map(normLang).filter(Boolean))];if(!langs.length)throw Error('No languages');return {url,langs};}
function validMedia(type,id){return type==='movie'?/^tt\d+$/.test(id):type==='series'&&/^tt\d+:\d+:\d+$/.test(id);}
function parseRoute(path){const m=/^\/c\/([a-zA-Z0-9_-]+)\/subtitles\/(movie|series)\/([^/]+?)(?:\/(.*))?\.json$/.exec(path);if(!m)return null;let id;try{id=decodeURIComponent(m[3]);}catch{return null;}return validMedia(m[2],id)?{token:m[1],type:m[2],id,extra:m[4]||''}:null;}
function sourceUrl(base,type,id,extra=''){
  const params=new URLSearchParams(extra);
  if(type==='series')params.set('videoID',id);
  const e=params.toString();return `${base}/subtitles/${type}/${encodeURIComponent(id)}${e?'/'+e:''}.json`;
}
function safeUrl(s){try{const u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port;}catch{return false;}}
function filterSubs(items,langs){const out=[],seen=new Set(),usedNames=new Set(),wanted=new Set(langs);for(const s of (Array.isArray(items)?items:[]).slice(0,300)){
  if(!s||!safeUrl(s.url)||!wanted.has(normLang(s.lang)))continue;
  const rawLang=String(s.lang).trim();const seed=`${normLang(s.lang)}\0${s.id||''}\0${s.url}`;
  const id='titlovi-unofficial-'+crypto.createHash('sha256').update(seed).digest('hex').slice(0,24);if(seen.has(id))continue;seen.add(id);
  const label=typeof s.label==='string'?s.label.trim().slice(0,240):'';
  // Nuvio Android TV displays subtitle.id as filename metadata. Use the clean
  // original release name, disambiguating only actual duplicate names.
  const base=label||id;let displayId=base;
  for(let n=2;usedNames.has(displayId);n++)displayId=`${base} (${n})`;
  usedNames.add(displayId);
  const row={id:displayId,lang:rawLang,url:s.url};if(label)row.label=label;out.push(row);
}return out;}
async function getSubs(cfg,type,id,extra,fetcher=fetch){const base=cfg.url.slice(0,-'/manifest.json'.length).replace(/\/$/,'');const variants=[sourceUrl(base,type,id,extra)];if(type==='series')variants.push(`${base}/subtitles/${type}/${encodeURIComponent(id)}.json`);for(const p of variants){try{const r=await fetcher(p,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000),redirect:'error'});if(!r.ok)continue;const data=await r.json();if(!Array.isArray(data?.subtitles))continue;const result=filterSubs(data.subtitles,cfg.langs);if(result.length||p===variants.at(-1))return result;}catch(e){console.warn('upstream request failed:',e?.name||'Error');}}return [];}
function send(res,status,obj,type='application/json; charset=utf-8',headers={}){res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','access-control-allow-origin':'*',...headers});res.end(typeof obj==='string'?obj:JSON.stringify(obj));}
function page(){return `<!doctype html><html lang="mk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Titlovi.com unofficial — Конфигурација</title><style>body{font-family:system-ui,sans-serif;background:#f5f8fc;color:#17283a;margin:0;padding:24px}main{max-width:720px;margin:25px auto;background:white;border:1px solid #dbe4ee;border-radius:16px;padding:28px;box-shadow:0 10px 25px #1226380a}h1{margin-top:0}p{line-height:1.6}input[type=url]{box-sizing:border-box;width:100%;padding:13px;border:1px solid #97a8b9;border-radius:8px}fieldset{border:1px solid #dbe4ee;border-radius:8px;margin:18px 0;padding:15px}label{display:block;margin:9px 0}button{background:#1f4e79;color:white;border:0;border-radius:8px;padding:13px 20px;font-weight:650;cursor:pointer}a{overflow-wrap:anywhere}.note{background:#eef6f6;border-radius:8px;padding:13px}.bad{color:#b02323}</style></head><body><main><h1>Titlovi.com unofficial</h1><p>Неофицијален Stremio/Nuvio додаток за преводи на пет јазици.</p><p class="note">Внесете ја вашата приватна адреса на официјалниот Titlovi.com Stremio додаток. Адресата нема да се запише во GitHub. Конфигурираниот инсталациски URL е приватен — секој што го поседува може да го користи вашиот пристап.</p><form id="form"><label for="url"><strong>Приватна Titlovi.com manifest.json адреса</strong></label><input id="url" type="url" required autocomplete="off" placeholder="https://stremio.titlovi.com/.../manifest.json"><fieldset><legend>Јазици</legend><label><input type="checkbox" name="lang" value="eng" checked> Англиски</label><label><input type="checkbox" name="lang" value="mkd" checked> Македонски</label><label><input type="checkbox" name="lang" value="srp" checked> Српски</label><label><input type="checkbox" name="lang" value="hrv" checked> Хрватски</label><label><input type="checkbox" name="lang" value="bos" checked> Босански</label></fieldset><button type="submit">Создај приватен инсталациски линк</button></form><section id="result" aria-live="polite"></section><p><small>Ознаките за изданијата (<code>label</code>) остануваат во Stremio одговорите; некои верзии на Nuvio не ги прикажуваат. Јазичните кодови не се менуваат.</small></p></main><script>const f=document.getElementById('form'),out=document.getElementById('result');f.addEventListener('submit',async e=>{e.preventDefault();out.textContent='';const url=document.getElementById('url').value;const langs=[...f.querySelectorAll('[name=lang]:checked')].map(x=>x.value);try{const r=await fetch('/api/configure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,langs})});const j=await r.json();if(!r.ok)throw Error(j.error||'Грешка');const p=document.createElement('p');p.textContent='Вашата приватна адреса за инсталација:';const a=document.createElement('a');a.href=j.manifest;a.textContent=j.manifest;const p2=document.createElement('p');const install=document.createElement('a');install.href=j.stremio;install.textContent='Отвори во Stremio';p2.append(install);out.append(p,a,p2);}catch(err){out.textContent=err.message;out.className='bad';}});</script></body></html>`;}
function originFromRequest(req,publicUrl){if(publicUrl)return new URL(publicUrl).origin;const host=req.headers.host||'127.0.0.1:7100';if(!/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host))throw Error('PUBLIC_URL must be set for public hosting');return `http://${host}`;}
function makeServer({secret,publicUrl='',fetcher=fetch}={}){
 const key=configKey(secret);const clients=new Map();
 return http.createServer(async(req,res)=>{
  let u;try{u=new URL(req.url,'http://localhost');}catch{return send(res,400,{error:'Bad URL'});}
  if(req.method==='GET'&&u.pathname==='/health')return send(res,200,{ok:true});
  if(req.method==='GET'&&(u.pathname==='/'||u.pathname==='/configure'))return send(res,200,page(),'text/html; charset=utf-8',{'content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});
  if(req.method==='GET'&&u.pathname==='/manifest.json')return send(res,200,MANIFEST);
  if(req.method==='POST'&&u.pathname==='/api/configure'){
   const ip=req.socket.remoteAddress||'unknown',now=Date.now();const prev=clients.get(ip)||{start:now,n:0};if(now-prev.start>60000){prev.start=now;prev.n=0;}if(++prev.n>20)return send(res,429,{error:'Too many configuration requests'});clients.set(ip,prev);if(clients.size>2000)clients.clear();
   let body='';try{for await(const chunk of req){body+=chunk;if(body.length>5000)throw Error('Request too large');}const obj=JSON.parse(body);const url=checkManifestUrl(obj.url);const langs=[...new Set((Array.isArray(obj.langs)?obj.langs:[]).map(normLang).filter(Boolean))];if(!langs.length)throw Error('Select at least one language');const token=encodeConfig({url,langs},key);const origin=originFromRequest(req,publicUrl);const manifest=`${origin}/c/${token}/manifest.json`;return send(res,200,{manifest,stremio:manifest.replace(/^https?:\/\//,'stremio://')});}catch(e){return send(res,400,{error:e.message});}
  }
  const mm=/^\/c\/([a-zA-Z0-9_-]+)\/manifest\.json$/.exec(u.pathname);
  if(req.method==='GET'&&mm){try{decodeConfig(mm[1],key);return send(res,200,{...MANIFEST,behaviorHints:{configurable:true,configurationRequired:false}});}catch{return send(res,404,{error:'Invalid configuration'});}}
  const route=req.method==='GET'?parseRoute(u.pathname):null;
  if(route){try{const cfg=decodeConfig(route.token,key);const subtitles=await getSubs(cfg,route.type,route.id,route.extra,fetcher);return send(res,200,{subtitles},'application/json; charset=utf-8',{'cache-control':'public, max-age=90'});}catch{return send(res,200,{subtitles:[]});}}
  return send(res,404,{error:'Not found'});
 });
}
if(require.main===module){const port=Number(process.env.PORT||7100),host=process.env.HOST||'0.0.0.0';try{makeServer({secret:process.env.CONFIG_SECRET,publicUrl:process.env.PUBLIC_URL||''}).listen(port,host,()=>console.log(`Titlovi.com unofficial listening on port ${port}`));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={MANIFEST,normLang,checkManifestUrl,encodeConfig,decodeConfig,configKey,validMedia,parseRoute,sourceUrl,filterSubs,getSubs,makeServer,DEFAULT_LANGS};
