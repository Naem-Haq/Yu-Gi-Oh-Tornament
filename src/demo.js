import {roundRobin} from './domain.mjs';
const names=['Naem','Yugi','Kaiba','Joey','Mai','Yusei','Aki','Jaden'];
export const demoPlayers=names.map((display_name,i)=>({user_id:`demo-${i}`,display_name,seed:i+1,group_name:i%2?'B':'A'}));
export const demoMatches=['A','B'].flatMap((g,i)=>roundRobin(demoPlayers.filter(p=>p.group_name===g).map(p=>p.user_id),g,i*2)).map((m,i)=>({...m,id:`match-${i}`,status:m.round===1?'confirmed':'scheduled',score1:m.round===1?2:null,score2:m.round===1?i%2:null}));
export const demoTournament={id:'demo',name:'HAT Championship',stage:'groups',deadline:'2026-11-07T19:00:00Z',decks_locked:true};
export const exampleText=`Main Deck:
3x Artifact Moralltach
2x Artifact Beagalltach
3x Traptrix Myrmeleo
2x Traptrix Dionaea
3x Fire Hand
3x Ice Hand
3x Artifact Sanctum
3x Artifact Ignition
3x Mystical Space Typhoon
3x Pot of Duality
2x Forbidden Lance
2x Call of the Haunted
2x Dimensional Prison
2x Mirror Force
1x Bottomless Trap Hole
1x Torrential Tribute
1x Solemn Warning
1x Book of Moon

Extra Deck:
2x Artifact Durendal
1x Number 101: Silent Honor ARK
1x Evilswarm Exciton Knight
1x Abyss Dweller
1x Gagaga Cowboy
1x Number 50: Blackship of Corn
1x Diamond Dire Wolf
1x Maestroke the Symphony Djinn
1x Number 80: Rhapsody in Berserk
1x Constellar Pleiades
1x Constellar Ptolemy M7
1x Wind-Up Arsenal Zenmaioh
1x Gaia Dragon, the Thunder Charger
1x Number 61: Volcasaurus

Side Deck:
3x D.D. Crow
3x Effect Veiler
3x Maxx "C"
3x Debunk
3x Black Horn of Heaven`;
