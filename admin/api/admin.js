const pages=new Set('dashboard realtime music audience engagement performance settings profile login'.split(' '));
const shell='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>REA Music Admin</title><link rel="stylesheet" href="/admin.css"><script type="module" src="/admin.js"></script></head><body><a class="skip" href="#main">Skip to content</a><div id="root"></div><noscript>Enable JavaScript to view analytics.</noscript></body></html>';
export default async function handler(req,res){
 const origin=process.env.ADMIN_ORIGIN;
 const url=new URL(req.url,'http://local');
 const view=req.query?.view || url.searchParams.get('view');
 const action=url.searchParams.get('action');
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://c.saavncdn.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 res.setHeader('X-Content-Type-Options','nosniff');
 const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 const page=()=>{res.writeHead(200,{'Content-Type':'text/html;charset=UTF-8'});res.end(shell);};
 const redirect=()=>{res.writeHead(303,{Location:'/login'});res.end();};
 if(req.method==='GET' && view==='login') return page();
 if(req.method==='POST' && (!origin || req.headers.origin!==origin)) return json(403,{error:'Origin rejected'});
 const cookieName=origin?.startsWith('https://')?'__Host-rea_admin':'rea_admin';
 const setCookie=(token,age)=>res.setHeader('Set-Cookie',cookieName+'='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+age+(origin?.startsWith('https://')?'; Secure':''));
 if(action==='logout' && req.method==='POST'){setCookie('',0);return json(200,{});}
 const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 const key=process.env.SUPABASE_ANON_KEY,base=process.env.SUPABASE_URL;
 async function api(path,token,body){
   const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,Authorization:'Bearer '+(token||key),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
   if(!response.ok){const err=new Error();err.status=response.status;throw err;}return response.json();
 }
 async function input(){
   let v=req.body;
   if(v===undefined){let data='';for await(const part of req){data+=part;if(data.length>4096)throw Error();}v=data;}
   if(typeof v==='string') v=JSON.parse(v);
   if(!v||JSON.stringify(v).length>4096) throw Error();return v;
 }
 try{
   if(action==='login' && req.method==='POST'){
     const {email,password}=await input();
     if(typeof email!=='string'||typeof password!=='string')return json(400,{error:'Enter email and password'});
     const auth=await api('/auth/v1/token?grant_type=password',null,{email,password});
     if(!await api('/rest/v1/rpc/rea_admin',auth.access_token,{}))return json(403,{error:'Administrator access required'});
     setCookie(auth.access_token,Math.min(3600,auth.expires_in));return json(200,{});
   }
   if(!cookie)return view?redirect():json(401,{error:'Sign in required'});
   if(view && pages.has(view)){
     if(!await api('/rest/v1/rpc/rea_admin',cookie,{}))return redirect();
     return page();
   }
   if(action==='profile' && req.method==='GET'){
     if(!await api('/rest/v1/rpc/rea_admin',cookie,{})) return json(403,{error:'Forbidden'});
     const user=await api('/auth/v1/user',cookie);return json(200,{email:user.email});
   }
   const read=req.method==='GET';
   const rpc={settings:'rea_settings',report:'rea_report',live:'rea_live'}[action];
   if(!rpc || (!read && !(req.method==='POST' && action==='settings')))return json(405,{error:'Unsupported request'});
   const body=action==='report'?{first_day:url.searchParams.get('start'),last_day:url.searchParams.get('end')}:action==='settings'?{p:read?null:await input()}:{};
   return json(200,await api('/rest/v1/rpc/'+rpc,cookie,body));
 }catch(e){
   if(view && [401,403].includes(e.status))return redirect();
   const status=e.status===429?429:[400,401,403].includes(e.status)?e.status:503;
   return json(status,{error:status===503?'Analytics service unavailable. Check Supabase configuration.':action==='login'?'Sign-in unsuccessful':'Request rejected'});
 }
}
