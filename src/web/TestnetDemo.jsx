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
      <h1>TEE proof가 검증된<br />Perpl 실행 데모</h1>
      <p>암호화된 목표 → Phala TDX 증명 → 온체인 검증 → Perpl 주문 → 포지션 종료와 담보 회수까지의 공개 테스트넷 기록입니다.</p>
      <div className="demo-actions"><a className="demo-primary" href="#/domains/overview">전략·Vault 구조 보기</a><a className="demo-secondary" href="https://testnet.monadscan.com/address/0x1964C32f0bE608E7D29302AFF5E61268E72080cc" target="_blank" rel="noreferrer">Perpl explorer ↗</a></div>
    </header>

    <main className="demo-content">
      <section className="demo-status-grid" aria-label="검증 요약">
        <div><small>TEE</small><strong>Phala TDX</strong><span>hardware proof 4개</span></div>
        <div><small>실행</small><strong>4 orders</strong><span>A/B 진입과 종료</span></div>
        <div><small>최종 포지션</small><strong>0 lots</strong><span>두 계정 모두 종료</span></div>
        <div><small>검증</small><strong>PASS</strong><span>proof → Perpl trace 확인</span></div>
      </section>

      <section className="demo-section">
        <div className="demo-section-heading"><div><small>01 / EXECUTION</small><h2>두 Product의 실제 왕복 실행</h2></div><p>각 주문은 proof 검증과 Perpl 호출이 같은 트랜잭션에서 일어났는지 체인 trace로 재검증했습니다.</p></div>
        <div className="demo-product-grid">{products.map(product => <article className="demo-product" key={product.label}><div className="demo-product-label">PRODUCT {product.label}</div><strong>{product.openActual.startsWith('-') ? 'Short' : 'Long'} {product.openActual.replace('-', '')} lots</strong><dl><div><dt>담보 입금</dt><dd>100.00 test AUSD</dd></div><div><dt>회수</dt><dd>{ausd(product.recovered)} test AUSD</dd></div><div><dt>최종 포지션</dt><dd>0 lots</dd></div></dl><a href={`https://testnet.monadscan.com/address/${product.address}`} target="_blank" rel="noreferrer">전용 실행 계정 ↗</a></article>)}</div>
      </section>

      <section className="demo-section">
        <div className="demo-section-heading"><div><small>02 / ONCHAIN PROOF</small><h2>검증 가능한 트랜잭션</h2></div><p>링크는 공개 Monad 테스트넷 탐색기로 연결됩니다.</p></div>
        <div className="demo-timeline">
          <ol>{['open-A', 'close-A-0', 'recover-A', 'open-B', 'close-B-0', 'recover-B'].map(name => <Transaction key={name} name={name} transaction={transactions[name]} />)}</ol>
        </div>
      </section>

      <section className="demo-section demo-flow-section">
        <div className="demo-section-heading"><div><small>03 / PRODUCT FLOW</small><h2>이미 구현된 투자자 회계 경로</h2></div><p>Perpl 실행과 결합할 sleeves 경로는 별도 Monad 테스트넷에서 영수증 재검증을 통과했습니다.</p></div>
        <div className="demo-flow"><span>전략별 예치</span><b>→</b><span>공동 Vault</span><b>→</b><span>전략별 정산·보수</span><b>→</b><span>개별 환매</span></div>
        <div className="demo-proof-note"><strong>{sleeves.verdict}</strong><span>Vault {short(sleeves.vault)} · 공개 영수증 {sleeves.confirmedTransactions}건 재검증</span></div>
      </section>

      <section className="demo-section demo-check-section">
        <div><small>04 / REPRODUCE</small><h2>새 거래 없이 공개 증거 재검증</h2><p>키, TEE 재가동, proving key 없이 기존 영수증·배포 코드·proof·실제 포지션·내부 호출 순서를 조회합니다.</p></div>
        <pre><code>npm ci{`\n`}npm run verify:perpl:tee:testnet</code></pre>
      </section>

      <section className="demo-limitations">
        <h2>이 데모의 범위</h2>
        <ul>{perpl.limitations.map(item => <li key={item}>{item}</li>)}</ul>
        <p>투자자 지분·보수·환매를 포함한 sleeves 경로와 TEE/Perpl 실행 경로의 완전한 결합은 다음 단계입니다.</p>
      </section>
    </main>
  </div>;
}
