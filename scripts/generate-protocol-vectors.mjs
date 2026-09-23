// Explicit maintenance command only. Tests never rewrite expected results.
import { writeFileSync } from 'node:fs';
import { FIELD, DOMAIN_NAMES, SCHEMAS } from '../protocol/ts/encoding.mts';
import { vectorRunner } from '../protocol/ts/vector-runner.mts';
const vectors=[];
const add=(id,v)=>vectors.push({id,...v});
for(const [type,bits,signed] of [['u64',64,false],['qty',63,true],['price',96,false],['amount',128,true],['bps',16,false],['address',160,false],['bool',1,false],['bytes32',256,false]]) {
  const b=1n<<BigInt(bits);
  for(const value of new Set([0n,1n,-1n,b-1n,b,-b+1n,-b])) add(`${type}:${value}`,{op:'encode',type,value:value.toString()});
}
for(const value of ['-1','0',(FIELD-1n).toString(),FIELD.toString(),(FIELD+1n).toString(),'01','-0','1e3','1.0']) add(`hash:${value}`,{op:'encode',type:'hash',value});
for(const type of ['side','tif','authMode','snapCause','leaseOp']) for(const value of ['-1','0','1','2','3','4','5']) add(`${type}:${value}`,{op:'encode',type,value});
for(const name of DOMAIN_NAMES) add(`domain:${name}`,{op:'domain',name});
for(const [name,schema] of Object.entries(SCHEMAS)) {
  const values=schema.map((type,i)=> type==='bool'||type==='authMode'?'0':type==='tif'||type==='leaseOp'||type==='snapCause'?'1':type==='qty'?'-17':String(i+11));
  add(`formula:${name}`,{op:'hash',name,values});
  add(`arity:${name}`,{op:'hash',name,values:values.slice(1)});
}
const intent={op:'intent',header:['10143','7','1','2','3','50','1','1800000000'],targets:[['1','100'],['2','-42']],salt:'12345'};
add('intent:two markets',intent);
add('intent:max targets',{...intent,targets:Array.from({length:7},(_,i)=>[String(i+1),String(i-3)])});
add('intent:too many',{...intent,targets:Array.from({length:8},(_,i)=>[String(i),'1'])});
add('intent:duplicate market',{...intent,targets:[['1','1'],['1','-1']]});
add('intent:no targets',{...intent,targets:[]});
const note={op:'note',header:['7','4','3','1','42','1','0','10000','2','0','0'],slots:[['123','1','1','100','8'],['124','2','1','-42','9']],anchor:['321','1700000000','10000'],secret:'123456'};
add('note:two slots',note);
add('note:empty',{...note,header:note.header.map((x,i)=>i===8?'0':x),slots:[]});
add('note:max slots',{...note,header:note.header.map((x,i)=>i===8?'16':x),slots:Array.from({length:16},(_,i)=>['123',String(i+1),'1',String(i-8),'9'])});
add('note:count mismatch',{...note,slots:[]});
add('note:duplicate market',{...note,slots:[note.slots[0],note.slots[0]]});
for(const [target,position,open] of [['0','100','0'],['-1','100','0'],['0','100','1'],['9223372036854775807','-1','0']]) add(`delta:${target}:${position}:${open}`,{op:'delta',target,position,open});
for(let p=-10;p<=10;p++) for(const d of [-11,-1,0,1,11]) add(`reduction:${p}:${d}`,{op:'reduction',position:String(p),delta:String(d)});
for(const bps of ['0','3333','3334','10000','10001']) add(`minimum:${bps}`,{op:'minimumReduction',position:'-3',bps});
for(const available of ['69','70','71','-1']) add(`capital:${available}`,{op:'custodyDraw',margin:'100',credit:'30',available});
for(const margin of ['-100','0','20']) add(`margin:${margin}`,{op:'custodyDraw',margin,credit:'30',available:'0'});
for(const position of [['3','101','1','100'],['-3','101','1','100'],['1','1','1','0'],['9223372036854775807','79228162514264337593543950335','1000000000000','1']]) add(`notional:${position.join(':')}`,{op:'notional',position});
for(const equity of ['-1','0','3','4','5']) for(const haircut of ['0','1','1000']) add(`leverage:${equity}:${haircut}`,{op:'leverage',positions:[['3','101','1','100']],equity,haircut,limit:'10000'});
const run=await vectorRunner();
writeFileSync('protocol/vectors/draft-v0.1.json',JSON.stringify({version:'development-v0.1-draft',scope:'Encoding formulas and foundational arithmetic; not transition/proof acceptance',vectors:vectors.map(v=>({...v,expected:run(v)}))},null,2)+'\n');
console.log(JSON.stringify({vectors:vectors.length}));
