import React, {useEffect,useState} from "react";
import {Panel,Badge,Button,RefreshCw} from "./PlatformUI.jsx";
import {time,short} from "./platformModel.js";
import {fetchPlatformJson} from "./platformRequest.js";

export default function LedgerProofPanel() {
  const [status,setStatus]=useState(null),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  const refresh=async()=>{setBusy(true);try{setStatus(await fetchPlatformJson('/api/v1/ledger-proof-status'));setError(false);}catch{setError(true);}finally{setBusy(false);}};
  useEffect(()=>{let active=true;const poll=()=>fetchPlatformJson('/api/v1/ledger-proof-status').then(value=>{if(active){setStatus(value);setError(false);}}).catch(()=>{if(active)setError(true);});poll();const timer=setInterval(poll,30000);return()=>{active=false;clearInterval(timer);};},[]);
  const checkpoint=status?.checkpoint,delayed=checkpoint&&Date.now()/1000-checkpoint.checkpointAt>2*(status.intervalSeconds||300);
  const label=error?'조회 지연':!status?'확인 중':!status.enabled?'준비 중':status.status==='ATTENTION_REQUIRED'?'플랫폼 확인 필요':status.status==='PROVING'?'새 증명 생성 중':delayed?'새 검증 지연':checkpoint?.onchainVerified?'온체인 검증 완료':checkpoint?'온체인 기록 대기':'첫 증명 생성 중';
  const warning=error||delayed||status?.status==='ATTENTION_REQUIRED';
  return <Panel className="q-ledger-proof-panel" aria-labelledby="ledger-proof-title">
    <div className="q-row q-fee-heading"><h2 id="ledger-proof-title">장부 ZK 검증</h2><Badge tone={warning?'warning':checkpoint?.onchainVerified?'success':''}>{label}</Badge></div>
    <p className="q-muted q-space">공용 장부의 계산과 전이를 {status?.intervalSeconds?Math.round(status.intervalSeconds/60):5}분마다 증명합니다. 전략과 투자자별 지분은 공개하지 않습니다.</p>
    {checkpoint?<>
      <div className="q-row q-fee-timing q-space"><span>검증한 장부 시점 {time(checkpoint.checkpointAt)}</span><span>체크포인트 #{checkpoint.lastSequence}</span></div>
      <p className="q-muted">가격·체결 데이터는 TEE가 확인합니다. 화면의 최신 상태는 위 장부 시점 이후의 거래를 포함할 수 있습니다.</p>
      {checkpoint.transaction&&<a className="q-text-link" href={`https://testnet.monadexplorer.com/tx/${checkpoint.transaction.txHash}`} target="_blank" rel="noreferrer">검증 거래 {short(checkpoint.transaction.txHash)} ↗</a>}
    </>:<p className="q-muted q-space">{error?'장부 검증 상태를 조회하지 못했습니다. 다시 확인해 주세요.':status?.enabled?'첫 장부 체크포인트를 준비하고 있습니다.':'장부 증명 연결을 준비하고 있습니다.'}</p>}
    {warning&&<p className="q-callout q-space" role="status">{status?.error==='OPERATOR_GAS_INSUFFICIENT'?'온체인 기록에 필요한 실행 가스가 부족합니다. 이전 검증 결과는 유지됩니다.':'최신 장부 검증이 지연되고 있습니다. 마지막으로 완료한 결과와 시점을 표시합니다.'}</p>}
    <div className="q-row q-fee-heading q-space">
      <Button secondary disabled={busy} onClick={refresh} aria-label="장부 검증 새로고침"><RefreshCw size={15}/> 새로고침</Button>
      {checkpoint&&<a className="q-text-link" href={`/api/v1/ledger-proofs?after=${Math.max(0,checkpoint.firstSequence-1)}`} target="_blank" rel="noreferrer">공개 증명 보기 ↗</a>}
      {status?.registry&&<a className="q-text-link" href={`https://testnet.monadexplorer.com/address/${status.registry}`} target="_blank" rel="noreferrer">검증 계약 ↗</a>}
    </div>
  </Panel>;
}
