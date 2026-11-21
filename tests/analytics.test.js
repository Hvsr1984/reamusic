import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import collect,{valid} from '../api/analytics/collect.js';
import admin from '../admin/api/admin.js';
const now=Date.now();
const event={id:randomUUID(),visitor:randomUUID(),session:randomUUID(),tab:randomUUID(),seq:1,type:'presence',at:now,seconds:0,playing:false,track:'',title:'',artist:'',playback:null};
test('collector validates identifiers, timestamps, duration, types and metadata',()=>{
 assert.ok(valid(event,now));
 for (const patch of [{seconds:31},{type:'other'},{tab:'anything'},{seq:0},{at:now-61000},{referral:'https://private'},{email:'x'},{title:'a'.repeat(161)},{art:'javascript:alert(1)'}])assert.ok(!valid({...event,...patch},now));
});
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);},end(body){this.body=body;}};}
test('collector rejects foreign origin, oversize payload and malformed JSON',async()=>{
 process.env.PLAYER_ORIGIN='http://player';for(const [origin,body,status] of [['http://other','[]',403],['http://player','a'.repeat(20000),413],['http://player','{',400]]){
 const res=response();await collect({method:'POST',headers:{origin,'content-type':'application/json'},body},res);assert.equal(res.status,status);}
});
test('admin route and reporting API require authentication',async()=>{
 for(const [url,status] of [['/api/admin?view=dashboard',303],['/api/admin?action=report',401],['/api/admin?view=login',200]]){
 const res=response();await admin({url,method:'GET',headers:{}},res);assert.equal(res.status,status);}
});
test('login checks Supabase password and allowlist before issuing HttpOnly session',async t=>{
 process.env.ADMIN_ORIGIN='https://admin.example';process.env.SUPABASE_URL='http://supabase';process.env.SUPABASE_ANON_KEY='test';let allow=false;
 t.mock.method(globalThis,'fetch',async url=>Response.json(url.includes('/auth/')?{access_token:'allowed-user-token',expires_in:3600}:allow));
 for(const expected of [403,200]){
 const res=response();await admin({method:'POST',url:'/api/admin?action=login',headers:{origin:process.env.ADMIN_ORIGIN},body:{email:'owner@example.org',password:'fixture'}},res);
 assert.equal(res.status,expected);if(allow)assert.match(res.headers['Set-Cookie'],/HttpOnly; SameSite=Strict; Path=\/; Max-Age=3600; Secure/);else assert.equal(res.headers['Set-Cookie'],undefined);allow=true;}
});
test('CSRF protection applies to configuration writes',async()=>{
 const res=response();await admin({url:'/api/admin?action=settings',method:'POST',headers:{origin:'https://other'}},res);assert.equal(res.status,403);
});
test('player consent, playback state, seek exclusion and repeated playing events',async()=>{
 const events=[],handlers={},store=new Map(),session=new Map(),doc=new EventTarget(),audio=new EventTarget();let tick,ms=0;
 doc.createElement=()=>({style:{}});doc.querySelector=()=>({append(){}});
 const storage=s=>({getItem:k=>s.get(k)||null,setItem:(k,v)=>s.set(k,String(v)),removeItem:k=>s.delete(k)});
 const win={};vm.runInNewContext(readFileSync(new URL('../js/analytics.js',import.meta.url),'utf8'),{window:win,document:doc,localStorage:storage(store),sessionStorage:storage(session),navigator:{onLine:true},crypto:{randomUUID},performance:{now:()=>ms},setInterval:fn=>{tick=fn;},setTimeout:fn=>setImmediate(fn),addEventListener:(k,f)=>handlers[k]=f,fetch:async(_,o)=>{events.push(...JSON.parse(o.body));return {ok:true};},Event,Date,URL});
 const flush=()=>new Promise(resolve=>setTimeout(resolve,8));await flush();assert.deepEqual(events,[]);
 store.set('rea.analytics.consent','yes');win.reaAnalytics.attach(audio);audio.currentTime=0;
 win.reaAnalytics.select({id:'track',title:'Title'});audio.dispatchEvent(new Event('playing'));audio.dispatchEvent(new Event('playing'));await flush();
 ms=25000;audio.currentTime=25;tick();audio.dispatchEvent(new Event('pause'));await flush();
 ms=55000;audio.currentTime=120;audio.dispatchEvent(new Event('seeking'));await flush();audio.dispatchEvent(new Event('playing'));await flush();
 audio.dispatchEvent(new Event('ended'));await flush();
 assert.equal(events.filter(e=>e.type==='track_start').length,1);assert.equal(events.filter(e=>e.type==='track_resume').length,1);
 assert.equal(events.reduce((s,e)=>s+e.seconds,0),25);assert.equal(events.at(-1).playing,false);assert.equal(new Set(events.map(e=>e.visitor)).size,1);assert.equal(new Set(events.map(e=>e.id)).size,events.length);
});

test('collector preserves event IDs for retries and handles database rate limits and outages', async t => {
  process.env.PLAYER_ORIGIN = 'http://player';
  process.env.SUPABASE_URL = 'http://development-db';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  process.env.RATE_LIMIT_SECRET = 'test-only';
  const packet = {...event, at: Date.now()};
  const req = {method:'POST', headers:{origin:'http://player','content-type':'application/json'}, body:[packet]};
  let result;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://development-db/rest/v1/rpc/rea_collect');
    const forwarded = JSON.parse(options.body);
    assert.equal(forwarded.events[0].id, packet.id);
    assert.match(forwarded.bucket, /^[a-f0-9]{64}$/);
    return result;
  });
  for (const [reply, status] of [[Response.json(true),204],[Response.json(false),429],[new Response(null,{status:500}),503]]) {
    result = reply;
    const res = response();
    await collect(req,res);
    assert.equal(res.status,status);
  }
});
