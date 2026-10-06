import React, {useEffect,useState} from "react";
import {Panel,Badge,Button,RefreshCw} from "./PlatformUI.jsx";
import {time,short} from "./platformModel.js";
import {fetchPlatformJson} from "./platformRequest.js";

export default function LedgerProofPanel() {
  const [status,setStatus]=useState(null),[error,setError]=useState(false),[busy,setBusy]=useState(false);
  const refresh=async()=>{setBusy(true);try{setStatus(await fetchPlatformJson('/api/v1/ledger-proof-status'));setError(false);}catch{setError(true);}finally{setBusy(false);}};
  useEffect(()=>{let active=true;const poll=()=>fetchPlatformJson('/api/v1/ledger-proof-status').then(value=>{if(active){setStatus(value);setError(false);}}).catch(()=>{if(active)setError(true);});poll();const timer=setInterval(poll,30000);return()=>{active=false;clearInterval(timer);};},[]);
  const checkpoint=status?.checkpoint,delayed=checkpoint&&Date.now()/1000-checkpoint.checkpointAt>2*(status.intervalSeconds||300);
  const label=error?"Update delayed":!status?"Checking":!status.enabled?"Preparing":status.status==='ATTENTION_REQUIRED'?"Platform review required":status.status==='PROVING'?"Generating new proofs":delayed?"Verification delayed":checkpoint?.onchainVerified?"Verified onchain":checkpoint?"Awaiting onchain record":"Generating first proof";
  const warning=error||delayed||status?.status==='ATTENTION_REQUIRED';
  return <Panel className="q-ledger-proof-panel" aria-labelledby="ledger-proof-title">
    <div className="q-row q-fee-heading"><h2 id="ledger-proof-title">Ledger ZK verification</h2><Badge tone={warning?'warning':checkpoint?.onchainVerified?'success':''}>{label}</Badge></div>
    <p className="q-muted q-space">Shared ledger arithmetic and transitions are proven every {status?.intervalSeconds?Math.round(status.intervalSeconds/60):5}minutes. Strategies and individual holdings remain private.</p>
    {checkpoint?<>
      <div className="q-row q-fee-timing q-space"><span>Verified ledger timestamp {time(checkpoint.checkpointAt)}</span><span>Checkpoint #{checkpoint.lastSequence}</span></div>
      <p className="q-muted">Prices and fills are checked by the TEE. Current screens may include transactions after the verified checkpoint.</p>
      {checkpoint.transaction&&<a className="q-text-link" href={`https://testnet.monadexplorer.com/tx/${checkpoint.transaction.txHash}`} target="_blank" rel="noreferrer">Verification transaction {short(checkpoint.transaction.txHash)} ↗</a>}
    </>:<p className="q-muted q-space">{error?"Could not load ledger verification status. Try again.":status?.enabled?"Preparing the first ledger checkpoint.":"Preparing ledger proof connection."}</p>}
    {warning&&<p className="q-callout q-space" role="status">{status?.error==='OPERATOR_GAS_INSUFFICIENT'?"Insufficient execution gas for the onchain record. Previous verified results remain available.":"Latest ledger verification is delayed. Showing the last completed result and timestamp."}</p>}
    <div className="q-row q-fee-heading q-space">
      <Button secondary disabled={busy} onClick={refresh} aria-label="Refresh ledger verification"><RefreshCw size={15}/>  Refresh</Button>
      {checkpoint&&<a className="q-text-link" href={`/api/v1/ledger-proofs?after=${Math.max(0,checkpoint.firstSequence-1)}`} target="_blank" rel="noreferrer">View public proofs ↗</a>}
      {status?.registry&&<a className="q-text-link" href={`https://testnet.monadexplorer.com/address/${status.registry}`} target="_blank" rel="noreferrer">Verification contract ↗</a>}
    </div>
  </Panel>;
}
