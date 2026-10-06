import React, { useState } from 'react';
export const value=v=>Number(v||0)/1e6;
export const cash=v=>v==null?'—':value(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export const short=x=>x?x.slice(0,8)+'…'+x.slice(-6):'—';
const names={ALLOCATE:"Allocate capital",REDEEM:"Redeem",PAY_PROVIDER:"Pay fees",ORDER:"Order"};
const Empty=({children})=><div className="service-empty">{children}</div>;

export function Catalog({state,navigate}) {
  const [search,setSearch]=useState('');
  const list=state?.catalog.filter(s=>(s.name+' '+s.description+' '+s.provider).toLowerCase().includes(search.toLowerCase()))||[];
  return <>
    <div className="catalog-tools"><label htmlFor="strategy-search">Search strategies</label><input id="strategy-search" placeholder="Strategy name or provider address" value={search} onChange={e=>setSearch(e.target.value)}/><span>{list.length}strategies</span></div>
    <div className="strategy-directory">{list.map(s=><article className="directory-row" key={s.id}>
      <div className="directory-identity"><span className="strategy-letter">{s.name.slice(0,1)}</span><div><h2><a href={'#/strategies/'+encodeURIComponent(s.id)}>{s.name}</a></h2><p>{s.description}</p><small>Provider {short(s.provider)}</small></div></div>
      <div className="directory-metric"><small>Unit value</small><strong>{value(s.unitPrice).toFixed(6)} <small>tUSD</small></strong></div>
      <div className="directory-metric"><small>Settlement records</small><strong>{s.settledRounds}runs</strong></div>
      <button className="secondary" onClick={()=>navigate('/strategies/'+encodeURIComponent(s.id))}>View details</button>
    </article>)}</div>
    {!list.length&&state&&<Empty>No matching strategies.</Empty>}
    <p className="service-caption">This archived list uses test assets. It has no live trading track record.</p>
  </>;
}

export function StrategyDetail({strategy,state,amount,setAmount,busy,act,navigate}) {
  if(!strategy)return state?<Empty>Strategy not found. <a href="#/strategies">Return to list</a></Empty>:null;
  const position=state.portfolio.find(p=>p.strategyId===strategy.id);
  return <>
    <a className="back-link" href="#/strategies">← Strategy list</a>
    <div className="strategy-detail-grid">
      <section className="card"><div className="eyebrow">STRATEGY</div><h2>{strategy.name}</h2><p>{strategy.description}</p><p className="service-caption">Provider <span className="address-text">{strategy.provider}</span></p>
        <dl className="service-facts"><div><dt>Unit value</dt><dd>{value(strategy.unitPrice).toFixed(6)} tUSD</dd></div><div><dt>Investor assets</dt><dd>{cash(strategy.investorEquity)} tUSD</dd></div><div><dt>Settlement records</dt><dd>{strategy.settledRounds}runs</dd></div><div><dt>Performance fee</dt><dd>{strategy.feeBps/100}%</dd></div></dl>
        <h3>Investment conditions</h3><p>Receive units for the capital allocated to this strategy. Deposits and redemptions are available when all its positions are settled.</p><p>Performance fees accrue only on gains above the previous unit value high watermark.</p>
      </section>
      <section className="card allocation-panel"><h2>Allocate capital</h2><p>Available balance <strong>{cash(state.wallet)} tUSD</strong></p><form onSubmit={e=>{e.preventDefault();act('ALLOCATE',{strategyId:strategy.id,amount});}}><label htmlFor="allocation-amount">Allocation amount (tUSD)</label><input id="allocation-amount" type="number" min="0.000001" step="0.000001" required value={amount} onChange={e=>setAmount(e.target.value)}/><button className="primary full-width" disabled={busy}>{busy?"Processing…":"Allocate to this strategy"}</button></form>
        {position&&<p>My current claim <strong>{cash(position.claim)} tUSD</strong></p>}<button className="text-button" onClick={()=>navigate('/portfolio')}>View my investments →</button>
      </section>
    </div>
  </>;
}

export function Portfolio({state,busy,act,navigate}) {
  const total=state?.portfolio.reduce((n,p)=>n+BigInt(p.claim),0n)||0n;
  return <>
    <div className="portfolio-summary"><div><span>Total strategy assets</span><strong>{cash(String(total))} <small>tUSD</small></strong></div><div><span>Invested strategies</span><strong>{state?.portfolio.length||0}<small>items</small></strong></div><a href="#/activity">Deposit and withdrawal history →</a></div>
    <section className="card">{state?.portfolio.length?<div className="table-scroll"><table className="pilot-table"><thead><tr><th>Strategy</th><th>My units</th><th>My current claim</th><th>Actions</th></tr></thead><tbody>{state.portfolio.map(p=><tr key={p.strategyId}><td><a href={'#/strategies/'+encodeURIComponent(p.strategyId)}>{p.name}</a></td><td>{value(p.units).toLocaleString('en-US',{maximumFractionDigits:6})}</td><td>{cash(p.claim)} tUSD</td><td><button className="secondary" disabled={busy||!p.canRedeem} onClick={()=>act('REDEEM',{strategyId:p.strategyId})}>{p.canRedeem?"Redeem":"Awaiting settlement"}</button></td></tr>)}</tbody></table></div>:<Empty><p>No allocations yet.</p><button className="primary" onClick={()=>navigate('/strategies')}>Explore strategies</button></Empty>}</section>
  </>;
}

export function Activity({state}) {
  return <><a className="back-link" href="#/portfolio">← My investments</a><section className="card">{state?.receipts.length?<div className="table-scroll"><table className="pilot-table"><thead><tr><th>Action</th><th>Strategy</th><th>Block</th><th>Transaction hash</th></tr></thead><tbody>{state.receipts.map(r=><tr key={r.hash}><td>{names[r.type]||r.type}</td><td>{state.catalog.find(s=>s.id===r.strategyId)?.name||r.strategyId}</td><td>{r.block}</td><td>{state.mode==='MONAD_TESTNET'?<a href={'https://testnet.monadexplorer.com/tx/'+r.hash} target="_blank" rel="noreferrer">{short(r.hash)}</a>:<code title={r.hash}>{short(r.hash)}</code>}</td></tr>)}</tbody></table></div>:<Empty>No deposit or withdrawal history.</Empty>}</section></>;
}

export function Provider({state,selected,setSelected,orderAmount,setOrderAmount,busy,act,walletSigner,newName,setNewName,newDescription,setNewDescription}) {
  const eligible=state?.catalog.filter(s=>state.mode==='LOCAL_EVM'||s.provider.toLowerCase()===state.investor?.toLowerCase())||[];
  const strategy=eligible.find(s=>s.id===selected);
  return <>
    {state?.mode==='LOCAL_EVM'&&<p className="service-caption">Local environment using provider test accounts.</p>}
    <div className="provider-picker"><label htmlFor="provider-strategy">Strategy to operate</label><select id="provider-strategy" value={strategy?.id||''} disabled={busy} onChange={e=>setSelected(e.target.value)}><option value="" disabled>Select a strategy</option>{eligible.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></div>
    {strategy?<div className="strategy-detail-grid"><section className="card"><h2>{strategy.name}</h2><dl className="service-facts"><div><dt>Strategy investor assets</dt><dd>{cash(strategy.investorEquity)} tUSD</dd></div><div><dt>Unpaid fees</dt><dd>{cash(strategy.providerAccrual)} tUSD</dd></div></dl>{strategy.id==='cash-reserve'?<p>Cash-only strategies do not place orders.</p>:<form onSubmit={e=>{e.preventDefault();act('ORDER',{strategyId:strategy.id,side:strategy.id==='btc-hedge'?'SHORT_OPEN':'BUY',amount:orderAmount});}}><label htmlFor="order-amount">Buy capital / short collateral (tUSD)</label><input id="order-amount" type="number" min="0.000001" step="0.000001" required value={orderAmount} onChange={e=>setOrderAmount(e.target.value)}/><p className="service-caption">Orders may use up to 25% of this strategy's investor assets.</p><button className="primary" disabled={busy}>{strategy.id==='btc-hedge'?"Borrow and sell":"Buy BTC"}</button></form>}</section>
      <section className="card"><h2>Settlement and fees</h2><p>Settle only this strategy's positions. Investors can redeem after settlement.</p>{strategy.id!=='cash-reserve'&&<button className="secondary" disabled={busy} onClick={()=>act('ORDER',{strategyId:strategy.id,side:strategy.id==='btc-hedge'?'SHORT_CLOSE':'SELL'})}>Settle positions</button>}<hr/><p>Pay accrued fees to the provider wallet.</p><button className="secondary" disabled={busy||!BigInt(strategy.providerAccrual)} onClick={()=>act('PAY_PROVIDER',{strategyId:strategy.id})}>Fee {cash(strategy.providerAccrual)}  Pay tUSD</button></section></div>:<Empty>Choose a strategy you own or register a new one.</Empty>}
    {state?.mode==='MONAD_TESTNET'&&<details className="card"><summary>Register new strategy</summary><form className="registration-form" onSubmit={e=>{e.preventDefault();act('REGISTER',{strategyId:'strategy-'+crypto.randomUUID().slice(0,8),name:newName,description:newDescription});}}><label>Strategy name<input required maxLength={100} value={newName} onChange={e=>setNewName(e.target.value)}/></label><label>Strategy description<input maxLength={500} value={newDescription} onChange={e=>setNewDescription(e.target.value)}/></label><button className="primary" disabled={busy||!walletSigner}>Sign and register</button></form></details>}
  </>;
}

export function Verification({state,evidence}) {
  return <>
    <div className="strategy-detail-grid"><section className="card"><h2>Current execution environment</h2><dl className="service-facts"><div><dt>Network</dt><dd>{state?.mode==='MONAD_TESTNET'?"Monad Testnet":"Local EVM"}</dd></div><div><dt>Asset</dt><dd>Test token</dd></div><div><dt>TEE</dt><dd>Not applied</dd></div></dl><p>{state?.mode==='MONAD_TESTNET'?"Requests are processed after verifying the external wallet signature.":"The server signs with test keys. This is not real wallet authentication."}  Private ledger and contract execution trust the operator in this archived prototype.</p><p><a href="/docs/sleeves-v0.2.md" target="_blank" rel="noreferrer">Development specification and verification scope ↗</a></p><p><a href="/docs/confidential-alpha-v0.2.md" target="_blank" rel="noreferrer">Product specification ↗</a></p></section>
      <section className="card"><h2>Shared Vault reconciliation</h2><p className="address-text">{state?.vault.address}</p><dl className="service-facts"><div><dt>Vault equity</dt><dd>{cash(state?.vault.vaultEquity)} tUSD</dd></div><div><dt>Sum of strategy equity</dt><dd>{cash(state?.vault.strategyEquity)} tUSD</dd></div><div><dt>Protocol accruals and rounding</dt><dd>{cash(state?.vault.protocolAccrual)} tUSD</dd></div><div><dt>Reconciliation result</dt><dd>{state?.vault.balanced?"Consistent":"Waiting"}</dd></div></dl></section></div>
    {evidence?.available?<section className="card"><h2>Monad Testnet transaction evidence</h2><p>{evidence.operations}operations · final ledger {evidence.balanced?"Consistent":"Needs review"}  · Controlled test accounts and assets</p><p><a href={'https://testnet.monadexplorer.com/address/'+evidence.vault} target="_blank" rel="noreferrer">Testnet Vault {short(evidence.vault)} ↗</a></p><div className="table-scroll"><table className="pilot-table"><thead><tr><th>Action</th><th>Strategy</th><th>Transaction</th></tr></thead><tbody>{evidence.transactions.map(t=><tr key={t.hash}><td>{names[t.type]||t.type}</td><td>{t.strategyId}</td><td><a href={'https://testnet.monadexplorer.com/tx/'+t.hash} target="_blank" rel="noreferrer">{short(t.hash)} ↗</a></td></tr>)}</tbody></table></div></section>:<Empty>Could not load testnet verification records.</Empty>}
    <a href="#/legacy">View archived shared fund records →</a>
  </>;
}
