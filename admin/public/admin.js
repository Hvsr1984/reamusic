const root=document.querySelector('#root');
const route=location.pathname.slice(1)||'dashboard';
const pages={dashboard:'Overview',realtime:'Live Activity',audience:'Audience',music:'Music',engagement:'Engagement',performance:'Performance',settings:'Settings',profile:'Profile'};
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function button(text,fn){const n=el('button',text);n.type='button';n.onclick=fn;return n;}
function field(name,input){const l=el('label',name);l.append(input);return l;}
async function api(action,data,params={}){
 const url=new URL('/api/admin',location.origin);url.search=new URLSearchParams({action,...params});
 const response=await fetch(url,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const result=await response.json();if(!response.ok){if(response.status===401&&route!=='login')location.replace('/login');throw Error(result.error);}return result;
}
function login(){
 const panel=el('main',undefined,'login');panel.id='main';
 const f=el('form'),email=el('input'),pw=el('input'),msg=el('p','','error');
 email.type='email';email.autocomplete='username';pw.type='password';pw.autocomplete='current-password';pw.required=email.required=true;
 const submit=el('button','Sign in','primary');msg.role='alert';
 f.append(field('Email address',email),field('Password',pw),submit,msg);
 f.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{await api('login',{email:email.value,password:pw.value});location.replace('/dashboard');}catch(err){msg.textContent=err.message;}finally{submit.disabled=false;}};
 panel.append(el('strong','REA MUSIC','brand'),el('h1','Admin sign in'),el('p','Use your administrator account.'),f);root.append(panel);
}
const fmt=n=>n==null?'—':new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(n);
const ratio=(a,b)=>b?fmt(100*a/b)+'%':'—';
const formatTime=s=>s?new Date(s).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—';
function table(title,columns,rows){
 const box=el('article'),wrap=el('div',undefined,'scroll'),t=el('table'),head=el('thead'),tr=el('tr');
 columns.forEach(c=>tr.append(el('th',c)));head.append(tr);t.append(head);
 const body=el('tbody');rows.forEach(row=>{const tr=el('tr');row.forEach(v=>{const td=el('td');if(v instanceof Node)td.append(v);else td.textContent=v??'—';tr.append(td);});body.append(tr);});t.append(body);wrap.append(t);box.append(el('h2',title),rows.length?wrap:el('p','No observations in this period.'));return box;
}
function chart(title,rows,x,y){
 const box=el('article');box.append(el('h2',title));
 if(!rows.length){box.append(el('p','No observations in this period.'));return box;}
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 420 130');svg.setAttribute('class','chart');svg.setAttribute('role','img');svg.setAttribute('aria-label',title);
 const node=(tag,attrs)=>{const n=document.createElementNS(svg.namespaceURI,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);svg.append(n);return n;};
 const max=Math.max(1,...rows.map(r=>Number(r[y])));for(let i=0;i<3;i++)node('line',{x1:8,x2:412,y1:9+i*55,y2:9+i*55,class:'axis'});
 const points=rows.map((r,i)=>[8+i*404/Math.max(1,rows.length-1),119-110*Number(r[y])/max]);
 node('polyline',{points:points.map(p=>p.join(',')).join(' '),class:'line'});
 points.forEach(([cx,cy],i)=>{const dot=node('circle',{cx,cy,r:2.6,class:'mark'});const tip=document.createElementNS(svg.namespaceURI,'title');tip.textContent=rows[i][x]+' · '+fmt(rows[i][y]);dot.append(tip);});
 box.append(svg,el('small',String(rows[0][x])+' — '+String(rows.at(-1)[x])+'   ·   Peak '+fmt(Math.max(...rows.map(r=>r[y]))),'muted'));return box;
}
const cards=items=>{const grid=el('div',undefined,'cards');for(const [name,value,tip] of items){const c=el('div',undefined,'card');c.title=tip||name;c.append(el('span',name),el('strong',typeof value==='number'?fmt(value):value??'—'));grid.append(c);}return grid;};
const group=(...items)=>{const n=el('div',undefined,'panels');n.append(...items);return n;};
let config,dates,report,live,interval,ticket=0,search='',sort='plays',page=0,descending=true;
const content=el('section'),status=el('p','','error'),controls=el('div',undefined,'controls'),stamp=el('time','');
status.role='alert';
function day(offset){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:config.zone,year:'numeric',day:'2-digit',month:'2-digit'}).formatToParts(new Date());
 const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));const d=new Date(Date.UTC(+v.year,+v.month-1,+v.day+offset));return d.toISOString().slice(0,10);
}
function filters(){
 const sel=el('select');sel.ariaLabel='Reporting period';for(const [value,name] of [['1','Today'],['y','Yesterday'],['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days'],['custom','Custom range']])sel.add(new Option(name,value));
 sel.value=String(config.period);const start=el('input'),end=el('input');start.type=end.type='date';start.ariaLabel='Start date';end.ariaLabel='End date';
 const apply=button('Apply',()=>{if(!start.value||!end.value||start.value>end.value){status.textContent='Choose a valid date range.';return;}dates={start:start.value,end:end.value};page=0;refresh();});
 function change(){const custom=sel.value==='custom';start.hidden=end.hidden=apply.hidden=!custom;if(custom)return;
 const yesterday=sel.value==='y';dates={start:day(yesterday?-1:1-Number(sel.value)),end:day(yesterday?-1:0)};start.value=dates.start;end.value=dates.end;page=0;}
 change();sel.onchange=()=>{change();if(sel.value!=='custom')refresh();};controls.append(sel,start,end,apply,button('Export CSV',csv));
}
function csv(){
 if(!report)return;
 const rows=[['Day','Visitors','Track starts','Listening minutes'],...report.days.map(r=>[r.day,r.visitors,r.plays,r.minutes])];
 const url=URL.createObjectURL(new Blob([rows.map(r=>r.join(',')).join('\r\n')],{type:'text/csv'}));const a=el('a');a.href=url;a.download='rea-'+dates.start+'-'+dates.end+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function cover(url){if(!url)return '—';const im=el('img');im.src=url;im.alt='';im.width=im.height=36;im.loading='lazy';return im;}
function music(){
 const r=report;
 const grid=cards([['Track starts',r.plays],['Listening hours',r.seconds/3600],['Completed tracks',r.completed],['Skips',r.skips],['Seconds per start',r.plays?r.seconds/r.plays:null],['Completion rate',ratio(r.completed,r.plays)],['Unique listeners',r.listeners]]);
 const input=el('input');input.placeholder='Search by song';input.ariaLabel='Search by song';input.value=search;
 const ordering=el('select');ordering.ariaLabel='Sort tracks';for(const key of ['plays','title','artist','listeners','minutes','completed','latest'])ordering.add(new Option(key,key));ordering.value=sort;
 const list=el('div'),direction=button(descending?'Descending':'Ascending',()=>{descending=!descending;direction.textContent=descending?'Descending':'Ascending';draw();});
 function draw(){const rows=r.tracks.filter(t=>t.title.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>(typeof a[sort]==='number'?a[sort]-b[sort]:String(a[sort]).localeCompare(String(b[sort])))*(descending?-1:1));
 const pages=Math.max(1,Math.ceil(rows.length/10));page=Math.min(page,pages-1);
 const prev=button('Previous',()=>{page--;draw();}),next=button('Next',()=>{page++;draw();});prev.disabled=page===0;next.disabled=page>=pages-1;
 list.replaceChildren(table('Top songs',['#','Cover','Song','Artist','Plays','Listeners','Minutes','Completed','Latest play'],rows.slice(page*10,page*10+10).map((t,i)=>[page*10+i+1,cover(t.art),t.title,t.artist,t.plays,t.listeners,t.minutes,ratio(t.completed,t.plays),new Date(t.latest).toLocaleString()])),prev,el('span','  '+(page+1)+' / '+pages+'  '),next);}
 input.oninput=()=>{search=input.value;page=0;draw();};ordering.onchange=()=>{sort=ordering.value;page=0;draw();};const bar=el('div',undefined,'controls');bar.append(input,ordering,direction);draw();
 content.append(grid,bar,list,table('Top artists',['Artist','Plays','Listeners','Minutes'],r.artists.map(a=>[a.artist,a.plays,a.listeners,a.minutes])));
 if(config.charts)content.append(group(chart('Track starts by day',r.days,'day','plays'),chart('Track starts by hour',r.hours,'hour','plays'),chart('Top ten tracks',r.tracks.slice(0,10),'title','plays'),chart('Completed plays by track',r.tracks.slice(0,10),'title','completed'),chart('Listening minutes',r.days,'day','minutes')));
}
function settings(){
 const form=el('form',undefined,'settings'),inputs={};const schema={zone:'Reporting time zone',period:'Default period (1, 7, 30 or 90 days)',refresh:'Refresh interval (5–120 seconds)',timeout:'Presence window (30–120 seconds)',meaningful:'Meaningful listening (10–180 seconds)',retention:'Retention (7–365 days)',charts:'Show charts',collecting:'Collect opted-in analytics'};
 for(const [key,label] of Object.entries(schema)){const inp=el('input');inp.type=typeof config[key]==='boolean'?'checkbox':typeof config[key]==='number'?'number':'text';if(inp.type==='checkbox')inp.checked=config[key];else inp.value=config[key];inputs[key]=inp;form.append(field(label,inp));}
 const save=el('button','Save settings','primary');form.append(save);form.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{const v=Object.fromEntries(Object.entries(inputs).map(([k,n])=>[k,n.type==='checkbox'?n.checked:n.type==='number'?Number(n.value):n.value]));config=await api('settings',v);status.textContent='Settings saved.';}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};content.append(form);
}
const feed=()=>table('Recent activity',['Time','Event','Track'],live.feed.map(e=>[formatTime(e.ts),e.kind.replaceAll('_',' '),e.title||'—']));
function render(){
 content.replaceChildren();const r=report,l=live;
 if(route==='settings')return settings();if(route==='music')return music();
 if(route==='dashboard'){
 content.append(cards([['Active users now',l.active,'Unique visitors in the last '+config.timeout+' seconds'],['Listening right now',l.listening,'Fresh playback evidence in an active tab'],['Visitors today',r.today,config.zone+' reporting day'],['Total visitors',r.visitors,'Unique anonymous visitors in this period'],['Songs played',r.plays,'Observed media starts'],['Listening hours',r.seconds/3600,'Measured playback progress'],['Average session (s)',r.averageSession,'Time between first and last observations in range'],['Peak concurrent listeners',r.peak,'Highest sampled listener count']]));
 if(config.charts)content.append(group(chart('Visitors over time',r.days,'day','visitors'),chart('Concurrent listeners · 30 min',l.series.map(v=>({...v,time:formatTime(v.time)})),'time','listeners'),chart('Track starts',r.days,'day','plays'),chart('Listening minutes',r.days,'day','minutes')));
 content.append(group(table('Top five tracks',['Song','Plays'],r.tracks.slice(0,5).map(t=>[t.title,t.plays])),feed()));
 }else if(route==='realtime'){
 content.append(cards([['Active visitors',l.active],['Currently listening',l.listening],['Browsing',l.active-l.listening],['Active sessions',l.sessions]]),el('p','Last presence update '+formatTime(l.last)+' · '+config.timeout+'-second activity window'));
 if(config.charts)content.append(chart('Active visitors · last 30 minutes',l.series.map(v=>({...v,time:formatTime(v.time)})),'time','visitors'));content.append(feed());
 }else if(route==='audience'){
 content.append(cards([['Unique visitors',r.visitors],['New visitors',r.newVisitors],['Returning visitors',r.visitors-r.newVisitors],['Sessions',r.sessions],['Average session (s)',r.averageSession]]),group(...['Device','Browser','OS','Country','Referral'].map(k=>table(k,['Category','Visitors'],r.audience.filter(b=>b.dimension===k).map(b=>[b.label,b.visitors])))));
 content.append(table('Landing page',['Path','Visitors'],r.visitors?[['/',r.visitors]]:[]));if(config.charts)content.append(group(chart('Engagement by day',r.days,'day','minutes'),chart('Engagement by hour',r.hours,'hour','minutes')));
 }else if(route==='engagement'){
 content.append(cards([['Songs per session',r.sessions?r.plays/r.sessions:null],['Listening seconds per session',r.sessions?r.seconds/r.sessions:null],['Repeat visitor share',ratio(r.visitors-r.newVisitors,r.visitors)],['Skip rate',ratio(r.skips,r.plays)],['Completion rate',ratio(r.completed,r.plays)],['Search to play',ratio(r.converted,r.searchSessions)]]),table('Listening funnel',['Observed stage','Sessions'],[['Visit',r.sessions],['Discovered music',r.discovered],['Selected track',r.selected],['Started playback',r.started],['Listened '+config.meaningful+'s',r.meaningful]]));
 if(config.charts)content.append(group(chart('Listening minutes by hour',r.hours,'hour','minutes'),chart('Engagement by day',r.days,'day','minutes')));
 }else if(route==='performance'){content.append(table('Platform measurements',['Reporting day','Signal','Samples','Mean value'],r.performance.map(p=>[p.day,p.kind,p.samples,p.average])),el('p','Timings use milliseconds. LCP, cumulative layout shift and longest observed interaction are client observations, not field-score percentiles. Independent uptime monitoring is unconfigured. Configure an external HTTPS monitor for the player URL.'));}
}
async function refresh(){
 const seq=++ticket;
 try{let data,now;if(route==='profile'){const u=await api('profile');content.replaceChildren(el('p',u.email));return;}
 if(route!=='realtime' && route!=='settings')data=await api('report',undefined,dates);
 if(route==='realtime'||route==='dashboard')now=await api('live');
 if(seq!==ticket)return;report=data;live=now;status.textContent='';render();stamp.textContent='Updated '+formatTime(Date.now());
 }catch(e){if(seq===ticket)status.textContent=e.message;}
}
async function workspace(){
 const shell=el('div',undefined,'shell'),aside=el('aside'),body=el('div'),header=el('header'),main=el('main');main.id='main';
 const menu=button('Menu',toggle),close=button('Close',toggle);close.className='mobile-close';aside.id='sidebar';menu.setAttribute('aria-controls','sidebar');
 function toggle(){if(matchMedia('(max-width:760px)').matches){const open=shell.classList.toggle('opened');menu.setAttribute('aria-expanded',String(open));if(open)close.focus();else menu.focus();}else shell.classList.toggle('compact');}
 aside.append(close,el('strong','REA MUSIC'));for(const [label,keys] of [['WORKSPACE',['dashboard','realtime']],['ANALYTICS',['audience','music','engagement','performance']],['SYSTEM',['settings']],['ACCOUNT',['profile']]]){aside.append(el('small',label));for(const k of keys){const a=el('a',pages[k]);a.href='/'+k;if(k===route)a.setAttribute('aria-current','page');aside.append(a);}}
 aside.append(button('Log out',async()=>{try{await api('logout',{});location.replace('/login');}catch(e){status.textContent=e.message;}}));
 aside.onkeydown=e=>{if(!shell.classList.contains('opened'))return;if(e.key==='Escape')toggle();if(e.key==='Tab'){const items=aside.querySelectorAll('a,button');if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items[items.length-1].focus();}else if(!e.shiftKey&&document.activeElement===items[items.length-1]){e.preventDefault();items[0].focus();}}};
 const account=el('a','Account');account.href='/profile';header.append(menu,stamp,button('Refresh',refresh),account);
 main.append(el('h1',pages[route]||'Overview'));if(route==='dashboard')main.append(el('p','Monitor your audience, listening activity, and platform performance.'));
 main.append(controls,status,content);body.append(header,main);shell.append(aside,body);root.append(shell);content.textContent='Loading analytics…';
 try{config=await api('settings');if(!['profile','settings','realtime'].includes(route))filters();await refresh();
 if(route==='realtime'||route==='dashboard')interval=setInterval(()=>{if(!document.hidden)refresh();},(route==='dashboard'?Math.max(60,config.refresh):config.refresh)*1000);
 }catch(e){content.replaceChildren();status.textContent=e.message;}
}
if(route==='login')login();else workspace();
