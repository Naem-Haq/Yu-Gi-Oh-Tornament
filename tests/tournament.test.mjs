import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {parseDeck,validateDeck,roundRobin,standings,deckText} from '../src/domain.mjs';
import {exampleText} from '../src/demo.js';
const cards=JSON.parse(await readFile('public/cards.json','utf8'));
const parsed=parseDeck(exampleText,cards);
test('example parses, validates, and round-trips',()=>{assert.deepEqual(parsed.errors,[]);assert.deepEqual(validateDeck(parsed.entries,cards),{errors:[],totals:{main:40,extra:15,side:15}});assert.deepEqual(parseDeck(deckText(parsed.entries,cards),cards).entries,parsed.entries)});
test('rejects unknown cards, malformed lines, wrong sections, copy limits and modern cards',()=>{
 assert.ok(parseDeck('Main Deck:\n1x Ash Blossom & Joyous Spring',cards).errors.length);
 assert.ok(parseDeck('3 Card Name',cards).errors.length);
 const pot=cards.find(c=>c.name==='Pot of Greed'); assert.equal(pot.limit,0);
 assert.ok(validateDeck([...parsed.entries,{card_id:pot.id,quantity:1,section:'side'}],cards).errors.some(x=>x.includes('Forbidden')));
 const book=cards.find(c=>c.name==='Book of Moon');assert.ok(validateDeck([...parsed.entries,{card_id:book.id,quantity:1,section:'side'}],cards).errors.some(x=>x.includes('limit is 1')));
 const extra=cards.find(c=>c.extra);assert.ok(validateDeck([{card_id:extra.id,quantity:1,section:'main'}],cards).errors.some(x=>x.includes('cannot go')));
 const harpies=cards.filter(c=>c.copy_key==='Harpie Lady');assert.ok(harpies.length>=3);assert.ok(validateDeck(harpies.slice(0,2).map(c=>({card_id:c.id,quantity:3,section:'main'})),cards).errors.some(x=>x.includes('6 copies')));
});
test('round robin: every pair once, no double booking for 3–6 players',()=>{for(let n=3;n<=6;n++){const players=Array.from({length:n},(_,i)=>i);const ms=roundRobin(players);assert.equal(ms.length,n*(n-1)/2);assert.equal(new Set(ms.map(m=>[m.p1,m.p2].sort().join('-'))).size,ms.length);for(const r of new Set(ms.map(m=>m.round))){const ids=ms.filter(m=>m.round===r).flatMap(m=>[m.p1,m.p2]);assert.equal(new Set(ids).size,ids.length)}}});
test('standings ignore pending/disputed scores and use published tiebreaks',()=>{const ps=[{user_id:'a',seed:2},{user_id:'b',seed:1}];assert.equal(standings(ps,[{stage:'groups',status:'pending',p1:'a',p2:'b',score1:2,score2:0}])[0].user_id,'b');const rows=standings(ps,[{stage:'groups',status:'confirmed',p1:'a',p2:'b',score1:2,score2:1}]);assert.equal(rows[0].points,3);assert.equal(rows[0].diff,1);assert.equal(rows[1].losses,1)});

test('PostgreSQL permissions, deck validation, all draws, reporting and bracket correction',async t=>{
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
 await db.exec(await readFile('supabase/migrations/001_schema.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/002_card_catalog.sql','utf8'));
 const ids=Array.from({length:14},(_,i)=>`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`), admin=ids[13];
 for(const id of ids)await db.query('insert into auth.users values($1)',[id]);
 await db.query('insert into organizers values($1)',[admin]);
 async function as(id,sql,params=[]){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role authenticated');return db.query(sql,params)}
 async function act(id,tid,action,payload={}){return (await as(id,'select tournament_action($1,$2,$3) result',[tid,action,JSON.stringify(payload)])).rows[0].result}
 const create=async()=> (await act(admin,null,'create',{name:'Test HAT',deadline:'2099-01-01T00:00:00Z'})).id;
 const deckPayload={name:'HAT',entries:parsed.entries};
 const tid=await create();
 await assert.rejects(act(ids[0],null,'create',{name:'no',deadline:'2099-01-01'}),/Organiser/);
 await assert.rejects(act(null,tid,'register',{name:'no'}),/Sign in/);
 for(let i=0;i<4;i++)await act(ids[i],tid,'register',{name:`Player ${i}`});
 await assert.rejects(act(admin,tid,'start'),/Every player/);
 let d0;for(let i=0;i<4;i++){const d=await act(ids[i],tid,'save_deck',deckPayload);if(i===0)d0=d.id;}
 await t.test('RLS hides opponents and blocks direct writes or role escalation',async()=>{
  assert.equal((await as(ids[0],'select * from decks')).rows.length,1);
  assert.equal((await as(admin,'select * from decks')).rows.length,4);
  assert.equal((await as(ids[0],'select * from organizers')).rows.length,0);
  assert.equal((await as(ids[0],'select * from audit_log')).rows.length,0);
  await assert.rejects(as(ids[0],'insert into organizers values($1)',[ids[0]]),/permission denied/);
  await assert.rejects(as(ids[0],"update decks set name='hacked'"),/permission denied/);
  await assert.rejects(as(ids[0],"update matches set score1=2"),/permission denied/);
  await assert.rejects(act(ids[1],tid,'save_deck',{...deckPayload,id:d0}),/not yours/);
 });
 await t.test('server rejects forged cards, totals and extra copies; enforces maximum 3 decks',async()=>{
  await assert.rejects(act(ids[0],tid,'save_deck',{name:'bad',entries:[...parsed.entries,{card_id:999999999,quantity:1,section:'side'}]}),/outside/);
  await assert.rejects(act(ids[0],tid,'save_deck',{name:'bad',entries:[]}),/Deck sizes/);
  await assert.rejects(act(ids[0],tid,'save_deck',{name:'bad',entries:[...parsed.entries,{card_id:cards.find(c=>c.name==='Book of Moon').id,quantity:1,section:'side'}]}),/Deck sizes|limit/);
  await act(ids[0],tid,'save_deck',deckPayload);await act(ids[0],tid,'save_deck',deckPayload);await assert.rejects(act(ids[0],tid,'save_deck',deckPayload),/Maximum three/);
  await act(admin,tid,'lock');await assert.rejects(act(ids[0],tid,'save_deck',{...deckPayload,id:d0}),/locked/);await act(admin,tid,'unlock');
 });
 await act(admin,tid,'start');
 await assert.rejects(act(ids[0],tid,'delete_deck',{id:d0}),/locked/);
 await assert.rejects(act(admin,tid,'unlock'),/stay locked/);
 const match=(await as(admin,'select * from matches where tournament_id=$1 order by round,table_no',[tid])).rows[0];
 await t.test('result state machine and deck commitment are enforced',async()=>{
  await assert.rejects(act(match.p1,tid,'submit',{match_id:match.id,score1:2,score2:0}),/commit a deck/);
  for(const id of [match.p1,match.p2]){const d=(await as(id,'select id from decks where tournament_id=$1',[tid])).rows[0];await act(id,tid,'choose_deck',{match_id:match.id,deck_id:d.id});await assert.rejects(act(id,tid,'choose_deck',{match_id:match.id,deck_id:d.id}),/already committed/)}
  assert.equal((await as(match.p1,'select * from deck_choices where match_id=$1',[match.id])).rows.length,1);
  await assert.rejects(act(ids[12],tid,'submit',{match_id:match.id,score1:2,score2:0}),/not your fixture/);
  await assert.rejects(act(match.p1,tid,'submit',{match_id:match.id,score1:1,score2:1}),/check constraint/);
  await act(match.p1,tid,'submit',{match_id:match.id,score1:2,score2:1});
  assert.equal((await as(match.p1,'select points from standings where tournament_id=$1 and user_id=$2',[tid,match.p1])).rows[0].points,0);
  await assert.rejects(act(match.p1,tid,'confirm',{match_id:match.id}),/Only the opponent/);
  await act(match.p2,tid,'dispute',{match_id:match.id,reason:'Wrong score'});
  await assert.rejects(act(match.p2,tid,'confirm',{match_id:match.id}),/Only the opponent/);
  await act(admin,tid,'override',{match_id:match.id,score1:2,score2:0,reason:'Resolved with both players'});
  assert.equal((await as(match.p1,'select points from standings where tournament_id=$1 and user_id=$2',[tid,match.p1])).rows[0].points,3);
  await assert.rejects(act(admin,tid,'advance'),/Confirm every result/);
  const other=(await as(admin,'select * from matches where tournament_id=$1 and id<>$2 limit 1',[tid,match.id])).rows[0];
  for(const id of [other.p1,other.p2]){const d=(await as(id,'select id from decks where tournament_id=$1',[tid])).rows[0];await act(id,tid,'choose_deck',{match_id:other.id,deck_id:d.id})}
  await act(other.p2,tid,'submit',{match_id:other.id,score1:1,score2:2});
  await act(other.p1,tid,'confirm',{match_id:other.id});
  assert.equal((await as(other.p1,'select status from matches where id=$1',[other.id])).rows[0].status,'confirmed');
  await assert.rejects(act(other.p1,tid,'confirm',{match_id:other.id}),/Only the opponent/);
 });
 await t.test('deadline is enforced in PostgreSQL and anonymous access is denied',async()=>{
  const id=await create();await act(ids[0],id,'register',{name:'Deadline test'});const deck=await act(ids[0],id,'save_deck',deckPayload);
  await db.exec('reset role');await db.query("update tournaments set deadline='2000-01-01' where id=$1",[id]);
  await assert.rejects(act(ids[0],id,'save_deck',{...deckPayload,id:deck.id}),/locked/);
  await assert.rejects(act(ids[0],id,'delete_deck',{id:deck.id}),/locked/);
  await assert.rejects(act(ids[1],id,'register',{name:'late'}),/closed/);
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query('select * from decks'),/permission denied/);
  await assert.rejects(db.query("select tournament_action($1,'register','{}')",[id]),/permission denied/);
 });
 await t.test('all player counts generate balanced groups, unique pairs and conflict-free tables',async()=>{
  for(let n=4;n<=12;n++){
   const id=await create();for(let i=0;i<n;i++){await act(ids[i],id,'register',{name:`P${i}`});await act(ids[i],id,'save_deck',deckPayload)}
   if(n===12)await assert.rejects(act(ids[12],id,'register',{name:'13th'}),/full/);
   await act(admin,id,'start');await assert.rejects(act(admin,id,'start'),/already/);
   const ps=(await as(admin,'select * from registrations where tournament_id=$1',[id])).rows,ms=(await as(admin,'select * from matches where tournament_id=$1',[id])).rows;
   const a=ps.filter(p=>p.group_name==='A').length,b=ps.filter(p=>p.group_name==='B').length;
   assert.equal(a,n<=5?n:Math.ceil(n/2));assert.equal(b,n<=5?0:Math.floor(n/2));assert.equal(ms.length,a*(a-1)/2+b*(b-1)/2);
   assert.equal(new Set(ms.map(m=>[m.p1,m.p2].sort().join(':'))).size,ms.length);
   for(const r of new Set(ms.map(m=>m.round))){const rr=ms.filter(m=>m.round===r),players=rr.flatMap(m=>[m.p1,m.p2]);assert.equal(new Set(players).size,players.length);assert.equal(new Set(rr.map(m=>m.table_no)).size,rr.length)}
   for(const m of ms)await act(admin,id,'override',{match_id:m.id,score1:2,score2:1,reason:'Test result'});
   await act(admin,id,'advance');const ss=(await as(admin,'select * from standings where tournament_id=$1 order by group_name,points desc,diff desc,gf desc,seed',[id])).rows,aa=ss.filter(p=>p.group_name==='A'),bb=ss.filter(p=>p.group_name==='B');
   const semis=(await as(admin,"select * from matches where tournament_id=$1 and stage='semifinals' order by table_no",[id])).rows;
   assert.equal(semis[0].p1,aa[0].user_id);assert.equal(semis[0].p2,n<=5?aa[3].user_id:bb[1].user_id);assert.equal(semis[1].p1,n<=5?aa[1].user_id:bb[0].user_id);assert.equal(semis[1].p2,n<=5?aa[2].user_id:aa[1].user_id);
   for(const m of semis)await act(admin,id,'override',{match_id:m.id,score1:2,score2:0,reason:'Test result'});await act(admin,id,'advance');
   const final=(await as(admin,"select * from matches where tournament_id=$1 and stage='final'",[id])).rows[0];assert.equal(final.p1,semis[0].p1);assert.equal(final.p2,semis[1].p1);
   await act(admin,id,'override',{match_id:final.id,score1:2,score2:1,reason:'Final result'});await act(admin,id,'advance');assert.equal((await as(admin,'select stage from tournaments where id=$1',[id])).rows[0].stage,'complete');
   await act(admin,id,'override',{match_id:ms[0].id,score1:0,score2:2,reason:'Correct upstream result'});assert.equal((await as(admin,"select count(*)::int n from matches where tournament_id=$1 and stage<>'groups'",[id])).rows[0].n,0);
  }
 });
 await db.close();
});
