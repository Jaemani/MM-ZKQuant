import React, { useEffect, useMemo, useState } from 'react';
import { BrowserProvider, Contract, formatUnits, hexlify, parseUnits, randomBytes } from 'ethers';
import { investmentMessage } from '../platform/investment-message.js';
import { encryptedTeeRequest } from './teeChannel.js';
import PrivatePositions from './PrivatePositions.jsx';
import {platformError} from './platformErrors.js';

const ERC20_ABI = [
  'function allowance(address owner,address spender) view returns (uint256)',
  'function approve(address spender,uint256 amount) returns (bool)'
];
const VAULT_ABI = ['function deposit(uint256 amount,bytes32 id)'];
const SESSION_KEY = 'mmq.investor.session.v1';
const PENDING_KEY = 'mmq.investor.pending-deposit.v1';
const short = value => value ? `${value.slice(0, 7)}…${value.slice(-5)}` : '';

async function walletSigner() {
  if (!window.ethereum) throw Error('브라우저 지갑이 필요합니다.');
  await window.ethereum.request({ method: 'eth_requestAccounts' });
  let provider = new BrowserProvider(window.ethereum);
  if ((await provider.getNetwork()).chainId !== 10143n) {
    try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x279f' }] }); }
    catch { throw Error('지갑 네트워크를 Monad Testnet으로 전환해 주세요.'); }
    provider = new BrowserProvider(window.ethereum);
  }
  return provider.getSigner();
}

async function signedInvestment(signer, action, values = {}) {
  const payload = { action, wallet: await signer.getAddress(), strategyId: null, amount: null, depositId: null, txHash: null, nonce: hexlify(randomBytes(32)), ...values };
  return { ...payload, signature: await signer.signMessage(investmentMessage(payload)) };
}

export default function InvestorPortal({ apiBase, config, strategies, initialStrategyId, onBack }) {
  const [state, setState] = useState({ wallet: '', sessionToken: '', positions: [], deposits: [], busy: false, message: '' });
  const [form, setForm] = useState({ strategyId: initialStrategyId || '', amount: '10' });
  const [pending, setPending] = useState(() => { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; } });
  const investable = useMemo(() => strategies.filter(strategy => ['FUNDING','LIVE'].includes(strategy.status)), [strategies]);
  const ready = Boolean(config?.vaultAddress && config?.cashTokenAddress && config?.teeEndpoint && config?.teeEncryptionPublicKey);

  const request = async (path, options = {}) => {
    const response = await fetch(`${apiBase}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(body.error || '플랫폼 API 요청이 거절되었습니다.');
    return body;
  };
  const fail = error => setState(current => ({ ...current, busy: false, message: platformError(error) }));

  async function privateRequest(payload) {
    return encryptedTeeRequest(config.teeEndpoint, config.teeEncryptionPublicKey, '/platform/encrypted-investments', payload);
  }

  async function refreshPortfolio(signer) {
    const payload = await signedInvestment(signer, 'PORTFOLIO');
    const result = await privateRequest(payload);
    setState(current => ({ ...current, positions: result.positions || [], deposits: result.deposits || [] }));
    return result;
  }

  async function connect() {
    setState(current => ({ ...current, busy: true, message: '' }));
    try {
      const signer = await walletSigner();
      const address = await signer.getAddress();
      const challenge = await request('/v1/auth/challenge', { method: 'POST', body: JSON.stringify({ address }) });
      const signature = await signer.signMessage(challenge.message);
      const session = await request('/v1/auth/verify', { method: 'POST', body: JSON.stringify({ address, nonce: challenge.nonce, signature }) });
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      setState(current => ({ ...current, wallet: session.wallet, sessionToken: session.sessionToken }));
      if (ready) await refreshPortfolio(signer);
      setState(current => ({ ...current, busy: false, message: '로그인되었습니다. 전략 선택과 지분은 TEE에만 저장됩니다.' }));
    } catch (error) { fail(error); }
  }

  async function restoreSession() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return; }
    if (!saved?.sessionToken) return;
    try {
      const me = await request('/v1/me', { headers: { Authorization: `Bearer ${saved.sessionToken}` } });
      setState(current => ({ ...current, wallet: me.wallet, sessionToken: saved.sessionToken, message:'로그인을 복원했습니다. 투자 현황 새로고침을 눌러 지갑 서명으로 조회하세요.' }));
    } catch { localStorage.removeItem(SESSION_KEY); }
  }

  useEffect(() => { restoreSession(); }, []);
  useEffect(() => { if (initialStrategyId) setForm(current => ({ ...current, strategyId: initialStrategyId })); }, [initialStrategyId]);

  async function completeDeposit(candidate, signer) {
    const completed = await privateRequest(await signedInvestment(signer, 'COMPLETE', { depositId: candidate.depositId, txHash: candidate.txHash }));
    localStorage.removeItem(PENDING_KEY);
    setPending(null);
    await refreshPortfolio(signer);
    return completed;
  }

  async function deposit(event) {
    event.preventDefault();
    setState(current => ({ ...current, busy: true, message: '' }));
    try {
      if (!ready) throw Error('공용 Vault와 TEE가 아직 연결되지 않았습니다.');
      const selected = investable.find(strategy => strategy.id === form.strategyId);
      if (!selected) throw Error('투자할 전략을 선택하세요.');
      const signer = await walletSigner();
      if ((await signer.getAddress()).toLowerCase() !== state.wallet.toLowerCase()) throw Error('로그인한 지갑과 현재 지갑이 다릅니다.');
      const amount = parseUnits(form.amount, 6);
      if (amount <= 0n) throw Error('입금 금액은 0보다 커야 합니다.');
      const prepared = await privateRequest(await signedInvestment(signer, 'PREPARE', { strategyId: selected.id, amount: amount.toString() }));
      let candidate = { strategyId: selected.id, strategyName: selected.name, amount: prepared.amount, depositId: prepared.depositId, vaultAddress: prepared.vaultAddress, cashTokenAddress: prepared.cashTokenAddress, txHash: null };
      localStorage.setItem(PENDING_KEY, JSON.stringify(candidate));
      setPending(candidate);
      const token = new Contract(prepared.cashTokenAddress, ERC20_ABI, signer);
      if ((await token.allowance(state.wallet, prepared.vaultAddress)) < amount) await (await token.approve(prepared.vaultAddress, amount)).wait();
      const transaction = await new Contract(prepared.vaultAddress, VAULT_ABI, signer).deposit(amount, prepared.depositId);
      candidate = { ...candidate, txHash: transaction.hash };
      localStorage.setItem(PENDING_KEY, JSON.stringify(candidate));
      setPending(candidate);
      await transaction.wait();
      await completeDeposit(candidate, signer);
      setState(current => ({ ...current, busy: false, message: `${selected.name} 대기 자금으로 입금되었습니다. 다음 목표 비중 제출 시 운용에 편입됩니다.` }));
    } catch (error) { fail(error); }
  }

  async function resumeDeposit() {
    setState(current => ({ ...current, busy: true, message: '' }));
    try {
      if (!pending?.txHash) throw Error('지갑에서 확정된 입금 거래가 없습니다.');
      const signer = await walletSigner();
      if ((await signer.getAddress()).toLowerCase() !== state.wallet.toLowerCase()) throw Error('로그인한 지갑과 현재 지갑이 다릅니다.');
      await completeDeposit(pending, signer);
      setState(current => ({ ...current, busy: false, message: '미완료 입금을 TEE 포트폴리오에 반영했습니다.' }));
    } catch (error) { fail(error); }
  }

  async function reloadPortfolio() {
    setState(current => ({ ...current, busy: true, message: '' }));
    try {
      const signer = await walletSigner();
      await refreshPortfolio(signer);
      setState(current => ({ ...current, busy: false, message: 'TEE에서 비공개 포트폴리오를 불러왔습니다.' }));
    } catch (error) { fail(error); }
  }

  const nameOf = strategyId => strategies.find(strategy => strategy.id === strategyId)?.name || '비공개 전략';
  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setState({wallet:'',sessionToken:'',positions:[],deposits:[],busy:false,message:'로그아웃했습니다.'});
  }
  async function withdraw(position,percent=100,pending=false) {
    setState(current=>({...current,busy:true,message:''}));
    try {if(!Number.isInteger(percent)||percent<1||percent>100)throw Error('출금 비율은 1~100%로 입력하세요.');const signer=await walletSigner();const amount=pending?position.pending:String(BigInt(position.units)*BigInt(percent)/100n);await privateRequest(await signedInvestment(signer,pending?'WITHDRAW_PENDING':'WITHDRAW',{strategyId:position.strategyId,amount}));await refreshPortfolio(signer);setState(current=>({...current,busy:false,message:'출금을 요청했습니다. 전략의 정산 일정에 따라 지급됩니다.'}));}catch(e){fail(e);}
  }
  async function cancelWithdrawal(position,withdrawal) {
    setState(current=>({...current,busy:true,message:''}));
    try {const signer=await walletSigner();await privateRequest(await signedInvestment(signer,'CANCEL_WITHDRAWAL',{strategyId:position.strategyId,depositId:withdrawal.id}));await refreshPortfolio(signer);setState(current=>({...current,busy:false,message:'출금 요청을 취소했습니다.'}));}catch(e){fail(e);}
  }
  return <section className="platform-investor">
    <div className="platform-detail-heading"><div><small>PRIVATE INVESTOR PORTFOLIO</small><h1>전략을 선택하고<br />공용 Vault에 입금</h1><p>전략 정보와 집계 성과는 공개됩니다. 내 전략 선택과 units는 지갑에서 TEE로 암호화해 전송합니다.</p></div><button className="platform-button" disabled={state.busy || !config} onClick={connect}>{state.wallet ? short(state.wallet) : '지갑으로 로그인'}</button></div>
    {state.message && <div className="manager-note"><strong>상태</strong><span>{state.message}</span></div>}
    {state.wallet&&<button className="platform-text-button" disabled={state.busy} onClick={logout}>로그아웃</button>}
    {!ready && <div className="manager-note"><strong>입금 준비 중</strong><span>공용 Vault 또는 TEE 연결 정보가 아직 설정되지 않았습니다.</span></div>}
    {pending?.txHash && <div className="manager-note"><strong>확정 대기 입금</strong><span>{pending.strategyName} · {formatUnits(pending.amount, 6)} AUSD</span><button className="platform-text-button" disabled={state.busy || !state.wallet} onClick={resumeDeposit}>TEE 반영 계속하기</button></div>}
    <div className="investor-grid"><article><small>01 · PRIVATE ALLOCATION</small><h2>투자할 전략 선택</h2><form onSubmit={deposit}><label>공개 전략<select required value={form.strategyId} onChange={event => setForm(current => ({ ...current, strategyId: event.target.value }))}><option value="">전략 선택</option>{investable.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.name} · {strategy.manager || strategy.strategist_name} · 수수료 {strategy.feeBps / 100}%</option>)}</select></label><label>입금 금액 (AUSD)<input type="number" min="0.000001" step="0.000001" required value={form.amount} onChange={event => setForm(current => ({ ...current, amount: event.target.value }))} /></label><p>지갑은 AUSD를 한 개의 공용 Vault에 입금합니다. 선택한 전략 ID는 입금 거래에 포함되지 않습니다.</p><button className="platform-button" disabled={state.busy || !state.wallet || !ready || !form.strategyId}>TEE 배분 준비 후 입금</button></form>{!investable.length && <p className="platform-muted">현재 투자 모집 중인 공개 전략이 없습니다.</p>}</article>
      <article><small>02 · PRIVATE PORTFOLIO</small><h2>내 투자 현황</h2>{state.positions.length ? <PrivatePositions positions={state.positions} nameOf={nameOf} busy={state.busy} onWithdraw={withdraw} onCancel={cancelWithdrawal}/> : <p>로그인 후 TEE에서 투자 현황을 불러옵니다. 개인별 배분과 지분은 공개 DB에 저장하지 않습니다.</p>}<button className="platform-text-button" disabled={state.busy || !state.wallet || !ready} onClick={reloadPortfolio}>투자 현황 새로고침</button></article></div>
    <section className="portfolio-card"><div><small>SHARED CUSTODY</small><h2>공용 Vault</h2></div>{config?.vaultAddress ? <a className="platform-text-button" href={`https://testnet.monadscan.com/address/${config.vaultAddress}`} target="_blank" rel="noreferrer">{short(config.vaultAddress)} ↗</a> : <p>배포 대기 중</p>}</section>
    <button className="platform-text-button" onClick={onBack}>전략 목록으로 돌아가기</button>
  </section>;
}
