import React,{useEffect,useState} from 'react';
const usd=value=>(Number(value||0)/1e18).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4});
const hash=value=>value?`${value.slice(0,10)}…${value.slice(-8)}`:'없음';
function download(value){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));a.download='pilot-evidence.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
export default function Pilot(){
  const [state,setState]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function load(){const r=await fetch('/api/pilot/status');const s=await r.json();if(!r.ok)throw new Error(s.error);setState(s);}
  useEffect(()=>{load().catch(e=>setError(e.message));},[]);
  async function action(fn){setBusy(true);setError('');try{await fn();await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
  const local=state?.localEvidence,real=state?.epochs.filter(e=>e.status==='SETTLED').map(e=>e.evidence||e)||[];
  const rows=real.length?real:local?.epochs||[];
  return <section className="pilot-review">
    <div className="card"><div className="card-heading"><div><h2>운용 증거 검토</h2><p>제출 → 사전 기록 → 실제 토큰 이동 → 정산 → 지급을 한 Epoch로 확인합니다.</p></div><button className="secondary" disabled={busy} onClick={()=>action(load)}>증거 새로고침</button></div>
      {error&&<p role="alert" className="negative">{error}</p>}
      <p><strong>{state?.verification?.productVerdict||'외부 실행 증거 대기'}</strong> · TEE 제외 · 현재 표시: {real.length?'Monad testnet 기록':'로컬 EVM 계약 실행'}</p>
      <p>로컬 실행에서는 ERC-20 잔고·교환·환매·지급이 계약으로 처리됩니다. 공개 테스트넷의 확정 기록과 실제 독립 참여자 기록이 있어야 제품 완료로 판정합니다.</p>
      <div className="pilot-actions"><button className="secondary" disabled={busy} onClick={()=>action(async()=>{const r=await fetch('/api/pilot/market',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const s=await r.json();if(!r.ok)throw new Error(s.error);})}>Kraken 원자료 수집</button><button className="secondary" onClick={()=>action(async()=>{const r=await fetch('/api/pilot/evidence');download(await r.json());})}>{state?.deployment?'외부 증거 JSON':'로컬 증거 JSON'}</button></div>
      {state?.deployment&&<p>Monad 테스트넷 펀드: <a href={`https://testnet.monadvision.com/address/${state.deployment.fund}`} target="_blank" rel="noreferrer">{state.deployment.fund}</a><br/>테스트 자본 예치: <a href={`https://testnet.monadvision.com/tx/${state.deployment.deposit.transactionHash}`} target="_blank" rel="noreferrer">{hash(state.deployment.deposit.transactionHash)}</a> · 독립 제공자 운용 기록과 별도로 확인합니다.</p>}
    </div>
    <div className="card"><div className="card-heading"><div><h2>연결 상태</h2><p>없는 근거를 모의 값으로 채우지 않습니다.</p></div></div>
      <dl className="pilot-status"><dt>가격 원자료</dt><dd>{state?.market?`${state.market.source} · ${new Date(state.market.boundary*1000).toLocaleString('ko-KR')}`:'아직 수집하지 않음'}</dd><dt>승인된 독립 참여자</dt><dd>{state?.actors.filter(a=>a.admissionKind==='HUMAN_REVIEWED').length||0} / 최소 3명 · 승인 대기 {state?.pendingRequests.length||0}명</dd><dt>외부 테스트넷 Epoch</dt><dd>{real.length} / 최소 연속 2회</dd><dt>테스트넷 가스 주소</dt><dd className="pilot-mono">{state?.wallet?.address||'pilot init 필요'}</dd><dt>로컬 자산 보존</dt><dd>{local?.tokenConservation?'전체 토큰 공급량 = 계정별 잔고 합계 확인':'미검증'}</dd><dt>로컬 환매 수령액</dt><dd>{local?`${usd(local.redemption.cashReceived)} tUSD`:'미검증'}</dd></dl>
      {state?.verification&&<table className="pilot-table"><thead><tr><th>최종 제품 조건</th><th>판정</th></tr></thead><tbody>{state.verification.gates.map(g=><tr key={g.id}><td>{g.name}</td><td>{g.pass===null?'TEE 제외':g.pass?'PASS':'외부 증거 필요'}</td></tr>)}</tbody></table>}
      {state?.market&&<table className="pilot-table"><thead><tr><th>자산</th><th>종가 USD</th><th>원자료</th></tr></thead><tbody>{state.market.observations.map(o=><tr key={o.asset}><td>{o.asset}</td><td>{o.price}{o.zeroVolume?' · 거래량 0, 이월 가격':''}</td><td><a href={o.url} target="_blank" rel="noreferrer">{hash(o.rawSha256)}</a></td></tr>)}</tbody></table>}
    </div>
    {rows.map(e=><div className="card" key={e.id}><div className="card-heading"><div><h2>Epoch {e.sequence} · {real.length?'MONAD_TESTNET':'LOCAL_EVM'}</h2><p className="pilot-mono">{e.id}</p></div></div>
      <table className="pilot-table"><thead><tr><th>대조 항목</th><th>기록</th></tr></thead><tbody><tr><td>Commit transaction</td><td className="pilot-mono">{real.length?<a href={`https://testnet.monadvision.com/tx/${e.chain?.commit?.transactionHash}`} target="_blank" rel="noreferrer">{hash(e.chain?.commit?.transactionHash)}</a>:hash(e.chain?.commit?.transactionHash)}</td></tr><tr><td>실현 손익</td><td>{usd(e.evaluation.realizedPnl)} tUSD</td></tr><tr><td>고점 대비 이익의 보상 한도</td><td>{usd(e.evaluation.feePool)} tUSD</td></tr><tr><td>실제 지급 합계</td><td>{usd(Object.values(e.evaluation.allocations).reduce((n,a)=>n+BigInt(a),0n))} tUSD</td></tr><tr><td>지급 transaction</td><td className="pilot-mono">{hash(e.chain?.payout?.transactionHash)}</td></tr></tbody></table>
      <details><summary>운영자별 기여도·지급·다음 가중치 원자료</summary><pre>{JSON.stringify({predictionAndStandalone:e.evaluation.providerQuality,attribution:e.evaluation.referenceAttribution,payments:e.evaluation.allocations,nextWeights:e.evaluation.nextWeights},null,2)}</pre></details>
    </div>)}
    <div className="card"><h2>직접 실행</h2><pre>rtk npm run pilot:market{ '\n' }rtk npm run pilot:local{ '\n' }rtk npm run pilot -- status</pre><p>외부 배포·제출 클라이언트·참여자 승인·중단 복구는 <a href="/docs/pilot/runbook.md" target="_blank" rel="noreferrer">실행 안내</a>에 정리했습니다. 로컬 transaction hash는 공개 explorer에서 조회할 수 없습니다.</p></div>
  </section>;
}
