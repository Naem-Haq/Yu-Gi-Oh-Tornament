-- All browser mutations go through tournament_action; no direct table writes.
create table public.organizers(user_id uuid primary key references auth.users(id));
create table public.cards(id bigint primary key, name text unique not null, card_type text not null, description text not null, extra boolean not null, max_copies int not null check(max_copies between 0 and 3), copy_key text not null);
create table public.tournaments(id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 100), stage text not null default 'registration' check(stage in ('registration','groups','semifinals','final','complete')), deadline timestamptz not null, decks_locked boolean not null default false, created_at timestamptz not null default now());
create table public.registrations(tournament_id uuid references public.tournaments on delete cascade, user_id uuid references auth.users, display_name text not null check(length(display_name) between 1 and 40), seed int, group_name text check(group_name in ('A','B')), primary key(tournament_id,user_id));
create table public.decks(id uuid primary key default gen_random_uuid(), tournament_id uuid not null, user_id uuid not null, name text not null check(length(name) between 1 and 80), nexus_url text check(nexus_url is null or nexus_url ~ '^https://(www\.)?duelingnexus\.com/'), entries jsonb not null, updated_at timestamptz not null default now(), foreign key(tournament_id,user_id) references public.registrations on delete cascade);
create table public.matches(id uuid primary key default gen_random_uuid(), tournament_id uuid not null references public.tournaments on delete cascade, stage text not null check(stage in ('groups','semifinals','final')), group_name text, round int not null, table_no int not null, p1 uuid not null, p2 uuid not null, score1 int, score2 int, status text not null default 'scheduled' check(status in ('scheduled','pending','disputed','confirmed')), submitted_by uuid references auth.users, dispute text, check(p1<>p2), check((score1 is null and score2 is null) or (score1=2 and score2 in(0,1)) or (score2=2 and score1 in(0,1))), check(status='scheduled' or (score1 is not null and score2 is not null)), foreign key(tournament_id,p1) references public.registrations, foreign key(tournament_id,p2) references public.registrations, unique(tournament_id,stage,round,table_no));
create table public.deck_choices(match_id uuid references public.matches on delete cascade, user_id uuid references auth.users, deck_id uuid not null references public.decks, primary key(match_id,user_id));
create table public.audit_log(id bigint generated always as identity primary key, tournament_id uuid references public.tournaments, actor uuid references auth.users, action text not null, details jsonb not null, created_at timestamptz not null default now());
create index on public.decks(tournament_id,user_id);
create index on public.matches(tournament_id);
create function public.is_organizer() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.organizers where user_id=auth.uid()) $$;
revoke all on function public.is_organizer() from public, anon, authenticated;
grant execute on function public.is_organizer() to authenticated;
alter table public.organizers enable row level security;
alter table public.cards enable row level security;
alter table public.tournaments enable row level security;
alter table public.registrations enable row level security;
alter table public.decks enable row level security;
alter table public.matches enable row level security;
alter table public.deck_choices enable row level security;
alter table public.audit_log enable row level security;
create policy own_role on public.organizers for select to authenticated using(user_id=auth.uid());
create policy read_cards on public.cards for select to authenticated using(true);
create policy read_tournaments on public.tournaments for select to authenticated using(true);
create policy read_players on public.registrations for select to authenticated using(true);
create policy read_matches on public.matches for select to authenticated using(true);
create policy private_decks on public.decks for select to authenticated using(user_id=auth.uid() or public.is_organizer());
create policy private_choices on public.deck_choices for select to authenticated using(user_id=auth.uid() or public.is_organizer());
create policy admin_audit on public.audit_log for select to authenticated using(public.is_organizer());
revoke all on public.organizers, public.cards, public.tournaments, public.registrations, public.decks, public.matches, public.deck_choices, public.audit_log from anon, authenticated;
grant select on public.organizers, public.cards, public.tournaments, public.registrations, public.decks, public.matches, public.deck_choices, public.audit_log to authenticated;

create function public.validate_entries(items jsonb) returns void language plpgsql set search_path=public as $$
declare main_count int; extra_count int; side_count int; bad record;
begin
 if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>90 then raise exception 'Invalid deck entries'; end if;
 if exists(select 1 from jsonb_array_elements(items) e where jsonb_typeof(e->'card_id') is distinct from 'number' or jsonb_typeof(e->'quantity') is distinct from 'number' or (e->>'card_id') !~ '^[0-9]{1,9}$' or (e->>'quantity') !~ '^[1-3]$' or coalesce(e->>'section','') not in ('main','extra','side')) then raise exception 'Invalid card quantity or section'; end if;
 if exists(select 1 from jsonb_to_recordset(items) as e(card_id bigint,quantity int,section text) left join cards c on c.id=e.card_id where c.id is null) then raise exception 'Unknown card or card outside July 2014 NAWCQ pool'; end if;
 select coalesce(sum(quantity) filter(where section='main'),0),coalesce(sum(quantity) filter(where section='extra'),0),coalesce(sum(quantity) filter(where section='side'),0) into main_count,extra_count,side_count from jsonb_to_recordset(items) as e(card_id bigint,quantity int,section text);
 if main_count not between 40 and 60 or extra_count>15 or side_count>15 then raise exception 'Deck sizes: Main must be 40–60; Extra and Side each 0–15 (received %, %, %)',main_count,extra_count,side_count; end if;
 for bad in select c.name from jsonb_to_recordset(items) as e(card_id bigint,quantity int,section text) join cards c on c.id=e.card_id where (e.section='main' and c.extra) or (e.section='extra' and not c.extra) loop raise exception '% is in the wrong deck section',bad.name; end loop;
 for bad in select c.copy_key, sum(e.quantity) n,min(c.max_copies) lim from jsonb_to_recordset(items) as e(card_id bigint,quantity int,section text) join cards c on c.id=e.card_id group by c.copy_key having sum(e.quantity)>min(c.max_copies) loop raise exception '%: % copies; April 2014 limit is % across all sections',bad.copy_key,bad.n,bad.lim; end loop;
end $$;
revoke all on function public.validate_entries(jsonb) from public, anon, authenticated;

create view public.standings with(security_invoker=true) as
select r.*,count(m.id)::int played,
count(m.id) filter(where (m.p1=r.user_id and m.score1=2) or (m.p2=r.user_id and m.score2=2))::int wins,
count(m.id) filter(where (m.p1=r.user_id and m.score2=2) or (m.p2=r.user_id and m.score1=2))::int losses,
coalesce(sum(case when m.p1=r.user_id then m.score1 else m.score2 end),0)::int gf,
coalesce(sum(case when m.p1=r.user_id then m.score2 else m.score1 end),0)::int ga,
(3*count(m.id) filter(where (m.p1=r.user_id and m.score1=2) or (m.p2=r.user_id and m.score2=2)))::int points,
coalesce(sum(case when m.p1=r.user_id then m.score1-m.score2 else m.score2-m.score1 end),0)::int diff
from public.registrations r left join public.matches m on m.tournament_id=r.tournament_id and m.stage='groups' and m.status='confirmed' and r.user_id in(m.p1,m.p2) group by r.tournament_id,r.user_id;
grant select on public.standings to authenticated;

create function public.tournament_action(tid uuid, action text, payload jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 uid uuid:=auth.uid(); admin boolean:=public.is_organizer(); t tournaments; m matches; d decks; player uuid; result_id uuid; n int; i int; j int; r int; g int; tables int; ring uuid[]; a uuid[]; b uuid[]; last_player uuid; old_result jsonb;
begin
 if uid is null then raise exception 'Sign in first'; end if;
 if action='create' then
  if not admin then raise exception 'Organiser access required'; end if;
  if (payload->>'deadline')::timestamptz<=now() then raise exception 'Choose a future deadline'; end if;
  insert into tournaments(name,deadline) values(trim(payload->>'name'),(payload->>'deadline')::timestamptz) returning id into result_id;
  insert into audit_log(tournament_id,actor,action,details) values(result_id,uid,action,payload);
  return jsonb_build_object('id',result_id);
 end if;
 -- Serializing by tournament makes capacity checks, result transitions and generation atomic.
 select * into t from tournaments where id=tid for update;
 if not found then raise exception 'Tournament not found'; end if;
 if action in ('start','advance','lock','unlock','deadline','remove_player','override') and not admin then raise exception 'Organiser access required'; end if;
 if action='register' then
  if t.stage<>'registration' or t.decks_locked or now()>=t.deadline then raise exception 'Registration is closed'; end if;
  if not exists(select 1 from registrations where tournament_id=tid and user_id=uid) and (select count(*) from registrations where tournament_id=tid)>=12 then raise exception 'Tournament is full (12 players)'; end if;
  insert into registrations(tournament_id,user_id,display_name) values(tid,uid,trim(payload->>'name')) on conflict(tournament_id,user_id) do update set display_name=excluded.display_name;
 elsif action in ('withdraw','remove_player') then
  if t.stage<>'registration' then raise exception 'Players cannot be removed after the draw'; end if;
  if action='withdraw' and (t.decks_locked or now()>=t.deadline) then raise exception 'Registration is locked; ask the organiser to remove you'; end if;
  player:=case when action='remove_player' then (payload->>'user_id')::uuid else uid end;
  delete from registrations where tournament_id=tid and user_id=player;
 elsif action='deadline' then
  if t.stage<>'registration' then raise exception 'Deadline is fixed after the draw'; end if;
  if (payload->>'deadline')::timestamptz<=now() then raise exception 'Choose a future deadline'; end if;
  update tournaments set deadline=(payload->>'deadline')::timestamptz where id=tid;
 elsif action in ('lock','unlock') then
  if t.stage<>'registration' then raise exception 'Decks stay locked after the draw'; end if;
  update tournaments set decks_locked=(action='lock') where id=tid;
 elsif action in ('save_deck','delete_deck') then
  if t.stage<>'registration' or t.decks_locked or now()>=t.deadline then raise exception 'Deck submissions are locked'; end if;
  if not exists(select 1 from registrations where tournament_id=tid and user_id=uid) then raise exception 'Register before submitting a deck'; end if;
  if payload->>'id' is not null then
   select * into d from decks where id=(payload->>'id')::uuid and tournament_id=tid and user_id=uid;
   if not found then raise exception 'Deck not found or not yours'; end if;
  end if;
  if action='delete_deck' then delete from decks where id=d.id;
  else
   perform public.validate_entries(payload->'entries');
   if d.id is null and (select count(*) from decks where tournament_id=tid and user_id=uid)>=3 then raise exception 'Maximum three registered decks'; end if;
   insert into decks(id,tournament_id,user_id,name,nexus_url,entries) values(coalesce(d.id,gen_random_uuid()),tid,uid,trim(payload->>'name'),nullif(payload->>'nexus_url',''),payload->'entries') on conflict(id) do update set name=excluded.name,nexus_url=excluded.nexus_url,entries=excluded.entries,updated_at=now() returning id into result_id;
  end if;
 elsif action='start' then
  if t.stage<>'registration' then raise exception 'Draw has already been generated'; end if;
  select count(*) into n from registrations where tournament_id=tid;
  if n not between 4 and 12 then raise exception 'Register 4–12 players to start'; end if;
  if exists(select 1 from registrations p where p.tournament_id=tid and not exists(select 1 from decks submitted where submitted.tournament_id=tid and submitted.user_id=p.user_id)) then raise exception 'Every player needs at least one valid deck'; end if;
  for d in select * from decks where tournament_id=tid loop perform public.validate_entries(d.entries); end loop;
  with draw as(select user_id,row_number() over(order by random())::int seed from registrations where tournament_id=tid)
  update registrations p set seed=draw.seed,group_name=case when n<=5 or draw.seed%2=1 then 'A' else 'B' end from draw where p.tournament_id=tid and p.user_id=draw.user_id;
  tables:=0;
  for g in 1..case when n<=5 then 1 else 2 end loop
   select array_agg(user_id order by seed) into ring from registrations where tournament_id=tid and group_name=case when g=1 then 'A' else 'B' end;
   if array_length(ring,1)%2=1 then ring:=array_append(ring,null::uuid); end if;
   for r in 1..array_length(ring,1)-1 loop
    j:=0;
    for i in 1..array_length(ring,1)/2 loop
     if ring[i] is not null and ring[array_length(ring,1)+1-i] is not null then
      j:=j+1;
      insert into matches(tournament_id,stage,group_name,round,table_no,p1,p2) values(tid,'groups',case when g=1 then 'A' else 'B' end,r,tables+j,ring[i],ring[array_length(ring,1)+1-i]);
     end if;
    end loop;
    last_player:=ring[array_length(ring,1)]; ring:=array[ring[1],last_player]||ring[2:array_length(ring,1)-1];
   end loop;
   tables:=tables+array_length(ring,1)/2;
  end loop;
  update tournaments set stage='groups',decks_locked=true where id=tid;
 elsif action='advance' then
  if t.stage not in ('groups','semifinals','final') then raise exception 'No stage to advance'; end if;
  if not exists(select 1 from matches where tournament_id=tid and stage=t.stage) or exists(select 1 from matches where tournament_id=tid and stage=t.stage and status<>'confirmed') then raise exception 'Confirm every result in the current stage first'; end if;
  if t.stage='groups' then
   select array_agg(user_id order by points desc,diff desc,gf desc,seed) into a from standings where tournament_id=tid and group_name='A';
   select array_agg(user_id order by points desc,diff desc,gf desc,seed) into b from standings where tournament_id=tid and group_name='B';
   insert into matches(tournament_id,stage,round,table_no,p1,p2) values(tid,'semifinals',1,1,a[1],coalesce(b[2],a[4])),(tid,'semifinals',1,2,coalesce(b[1],a[2]),case when b is null then a[3] else a[2] end);
   update tournaments set stage='semifinals' where id=tid;
  elsif t.stage='semifinals' then
   select array_agg(case when score1=2 then p1 else p2 end order by table_no) into a from matches where tournament_id=tid and stage='semifinals';
   insert into matches(tournament_id,stage,round,table_no,p1,p2) values(tid,'final',1,1,a[1],a[2]);
   update tournaments set stage='final' where id=tid;
  else update tournaments set stage='complete' where id=tid;
  end if;
 elsif action in ('choose_deck','submit','confirm','dispute','override') then
  select * into m from matches where id=(payload->>'match_id')::uuid and tournament_id=tid for update;
  if not found then raise exception 'Match not found'; end if;
  old_result:=to_jsonb(m);
  if action<>'override' and uid not in(m.p1,m.p2) then raise exception 'This is not your fixture'; end if;
  if action<>'override' and m.stage<>t.stage then raise exception 'This stage is not active'; end if;
  if action='choose_deck' then
   if m.status<>'scheduled' then raise exception 'The match has already been reported'; end if;
   if exists(select 1 from deck_choices where match_id=m.id and user_id=uid) then raise exception 'Deck already committed for this best of three'; end if;
   select * into d from decks where id=(payload->>'deck_id')::uuid and tournament_id=tid and user_id=uid;
   if not found then raise exception 'Select one of your registered decks'; end if;
   insert into deck_choices values(m.id,uid,d.id);
  elsif action='submit' then
   if m.status<>'scheduled' then raise exception 'A result has already been submitted'; end if;
   if (select count(*) from deck_choices where match_id=m.id)<>2 then raise exception 'Both players must commit a deck first'; end if;
   update matches set score1=(payload->>'score1')::int,score2=(payload->>'score2')::int,status='pending',submitted_by=uid where id=m.id;
  elsif action in ('confirm','dispute') then
   if m.status<>'pending' or m.submitted_by=uid then raise exception 'Only the opponent can confirm or dispute a pending result'; end if;
   if action='dispute' and length(trim(coalesce(payload->>'reason','')))<3 then raise exception 'Explain the disagreement'; end if;
   update matches set status=case when action='confirm' then 'confirmed' else 'disputed' end,dispute=case when action='dispute' then left(payload->>'reason',1000) else null end where id=m.id;
  else
   if length(trim(coalesce(payload->>'reason','')))<3 then raise exception 'Enter a reason for the organiser correction'; end if;
   -- A corrected upstream score invalidates all dependent bracket matches and choices.
   if m.stage='groups' then delete from matches where tournament_id=tid and stage in('semifinals','final');
   elsif m.stage='semifinals' then delete from matches where tournament_id=tid and stage='final'; end if;
   update tournaments set stage=m.stage where id=tid;
   update matches set score1=(payload->>'score1')::int,score2=(payload->>'score2')::int,status='confirmed',submitted_by=uid,dispute=null where id=m.id;
  end if;
 else raise exception 'Unknown action';
 end if;
 insert into audit_log(tournament_id,actor,action,details) values(tid,uid,action,jsonb_build_object('request',payload,'previous_match',old_result));
 return jsonb_build_object('id',result_id,'ok',true);
end $$;
revoke all on function public.tournament_action(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.tournament_action(uuid,text,jsonb) to authenticated;


