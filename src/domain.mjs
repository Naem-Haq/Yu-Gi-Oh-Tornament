export const RULES = '3 points for a match win, 0 for a loss. Ties: game differential, then games won, then lowest published draw seed. Only confirmed results count. All matches are first to 2 game wins.';
export const normalize = value => value.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
export function parseDeck(text, cards) {
  const byName = new Map(cards.flatMap(c => [c.name, ...(c.aliases || [])].map(n => [normalize(n), c])));
  let section = null; const entries = []; const errors = [];
  if (text.length > 50000) return {entries, errors:['File is too large (maximum 50 KB).']};
  text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim(); if (!line) return;
    const heading = /^(main|extra|side) deck\s*:\s*$/i.exec(line);
    if (heading) {section = heading[1].toLowerCase(); return;}
    const match = /^(\d+)\s*[x×]\s+(.+)$/i.exec(line);
    if (!section || !match) { errors.push(`Line ${i+1}: use a Main Deck:, Extra Deck: or Side Deck: heading and entries like 2x Card Name.`); return; }
    const card = byName.get(normalize(match[2]));
    if (!card) {errors.push(`Line ${i+1}: “${match[2]}” is unknown or outside the July 2014 NAWCQ card pool.`); return;}
    entries.push({card_id:card.id, section, quantity:Number(match[1])});
  });
  return {entries, errors};
}
export function validateDeck(entries, cards) {
  const catalog = new Map(cards.map(c => [c.id,c])); const errors = []; const totals = {main:0,extra:0,side:0}; const copies = new Map();
  for (const e of entries) {
    const c = catalog.get(e.card_id);
    if (!c) {errors.push(`Unknown or ineligible card: ${e.card_id}.`); continue;}
    if (!Number.isInteger(e.quantity) || e.quantity < 1 || e.quantity > 3 || !(e.section in totals)) {errors.push(`Invalid entry for ${c.name}.`); continue;}
    totals[e.section] += e.quantity;
    if ((e.section === 'extra' && !c.extra) || (e.section === 'main' && c.extra)) errors.push(`${c.name} cannot go in the ${e.section} deck.`);
    const key = c.copy_key || c.name; const prev = copies.get(key) || {count:0,limit:3};
    copies.set(key,{count:prev.count+e.quantity,limit:Math.min(prev.limit,c.limit),name:key});
  }
  if (totals.main < 40 || totals.main > 60) errors.push(`Main Deck has ${totals.main} cards; it must have 40–60.`);
  for (const s of ['extra','side']) if (totals[s] > 15) errors.push(`${s === 'extra' ? 'Extra' : 'Side'} Deck has ${totals[s]} cards; maximum 15.`);
  for (const c of copies.values()) if (c.count > c.limit) errors.push(`${c.name}: ${c.count} copies across all sections; April 2014 limit is ${c.limit}${c.limit===0?' (Forbidden)':''}.`);
  return {errors,totals};
}
export function deckText(entries, cards) {
  const names = new Map(cards.map(c => [c.id,c.name]));
  return ['main','extra','side'].map(s => `${s[0].toUpperCase()+s.slice(1)} Deck:\n`+entries.filter(e=>e.section===s).map(e=>`${e.quantity}x ${names.get(e.card_id) || e.card_id}`).join('\n')).join('\n\n');
}
export function roundRobin(players, group='A', tableOffset=0) {
  const ring = [...players]; if (ring.length%2) ring.push(null); const fixtures=[];
  for(let r=1;r<ring.length;r++) {
    let table=tableOffset;
    for(let i=0;i<ring.length/2;i++) {
      const a=ring[i], b=ring[ring.length-1-i];
      if(a!==null && b!==null) fixtures.push({p1:a,p2:b,round:r,table_no:++table,group_name:group,stage:'groups'});
    }
    ring.splice(1,0,ring.pop());
  }
  return fixtures;
}
export function standings(players,matches) {
  return players.map(p=>{
    const row={...p,played:0,wins:0,losses:0,gf:0,ga:0,points:0,diff:0};
    for(const m of matches.filter(m=>m.stage==='groups'&&m.status==='confirmed'&&(m.p1===p.user_id||m.p2===p.user_id))) {
      const own=m.p1===p.user_id?m.score1:m.score2, opp=m.p1===p.user_id?m.score2:m.score1;
      row.played++; row.gf+=own; row.ga+=opp; if(own===2)row.wins++; else row.losses++;
    }
    row.points=row.wins*3; row.diff=row.gf-row.ga; return row;
  }).sort((a,b)=>b.points-a.points||b.diff-a.diff||b.gf-a.gf||a.seed-b.seed);
}
