import React from 'react';
import perpl from '../../docs/evidence/perpl-tee-testnet-readiness.json';
import sleeves from '../../docs/evidence/omnibus-rpc-verification.json';

const explorer = hash => `https://testnet.monadscan.com/tx/${hash}`;
const short = value => `${value.slice(0, 10)}…${value.slice(-8)}`;
const ausd = value => (Number(value) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

function Transaction({ name, transaction }) {
  if (!transaction) return null;
  return <li><span>{name}</span><a href={explorer(transaction.hash)} target="_blank" rel="noreferrer">{short(transaction.hash)}</a><small>block {transaction.block} · status {transaction.status}</small></li>;
}

export default function TestnetDemo() {
  const products = perpl.products || [];
  const transactions = perpl.sessionTransactions || {};
  return <div className="demo-shell">
    <header className="demo-hero">
      <a className="demo-brand" href="#/demo">MM-ZKQuant <span>TESTNET DEMO</span></a>
      <div className="demo-badge">Monad testnet · chain {perpl.chainId}</div>
      <h1>Verified TEE proofs<br />Perpl execution demo</h1>
      <p>Public testnet records: encrypted targets → Phala TDX attestation → onchain verification → Perpl orders → position closing and collateral recovery.</p>
      <div className="demo-actions"><a className="demo-primary" href="#/domains/overview">View strategy and Vault architecture</a><a className="demo-secondary" href="https://testnet.monadscan.com/address/0x1964C32f0bE608E7D29302AFF5E61268E72080cc" target="_blank" rel="noreferrer">Perpl explorer ↗</a></div>
    </header>

    <main className="demo-content">
      <section className="demo-status-grid" aria-label="Verification summary">
        <div><small>TEE</small><strong>Phala TDX</strong><span>4 hardware proofs</span></div>
        <div><small>Execution</small><strong>4 orders</strong><span>A/B entry and exit</span></div>
        <div><small>Final positions</small><strong>0 lots</strong><span>Both accounts closed</span></div>
        <div><small>Verification</small><strong>PASS</strong><span>Proof → Perpl trace verified</span></div>
      </section>

      <section className="demo-section">
        <div className="demo-section-heading"><div><small>01 / EXECUTION</small><h2>Actual round trips for two products</h2></div><p>Chain traces verify that proof validation and Perpl calls occur in the same transaction for each order.</p></div>
        <div className="demo-product-grid">{products.map(product => <article className="demo-product" key={product.label}><div className="demo-product-label">PRODUCT {product.label}</div><strong>{product.openActual.startsWith('-') ? 'Short' : 'Long'} {product.openActual.replace('-', '')} lots</strong><dl><div><dt>Collateral deposit</dt><dd>100.00 test AUSD</dd></div><div><dt>Recovered</dt><dd>{ausd(product.recovered)} test AUSD</dd></div><div><dt>Final positions</dt><dd>0 lots</dd></div></dl><a href={`https://testnet.monadscan.com/address/${product.address}`} target="_blank" rel="noreferrer">Dedicated execution account ↗</a></article>)}</div>
      </section>

      <section className="demo-section">
        <div className="demo-section-heading"><div><small>02 / ONCHAIN PROOF</small><h2>Verifiable transactions</h2></div><p>Links open the public Monad Testnet explorer.</p></div>
        <div className="demo-timeline">
          <ol>{['open-A', 'close-A-0', 'recover-A', 'open-B', 'close-B-0', 'recover-B'].map(name => <Transaction key={name} name={name} transaction={transactions[name]} />)}</ol>
        </div>
      </section>

      <section className="demo-section demo-flow-section">
        <div className="demo-section-heading"><div><small>03 / PRODUCT FLOW</small><h2>Implemented investor accounting path</h2></div><p>The sleeves path was verified independently on Monad Testnet before integration with Perpl execution.</p></div>
        <div className="demo-flow"><span>Strategy deposits</span><b>→</b><span>Shared Vault</span><b>→</b><span>Strategy settlements and fees</span><b>→</b><span>Individual redemptions</span></div>
        <div className="demo-proof-note"><strong>{sleeves.verdict}</strong><span>Vault {short(sleeves.vault)}  · public receipts {sleeves.confirmedTransactions}receipts reverified</span></div>
      </section>

      <section className="demo-section demo-check-section">
        <div><small>04 / REPRODUCE</small><h2>Reverify public evidence without new transactions</h2><p>Read existing receipts, deployed code, proofs, positions and internal call order without keys, TEE restart or proving keys.</p></div>
        <pre><code>npm ci{`\n`}npm run verify:perpl:tee:testnet</code></pre>
      </section>

      <section className="demo-limitations">
        <h2>Archived demo scope</h2>
        <ul>{perpl.limitations.map(item => <li key={item}>{item}</li>)}</ul>
        <p>This archived demo predates full integration of investor units, fees and redemptions with TEE/Perpl execution.</p>
      </section>
    </main>
  </div>;
}
