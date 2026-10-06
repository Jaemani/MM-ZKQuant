import React,{useState} from 'react';
import {formatUnits} from 'ethers';
export default function PrivatePositions({positions,nameOf,busy,onWithdraw,onCancel}) {
 const [percent,setPercent]=useState({});
 return <ul className="private-position-list">{positions.map(p=><li key={p.strategyId}>
 <strong>{nameOf(p.strategyId)}</strong><span>Investment value {formatUnits(p.value||'0',6)} AUSD</span><span>Waiting for next submission {formatUnits(p.pending||'0',6)} AUSD</span><span>Units {formatUnits(p.units,6)}  units · paid {formatUnits(p.paid||'0',6)} AUSD</span>
 <label>Units to redeem (%)<input type="number" min="1" max="100" step="1" value={percent[p.strategyId]||100} onChange={e=>setPercent({...percent,[p.strategyId]:e.target.value})}/></label>
 <button className="platform-text-button" disabled={busy||BigInt(p.units)===0n||(p.withdrawals||[]).some(w=>w.kind!=='PENDING'&&['REQUESTED','SETTLING'].includes(w.status))} onClick={()=>onWithdraw(p,Number(percent[p.strategyId]||100),false)}>Request investment redemption</button>
 <button className="platform-text-button" disabled={busy||BigInt(p.pending||'0')===0n||(p.withdrawals||[]).some(w=>w.kind==='PENDING'&&['REQUESTED','SETTLING'].includes(w.status))} onClick={()=>onWithdraw(p,100,true)}>Request return of all pending allocation</button>
 {(p.withdrawals||[]).map(w=><div key={w.id}><span>{w.kind==='PENDING'?"Pending allocation":"Invested units"}  redemption · {({REQUESTED:"Accepted",SETTLING:"Settling",PAID:"Paid",CANCELLED:"Cancelled"})[w.status]||w.status}</span><span>Scheduled settlement {new Date(w.settlementAt*1000).toLocaleString('en-US')}</span>{w.amount&&<span>{formatUnits(w.amount,6)} AUSD</span>}{w.error&&<p>Payment pending: {w.error}</p>}{w.txHash&&<a href={`https://testnet.monadscan.com/tx/${w.txHash}`} target="_blank" rel="noreferrer">View payment transaction</a>}{w.status==='REQUESTED'&&Date.now()<w.cutoffAt*1000&&<button className="platform-text-button" disabled={busy} onClick={()=>onCancel(p,w)}>Cancel redemption</button>}</div>)}
 </li>)}</ul>;
}
