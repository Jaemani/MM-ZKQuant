import React,{useState} from 'react';
import {formatUnits} from 'ethers';
export default function PrivatePositions({positions,nameOf,busy,onWithdraw,onCancel}) {
 const [percent,setPercent]=useState({});
 return <ul className="private-position-list">{positions.map(p=><li key={p.strategyId}>
 <strong>{nameOf(p.strategyId)}</strong><span>운용 평가액 {formatUnits(p.value||'0',6)} AUSD</span><span>다음 제출 대기 {formatUnits(p.pending||'0',6)} AUSD</span><span>지분 {formatUnits(p.units,6)} units · 지급 완료 {formatUnits(p.paid||'0',6)} AUSD</span>
 <label>출금할 운용 지분 (%)<input type="number" min="1" max="100" step="1" value={percent[p.strategyId]||100} onChange={e=>setPercent({...percent,[p.strategyId]:e.target.value})}/></label>
 <button className="platform-text-button" disabled={busy||BigInt(p.units)===0n||(p.withdrawals||[]).some(w=>w.kind!=='PENDING'&&['REQUESTED','SETTLING'].includes(w.status))} onClick={()=>onWithdraw(p,Number(percent[p.strategyId]||100),false)}>운용 지분 출금 요청</button>
 <button className="platform-text-button" disabled={busy||BigInt(p.pending||'0')===0n||(p.withdrawals||[]).some(w=>w.kind==='PENDING'&&['REQUESTED','SETTLING'].includes(w.status))} onClick={()=>onWithdraw(p,100,true)}>대기 자금 전액 출금 요청</button>
 {(p.withdrawals||[]).map(w=><div key={w.id}><span>{w.kind==='PENDING'?'대기 자금':'운용 지분'} 출금 · {({REQUESTED:'접수',SETTLING:'정산 중',PAID:'지급 완료',CANCELLED:'취소'})[w.status]||w.status}</span><span>정산 예정 {new Date(w.settlementAt*1000).toLocaleString('ko-KR')}</span>{w.amount&&<span>{formatUnits(w.amount,6)} AUSD</span>}{w.error&&<p>지급 대기: {w.error}</p>}{w.txHash&&<a href={`https://testnet.monadscan.com/tx/${w.txHash}`} target="_blank" rel="noreferrer">지급 거래 확인</a>}{w.status==='REQUESTED'&&Date.now()<w.cutoffAt*1000&&<button className="platform-text-button" disabled={busy} onClick={()=>onCancel(p,w)}>출금 취소</button>}</div>)}
 </li>)}</ul>;
}
