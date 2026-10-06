import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {buildPoseidon} from 'circomlibjs';
import {LEDGER_OP} from '../../deploy/tee/operator/ledger-journal.mjs';

export const LEDGER_CAPACITY={strategies:4096,investors:16,lots:64};
export const clone=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v));
const n=value=>BigInt(value||0),SCALE=10n**18n;
export const randomSalt=()=>BigInt('0x'+randomBytes(16).toString('hex'));
const bookKey=id=>BigInt('0x'+createHash('sha256').update(`VEILVEST_LEDGER_BOOK_V1:${id}`).digest('hex').slice(0,32));
export async function createLedgerWitness() {
 const poseidon=await buildPoseidon(),hash=values=>poseidon.F.toObject(poseidon(values.map(n)));
 const tree=leaves=>{const levels=[leaves.map(n)];while(levels.at(-1).length>1){const previous=levels.at(-1),next=[];for(let i=0;i<previous.length;i+=2)next.push(hash([previous[i],previous[i+1]]));levels.push(next);}return {root:levels.at(-1)[0],siblings:index=>levels.slice(0,-1).map((level,depth)=>level[(index>>depth)^1])};};
 const lotTree=lots=>tree(lots.map((lot,index)=>hash([index,...lot])));
 const emptyLots=Array.from({length:64},()=>['0','0']),emptyLotRoot=lotTree(emptyLots).root;
 const emptyAccount=()=>({row:['0','0','0','0','0','0',String(emptyLotRoot),'0','0'],lots:clone(emptyLots),lotMapping:{}});
 const blankBook=()=>({fields:['0','0','0','0','0',String(SCALE),'0'],accounts:Array.from({length:16},emptyAccount)});
 const accountRoot=mirror=>tree(mirror.accounts.map((account,index)=>hash([index,...account.row]))).root;
 const leaf=mirror=>hash([...mirror.fields,accountRoot(mirror)]);
 const emptyLeaf=leaf(blankBook());
 const globalTree=mirrors=>tree(Array.from({length:4096},(_,i)=>mirrors[i]?leaf(mirrors[i]):emptyLeaf));
 const commitment=(root,salt,chainId,vault)=>hash([chainId,BigInt(vault),root,salt]);
 const activeInvestors=snapshot=>Object.values(snapshot.investors).filter(p=>['pending','units','deposited','paid','fees'].some(field=>n(p[field])!==0n));
 function importBook(snapshot) {
  const mirror=blankBook();mirror.fields=[String(bookKey(snapshot.id)),String(snapshot.feeBps),snapshot.cash,snapshot.equity,snapshot.totalUnits,snapshot.nav,snapshot.feesDue];
  const investors=activeInvestors(snapshot);if(investors.length>16)throw Error('LEDGER_INVESTOR_CAPACITY');
  for(const [index,p]of investors.entries()){
   const account=mirror.accounts[index];account.row=[String(BigInt(p.wallet)),p.pending,p.units,p.deposited,p.paid,p.fees,'0','0','0'];
   let slot=0;for(const [actual,lot]of p.lots.entries())if(n(lot.units)>0n){if(slot>=64)throw Error('LEDGER_LOT_CAPACITY');account.lotMapping[actual]=slot;account.lots[slot++]=[lot.units,lot.hwm];}
   account.row[6]=String(lotTree(account.lots).root);
   assert.equal(account.lots.reduce((sum,lot)=>sum+n(lot[0]),0n),n(p.units),'LEDGER_LOT_UNITS_MISMATCH');
  }
  assert.equal(mirror.accounts.reduce((sum,a)=>sum+n(a.row[2]),0n),n(snapshot.totalUnits),'LEDGER_TOTAL_UNITS_MISMATCH');
  return mirror;
 }
 function checkBounds(mirror) {
  for(const [i,v]of mirror.fields.entries()){const bound=i===0?160:i===1?14:96;assert.ok(n(v)>=0n&&n(v)<(1n<<BigInt(bound)),'LEDGER_RANGE');}
  assert.ok(n(mirror.fields[1])<=2000n,'LEDGER_FEE_CAP');
  for(const account of mirror.accounts){for(const [i,v]of account.row.entries())if(i!==6)assert.ok(n(v)>=0n&&n(v)<(1n<<BigInt(i===0?160:96)),'LEDGER_ACCOUNT_RANGE');for(const lot of account.lots)for(const v of lot)assert.ok(n(v)>=0n&&n(v)<(1n<<96n),'LEDGER_LOT_RANGE');}
  assert.equal(mirror.accounts.reduce((sum,a)=>sum+n(a.row[2]),0n),n(mirror.fields[4]),'LEDGER_TOTAL_UNITS_MISMATCH');
 }
 function applyEvent(mirror,event) {
  const kind=LEDGER_OP[event.kind];assert.ok(kind!==undefined,'LEDGER_UNKNOWN_OPERATION');
  let index=0;
  if(event.wallet){const wallet=String(BigInt(event.wallet));index=mirror.accounts.findIndex(a=>a.row[0]===wallet);if(index<0&&kind===LEDGER_OP.DEPOSIT)index=mirror.accounts.findIndex(a=>a.row[0]==='0');if(index<0)throw Error('LEDGER_INVESTOR_CAPACITY');}
  const account=mirror.accounts[index],b=mirror.fields.map(n),r=account.row.map(n);
  const ev=[BigInt(kind),BigInt(index),event.wallet?BigInt(event.wallet):0n,n(event.amount),n(event.units),0n,0n,n(event.feeBps),n(event.requested)];
  let lotIndex=0,lotBefore=[0n,0n],siblings=Array(6).fill(0n);
  const lotOperation=['MINT','FEE','BURN'].includes(event.kind);
  if(lotOperation){
   let slot=account.lotMapping[event.lot];
   if(slot===undefined&&kind===LEDGER_OP.MINT){slot=account.lots.findIndex(lot=>n(lot[0])===0n);if(slot<0)throw Error('LEDGER_LOT_CAPACITY');for(const [key,value]of Object.entries(account.lotMapping))if(value===slot)delete account.lotMapping[key];account.lotMapping[event.lot]=slot;}
   if(slot===undefined)throw Error('LEDGER_LOT_NOT_FOUND');lotIndex=slot;lotBefore=account.lots[slot].map(n);siblings=lotTree(account.lots).siblings(slot);
  }
  if(kind===LEDGER_OP.DEPOSIT){if(r[0]!==0n)assert.equal(r[0],ev[2],'LEDGER_WALLET_MISMATCH');r[0]=ev[2];r[1]+=ev[3];r[3]+=ev[3];}
  if(kind===LEDGER_OP.MINT){assert.equal(lotBefore[0],0n,'LEDGER_MINT_NONEMPTY_LOT');assert.equal(ev[4],ev[3]*SCALE/b[5],'LEDGER_MINT_ROUNDING');r[1]-=ev[3];r[2]+=ev[4];b[2]+=ev[3];b[3]+=ev[3];b[4]+=ev[4];account.lots[lotIndex]=[String(ev[4]),String(b[5])];}
  if(kind===LEDGER_OP.FEE){const cost=n(event.cost);ev[5]=cost<0n?-cost:cost;ev[6]=cost<0n?1n:0n;assert.ok(b[5]>lotBefore[1],'LEDGER_HWM_RECOVERY');const gain=lotBefore[0]*(b[5]-lotBefore[1])/SCALE,profit=gain>cost?gain-cost:0n,burn=profit*b[1]/10000n*SCALE/b[5],fee=burn*b[5]/SCALE;assert.equal(ev[4],burn,'LEDGER_FEE_BURN');assert.equal(ev[3],fee,'LEDGER_FEE_AMOUNT');r[2]-=burn;r[5]+=fee;b[3]-=fee;b[4]-=burn;b[6]+=fee;account.lots[lotIndex]=[String(lotBefore[0]-burn),String(b[5])];}
  if(kind===LEDGER_OP.BURN){ev[6]=event.remainder?1n:0n;assert.ok(r[8]===0n||r[8]===ev[8],'LEDGER_REDEMPTION_GOAL');const remaining=ev[8]-r[7],take=event.remainder?(lotBefore[0]<remaining?lotBefore[0]:remaining):lotBefore[0]*ev[8]/(r[2]+r[7]);assert.equal(ev[4],take,'LEDGER_BURN_ROUNDING');r[2]-=take;r[7]+=take;r[8]=ev[8];b[4]-=take;account.lots[lotIndex]=[String(lotBefore[0]-take),String(lotBefore[1])];}
  if(kind===LEDGER_OP.PAY){assert.equal(r[7],ev[8],'LEDGER_REDEMPTION_CREDIT');assert.equal(r[8],ev[8],'LEDGER_REDEMPTION_GOAL');r[4]+=ev[3];r[7]=0n;r[8]=0n;assert.ok(b[2]-ev[3]>=b[6],'LEDGER_WITHDRAWAL_ACCOUNTING');b[2]-=ev[3];b[3]-=ev[3];if(b[4])b[5]=b[3]*SCALE/b[4];else if(ev[8])b[5]=ev[3]*SCALE/ev[8];}
  if(kind===LEDGER_OP.PENDING_PAY){r[1]-=ev[3];r[4]+=ev[3];}
  if(kind===LEDGER_OP.VENUE){const delta=n(event.delta);ev[3]=delta<0n?-delta:delta;ev[6]=delta<0n?1n:0n;b[2]+=delta;}
  if(kind===LEDGER_OP.MARK){ev[3]=n(event.basis);ev[5]=n(event.equity);b[3]=ev[5];if(b[4])b[5]=ev[3]*SCALE/b[4];}
  if(kind===LEDGER_OP.FEE_PAY){b[2]-=ev[3];b[6]-=ev[3];}
  if(kind===LEDGER_OP.POLICY)b[1]=ev[7];
  if(kind===LEDGER_OP.VALUE){ev[3]=n(event.equity);b[3]=ev[3];}
  if(kind===LEDGER_OP.REGISTER){assert.equal(b[0],0n,'LEDGER_ALREADY_REGISTERED');ev[2]=bookKey(event.id);b[0]=ev[2];b[1]=ev[7];}
  if(lotOperation)r[6]=lotTree(account.lots).root;
  account.row=r.map(String);mirror.fields=b.map(String);checkBounds(mirror);
  return {ev,lotIndex,lotBefore,siblings};
 }
 function transition({mirrors,bookIndex,event,salt,sequence,checkpointAt,chainId=10143,vault}) {
  const before=clone(mirrors[bookIndex]),next=clone(mirrors),global=globalTree(mirrors),oldRoot=commitment(global.root,salt,chainId,vault);
  const applied=applyEvent(next[bookIndex],event),newSalt=randomSalt(),eventSalt=randomSalt();
  const eventsRoot=hash([eventSalt,hash([...applied.ev,applied.lotIndex,hash([applied.lotIndex,...applied.lotBefore])])]);
  const newRoot=commitment(globalTree(next).root,newSalt,chainId,vault);
  const witness={pub:[chainId,BigInt(vault),sequence,checkpointAt,oldRoot,newRoot,eventsRoot],beforeBook:before.fields,beforeRows:before.accounts.map(a=>a.row),events:[applied.ev],lotBefore:[applied.lotBefore],lotIndex:[applied.lotIndex],lotSiblings:[applied.siblings],bookIndex,bookSiblings:global.siblings(bookIndex),oldSalt:salt,newSalt,eventSalt};
  return clone({witness,next,salt:String(newSalt),oldRoot:String(oldRoot),newRoot:String(newRoot)});
 }
 function assertMatches(snapshot,mirror) {
  const actual=importBook(snapshot);assert.deepEqual(mirror.fields,actual.fields,'LEDGER_SNAPSHOT_BOOK_MISMATCH');
  for(const account of mirror.accounts)if(n(account.row[0])){
   const wallet='0x'+n(account.row[0]).toString(16).padStart(40,'0'),p=snapshot.investors[wallet.toLowerCase()];assert.ok(p,'LEDGER_SNAPSHOT_OWNER_MISMATCH');
   assert.deepEqual(account.row.slice(1,6),[p.pending,p.units,p.deposited,p.paid,p.fees],'LEDGER_SNAPSHOT_ACCOUNT_MISMATCH');assert.equal(account.row[7],'0','LEDGER_UNFINISHED_REDEMPTION');assert.equal(account.row[8],'0','LEDGER_UNFINISHED_REDEMPTION');
   const expected=p.lots.flatMap((lot,index)=>n(lot.units)?[[index,lot.units,lot.hwm]]:[]);
   const observed=Object.entries(account.lotMapping).flatMap(([index,slot])=>n(account.lots[slot][0])?[[Number(index),...account.lots[slot]]]:[]);
   assert.deepEqual(observed.sort((a,b)=>a[0]-b[0]),expected,'LEDGER_SNAPSHOT_LOT_MISMATCH');
  }
  assert.equal(mirror.accounts.filter(a=>n(a.row[0])).length,activeInvestors(snapshot).length,'LEDGER_SNAPSHOT_INVESTOR_MISMATCH');
 }
 return {hash,blankBook,importBook,globalTree,commitment,transition,assertMatches,applyEvent,checkBounds};
}
