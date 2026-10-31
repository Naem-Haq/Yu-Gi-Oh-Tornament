import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {parseDeck} from '../src/domain.mjs';
import {exampleText} from '../src/demo.js';
const cards=JSON.parse(await readFile('public/cards.json','utf8'));
const ids=[...new Set(parseDeck(exampleText,cards).entries.map(e=>e.card_id))];
await mkdir('public/card-images',{recursive:true});
let count=0;
for(const id of ids){
 const path=`public/card-images/${id}.jpg`;
 try {await access(path);continue}catch{}
 const r=await fetch(`https://images.ygoprodeck.com/images/cards_small/${id}.jpg`);
 if(!r.ok)throw Error(`Image ${id}: HTTP ${r.status}`);
 await writeFile(path,new Uint8Array(await r.arrayBuffer()));count++;
 await new Promise(resolve=>setTimeout(resolve,250));
}
console.log(`Cached ${count} sample deck images locally (${ids.length} total).`);
