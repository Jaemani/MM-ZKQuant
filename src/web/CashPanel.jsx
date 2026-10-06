import React,{useState} from 'react';
import {usePlatform} from './PlatformContext.jsx';
import {money,time,statusLabel} from './platformModel.js';
import {Panel,Button,Modal,Stat,Wallet,Link} from './PlatformUI.jsx';
export default function CashPanel() {
  const p=usePlatform(),[mode,setMode]=useState(null),[amount,setAmount]=useState('');
  if(!p.session)return null;
  const cash=p.portfolio?.cash,valid=/^\d+(\.\d{1,6})?$/.test(amount)&&Number(amount)>0,tooMuch=mode==='withdraw'&&valid&&Number(amount)>Number(cash?.available||0)/1e6;
  const open=next=>{setMode(next);setAmount('');p.notify('');};
  return <Panel id="q-platform-balance"><div className="q-row"><div><h2>Platform balance</h2><p className="q-muted">Add funds once, then allocate to strategies without wallet signatures.</p></div><div className="q-actions"><Button disabled={p.busy||!p.config} onClick={()=>open('add')}><Wallet size={16}/>Add funds</Button><Button secondary disabled={p.busy||!cash||BigInt(cash.available)===0n} onClick={()=>open('withdraw')}>Withdraw to wallet</Button></div></div>
    <div className="q-position-stats"><Stat label="Available balance" value={money(cash?.available)} suffix="AUSD"/><Stat label="Reserved for withdrawal" value={money(cash?.reserved)} suffix="AUSD"/></div>
    <p className="q-muted">Strategy redemptions return here at the scheduled settlement. <Link className="q-text-link" to="/strategies">Find a strategy →</Link></p>
    {(cash?.withdrawals||[]).map(w=><div className="q-withdrawal" key={w.id}><div><strong>{money(w.amount)} AUSD · {statusLabel(w.status)}</strong><p>{time(w.paidAt||w.createdAt)} · To your linked wallet</p>{w.error&&<p className="q-error">Withdrawal confirmation is pending. Refresh your assets to check progress.</p>}</div>{w.txHash?<a className="q-text-link" href={`https://testnet.monadscan.com/tx/${w.txHash}`} target="_blank" rel="noreferrer">Transaction ↗</a>:w.cancellable?<Button secondary disabled={p.busy} onClick={()=>p.cancelCashWithdrawal(w)}>Cancel</Button>:null}</div>)}
    {mode&&<Modal title={mode==='add'?'Add funds':'Withdraw to your wallet'} busy={p.busy} onClose={()=>setMode(null)}>
      <p className="q-muted">{mode==='add'?'Your deposit goes to your platform balance. Choose a strategy after confirmation.':'This request pays available cash to your fixed funding wallet. No wallet signature is needed.'}</p>
      <label className="q-field">Amount (AUSD)<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" aria-invalid={!!amount&&(!valid||tooMuch)}/></label>
      {mode==='add'?<div className="q-row q-space"><span className="q-muted">Wallet balance: {money(p.balance)} AUSD</span><Button secondary disabled={p.busy} onClick={p.refreshBalance}>Connect wallet</Button></div>:<><p className="q-muted">Available: {money(cash?.available)} AUSD</p><p className="q-wallet-address">{p.session.wallet}</p></>}
      {!!amount&&!valid&&<p className="q-error">Enter a positive amount with up to six decimal places.</p>}{tooMuch&&<p className="q-error">Your available balance is insufficient.</p>}
      <p className="q-callout">{mode==='add'?'Your wallet may ask for a token approval and a deposit transaction. Viewing assets and investing from your balance do not require signatures.':'Only your platform cash balance can be withdrawn. Redeem invested or pending strategy funds first.'}</p>
      {p.stage&&<p className="q-progress" role="status"><span className="q-spinner"/>{p.stage}</p>}{p.message?.error&&<p className="q-error" role="alert">{p.message.text}</p>}
      <Button className="q-full" disabled={p.busy||!valid||tooMuch} onClick={async()=>{const ok=mode==='add'?await p.addFunds(amount):await p.withdrawCash(amount);if(ok)setMode(null);}}>{p.busy?'Processing…':mode==='add'?'Continue in wallet':'Confirm withdrawal'}</Button>
    </Modal>}
  </Panel>;
}
