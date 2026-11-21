begin;
create schema if not exists rea;
revoke all on schema rea from public, anon, authenticated;
create table rea.admins(id uuid primary key references auth.users on delete cascade);
create table rea.visitors(id uuid primary key, first_seen timestamptz not null default now());
create table rea.events(
 id uuid primary key, visitor uuid not null references rea.visitors, session uuid not null, tab uuid not null,
 seq bigint not null, kind text not null, ts timestamptz not null default now(), seconds numeric not null,
 track text, title text, artist text, playback uuid, agent jsonb not null, referral text, value numeric, art text
);
create index events_time on rea.events(ts);
create index events_session on rea.events(session,ts);
create table rea.presence(tab uuid primary key, visitor uuid not null references rea.visitors, session uuid not null,
 seq bigint not null, seen timestamptz not null, listening boolean not null, evidence timestamptz);
create index presence_time on rea.presence(seen);
create table rea.samples(minute timestamptz primary key, visitors int not null,listeners int not null);
create table rea.limits(bucket text primary key, minute timestamptz not null, hits int not null);
create table rea.config(singleton boolean primary key default true check(singleton), zone text not null default 'Asia/Kolkata',
 period int not null default 7 check(period in (1,7,30,90)), refresh int not null default 15 check(refresh between 5 and 120),
 timeout int not null default 60 check(timeout between 30 and 120), meaningful int not null default 30 check(meaningful between 10 and 180),
 retention int not null default 90 check(retention between 7 and 365), charts boolean not null default true, collecting boolean not null default true);
insert into rea.config(singleton) values(true);
create table rea.audit(ts timestamptz default now(), admin uuid, settings jsonb);
do $$ declare t record; begin for t in select tablename from pg_tables where schemaname='rea' loop
 execute format('alter table rea.%I enable row level security',t.tablename); end loop; end $$;

create function public.rea_collect(events jsonb,bucket text,agent jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare e jsonb; v uuid; n int; m timestamptz:=date_trunc('minute',now()); cap int;
begin
 if not (select collecting from rea.config) then return true; end if;
 if jsonb_array_length(events) not between 1 and 12 then return false; end if;
 insert into rea.limits as l values(bucket,m,jsonb_array_length(events)) on conflict on constraint limits_pkey do update set
 hits=case when l.minute=m then l.hits+excluded.hits else excluded.hits end,minute=m returning hits into n;
 if n>600 then return false; end if;
 for e in select * from jsonb_array_elements(events) loop
 v:=(e->>'visitor')::uuid;
 insert into rea.visitors(id) values(v) on conflict do nothing;
 insert into rea.events values((e->>'id')::uuid,v,(e->>'session')::uuid,(e->>'tab')::uuid,(e->>'seq')::bigint,e->>'type',clock_timestamp(),
 (e->>'seconds')::numeric,nullif(e->>'track',''),e->>'title',e->>'artist',(e->>'playback')::uuid,agent,e->>'referral',(e->>'value')::numeric,e->>'art') on conflict do nothing;
 if found then
 insert into rea.presence as p values((e->>'tab')::uuid,v,(e->>'session')::uuid,(e->>'seq')::bigint,
 case when e->>'type'='leave' then '-infinity'::timestamptz else clock_timestamp() end,
 (e->>'playing')::boolean and e->>'type' <> 'presence',
 case when e->>'type' in ('track_start','track_resume','listening_heartbeat') then clock_timestamp() end)
 on conflict(tab) do update set visitor=excluded.visitor,session=excluded.session,seq=excluded.seq,seen=excluded.seen,listening=excluded.listening,evidence=coalesce(excluded.evidence,p.evidence)
 where excluded.seq>p.seq;
 end if;
 end loop;
 select timeout into cap from rea.config;
 insert into rea.samples as s select m,count(distinct visitor),count(distinct visitor) filter(where listening and evidence>now()-make_interval(secs=>cap))
 from rea.presence where seen>now()-make_interval(secs=>cap)
 on conflict(minute) do update set visitors=greatest(s.visitors,excluded.visitors),listeners=greatest(s.listeners,excluded.listeners);
 return true;
end $$;

create function public.rea_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from rea.admins where id=auth.uid()) $$;
create function public.rea_settings(p jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;
begin
 if not public.rea_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 if p is not null then
 if not exists(select from pg_timezone_names where name=p->>'zone') then raise exception 'Unknown time zone'; end if;
 update rea.config set zone=p->>'zone',period=(p->>'period')::int,refresh=(p->>'refresh')::int,timeout=(p->>'timeout')::int,
 meaningful=(p->>'meaningful')::int,retention=(p->>'retention')::int,charts=(p->>'charts')::boolean,collecting=(p->>'collecting')::boolean;
 insert into rea.audit(admin,settings) values(auth.uid(),p);
 end if;
 select to_jsonb(c)-'singleton' into s from rea.config c; return s;
end $$;

create function public.rea_live() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.rea_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 with active as (select * from rea.presence where seen>now()-make_interval(secs=>(select timeout from rea.config))),
 minutes as (select generate_series(date_trunc('minute',now())-interval '29 min',date_trunc('minute',now()),interval '1 min') t)
 select jsonb_build_object('active',count(distinct visitor),'listening',count(distinct visitor) filter(where listening and evidence>now()-make_interval(secs=>(select timeout from rea.config))),
 'sessions',count(distinct session),'last',(select max(seen) from rea.presence where isfinite(seen)),
 'series',(select jsonb_agg(jsonb_build_object('time',t,'visitors',coalesce(visitors,0),'listeners',coalesce(listeners,0)) order by t)
 from minutes left join rea.samples on minute=t),
 'feed',(select coalesce(jsonb_agg(to_jsonb(f)),'[]') from (select * from ((select ts,kind,title from rea.events where kind not in ('presence','listening_heartbeat','api_latency') order by ts desc limit 30) union all (select max(seen)+make_interval(secs=>(select timeout from rea.config)),'session_expired','' from rea.presence where seen>now()-interval '24 hours' group by session having max(seen)<now()-make_interval(secs=>(select timeout from rea.config)) order by 1 desc limit 30)) recent order by ts desc limit 30) f))
 into result from active;
 return result;
end $$;

create function public.rea_report(first_day date,last_day date) returns jsonb language plpgsql security definer set search_path='' as $$
declare z text; lo timestamptz; hi timestamptz; result jsonb;
begin
 if not public.rea_admin() then raise exception 'Forbidden' using errcode='42501'; end if;
 if last_day-first_day not between 0 and 365 then raise exception 'Invalid range'; end if;
 select zone into z from rea.config; lo:=first_day::timestamp at time zone z; hi:=(last_day+1)::timestamp at time zone z;
 with e as materialized (select * from rea.events where ts>=lo and ts<hi),
 sess as (select session,extract(epoch from max(ts)-min(ts)) duration,count(*) filter(where kind='track_start') plays,
 min(ts) filter(where kind='search') searched,min(ts) filter(where kind='track_start') played from e group by session),
 tracks as (select track,max(art) art,max(title) title,max(artist) artist,count(*) filter(where kind='track_start') plays,
 count(distinct visitor) filter(where playback is not null) listeners,round(sum(seconds)/60,2) minutes,
 count(*) filter(where kind='track_end') completed,max(ts) filter(where kind='track_start') latest from e where track is not null group by track),
 days as (select (ts at time zone z)::date day,count(distinct visitor) visitors,count(*) filter(where kind='track_start') plays,round(sum(seconds)/60,2) minutes from e group by 1),
 hours as (select extract(hour from ts at time zone z)::int hour,count(*) filter(where kind='track_start') plays,round(sum(seconds)/60,2) minutes from e group by 1),
 breakdown as (select k dimension,coalesce(v,'Unavailable') label,count(distinct visitor) visitors from e cross join lateral
 (values ('Device',agent->>'device'),('Browser',agent->>'browser'),('OS',agent->>'os'),('Country',agent->>'country'),('Referral',referral)) as dim(k,v) where k<>'Referral' or v is not null group by k,v),
 artist_summary as (select artist,count(*) filter(where kind='track_start') plays,count(distinct visitor) filter(where playback is not null) listeners,round(sum(seconds)/60,2) minutes from e where track is not null group by artist),
 firsts as (select distinct e.visitor,v.first_seen from e join rea.visitors v on v.id=e.visitor),
 performance as (select (ts at time zone z)::date day,kind,count(*) samples,round(avg(value),2) average from e where kind in ('client_error','playback_error','api_error','api_latency','page_load','lcp','inp','cls') group by 1,2)
 select jsonb_build_object('visitors',count(distinct visitor),'newVisitors',(select count(*) from firsts where first_seen>=lo),
 'today',(select count(distinct visitor) from rea.events where ts>=((now() at time zone z)::date::timestamp at time zone z)),
 'sessions',(select count(*) from sess),'averageSession',(select round(avg(duration)) from sess),'plays',count(*) filter(where kind='track_start'),
 'seconds',coalesce(sum(seconds),0),'completed',count(*) filter(where kind='track_end'),'skips',count(*) filter(where kind='track_skip'),
 'listeners',count(distinct visitor) filter(where kind='track_start' or seconds>0),
 'peak',(select coalesce(max(listeners),0) from rea.samples where minute>=lo and minute<hi),
 'searchSessions',(select count(*) from sess where searched is not null),
 'converted',(select count(*) from sess where exists(select from e p where p.session=sess.session and p.kind='track_start' and p.ts>=sess.searched)),
 'discovered',count(distinct session) filter(where kind in ('search','track_selected')),
 'selected',count(distinct session) filter(where kind='track_selected'),'started',count(distinct session) filter(where kind='track_start'),
 'meaningful',(select count(distinct session) from (select session,playback from e where playback is not null group by session,playback having sum(seconds)>=(select meaningful from rea.config)) q),
 'tracks',coalesce((select jsonb_agg(to_jsonb(t) order by plays desc,title) from tracks t where plays>0),'[]'),
 'artists',coalesce((select jsonb_agg(to_jsonb(t) order by plays desc) from artist_summary t where plays>0),'[]'),
 'days',coalesce((select jsonb_agg(to_jsonb(d) order by day) from days d),'[]'),'hours',coalesce((select jsonb_agg(to_jsonb(h) order by hour) from hours h),'[]'),
 'audience',coalesce((select jsonb_agg(to_jsonb(b) order by dimension,visitors desc) from breakdown b),'[]'),
 'performance',coalesce((select jsonb_agg(to_jsonb(p) order by day desc,kind) from performance p),'[]')) into result from e;
 return result;
end $$;
create function public.rea_prune() returns void language plpgsql security definer set search_path='' as $$
declare cutoff timestamptz:=now()-make_interval(days=>(select retention from rea.config));
begin delete from rea.events where ts<cutoff; delete from rea.samples where minute<cutoff;
delete from rea.presence where seen<now()-interval '1 day'; delete from rea.limits where minute<now()-interval '1 day';
delete from rea.visitors v where first_seen<cutoff and not exists(select from rea.events e where e.visitor=v.id);
delete from rea.audit where ts<cutoff; end $$;
revoke all on function public.rea_collect(jsonb,text,jsonb),public.rea_prune(),public.rea_admin(),public.rea_settings(jsonb),public.rea_live(),public.rea_report(date,date) from public,anon,authenticated;
grant execute on function public.rea_collect(jsonb,text,jsonb),public.rea_prune() to service_role;
grant execute on function public.rea_admin(),public.rea_settings(jsonb),public.rea_live(),public.rea_report(date,date) to authenticated;
commit;
