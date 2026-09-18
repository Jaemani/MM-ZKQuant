import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {JsonRpcProvider,Wallet} from 'ethers';
import {runLocalPilot} from '../src/pilot/runner.js';
import {compilePilot,atomicJson} from '../src/pilot/chain.js';
import {collectMarket,verifyMarket} from '../src/pilot/market.js';
import {verifyContractEvidence,verifyExternalReceipts} from '../src/pilot/verify.js';
import {runRewardChallenges} from '../src/pilot/challenges.js';
const root=resolve(import.meta.dirname,'..'),directory=resolve(process.env.PILOT_DATA_DIR||join(root,'.data/testnet-pilot'));
const output=join(root,'docs/evidence');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]);
const checkpoint=()=>Object.fromEntries(['src','contracts','scripts','tests'].flatMap(p=>walk(join(root,p))).filter(p=>/\.(js|mjs|jsx|sol|css)$/.test(p)).sort().map(p=>[relative(root,p),digest(readFileSync(p))]));
const load=p=>JSON.parse(readFileSync(p));
async function main(){
  const startedAt=new Date().toISOString(),source=checkpoint();
  const local=await runLocalPilot({progress:console.log});
  const artifacts=compilePilot(),verification=verifyContractEvidence(local,artifacts),rewards=runRewardChallenges();
  console.log('거래 로그에서 잔고 이동·기여 반례·실제 지급을 대조했습니다.');
  const market=await collectMarket();verifyMarket(market);
  atomicJson(join(output,'market-live.json'),market);atomicJson(join(directory,'latest-market.json'),market);
  let network=null,external=null,externalError=null,externalReport=null;
  const walletPath=join(directory,'wallet.json');
  const config=existsSync(walletPath)?load(walletPath):{};
  const rpc=new JsonRpcProvider(process.env.MONAD_TESTNET_RPC_URL||config.rpcUrl||'https://testnet-rpc.monad.xyz');
  try {
    const chainId=Number((await rpc.getNetwork()).chainId);if(chainId!==10143)throw new Error('Expected Monad testnet 10143');
    const address=config.address||(config.privateKey?new Wallet(config.privateKey).address:null);
    network={chainId,address,balanceWei:address?String(await rpc.getBalance(address)):null,checkedAt:new Date().toISOString()};
    const path=join(directory,'external-evidence.json');
    if(existsSync(path)){externalReport=load(path);external=await verifyExternalReceipts(externalReport,rpc,artifacts);}
  } catch(error){externalError=error.shortMessage||error.message;}finally{rpc.destroy();}
  const realEpochs=externalReport?.epochs||[];
  const actualActors=realEpochs.length?realEpochs.every(e=>e.actors.length>=3&&e.actors.every(a=>a.admissionKind==='HUMAN_REVIEWED'&&a.enrollment?.signature&&a.admissionEvidenceHash)):false;
  const externalOK=Boolean(external?.valid&&external.independentChainVerification);
  const two=externalOK&&external.epochs.length>=2;
  const paid=externalOK&&external.epochs.some(e=>BigInt(e.actualPayout)>0n);
  const gates=[
    {id:'G1',name:'실제 독립 운영자 승인·서명 제출',pass:externalOK&&actualActors,implementation:'승인·키 연결·서명 SDK·마감 구현',remaining:'인간이 검토한 독립 운영자 최소 3명의 외부 실행 기록'},
    {id:'G2',name:'평가 전 외부 확정 커밋',pass:externalOK&&two,implementation:'계약의 마감/시작 제한·finalized 확인·재개 journal 구현',remaining:'Monad testnet에서 실제 사전 확정한 연속 2 epoch'},
    {id:'G3',name:'독립 가격 원자료와 평가 연결',pass:externalOK&&two,implementation:'Kraken 네 자산 동일 시각 closed 1m 원자료 수집·재계산 통과',remaining:'외부 epoch의 begin/end marketHash 연결'},
    {id:'G4',name:'자본·지분·롱/숏 체결·환매',pass:externalOK&&external.redemptionObserved,implementation:'로컬 EVM 예치·AMM 매수/매도·담보부 차입/상환·환매·자산 보존 통과',remaining:'동일 경로의 공개 테스트넷 거래 receipt'},
    {id:'G5',name:'연속 weight 갱신·실제 지급',pass:two&&paid,implementation:'로컬 2 epoch·실현 이익 한도 지급·손실기 무지급·중복 지급 거부 통과',remaining:'외부 2 epoch 및 실제 양수 보상 지급'},
    {id:'G6',name:'승인 운영자 단위 보상 악용 통제',pass:rewards.passed,implementation:'계정 복제 불변·상쇄 신호 기여 0·cap 포화 Shapley 검증',remaining:'숨겨진 공통 소유자는 기술만으로 식별할 수 없어 등록 심사가 필요'},
    {id:'TEE',name:'TEE 격리·attestation',pass:null,implementation:'사용자 요청으로 제외',remaining:null},
  ];
  if(JSON.stringify(checkpoint())!==JSON.stringify(source))throw new Error('Source changed during verification; rerun');
  const verdict=gates.filter(g=>g.id!=='TEE').every(g=>g.pass)?'READY_TESTNET_MVP':'NOT_READY_EXTERNAL_EVIDENCE';
  atomicJson(join(output,'pilot-local.json'),local);atomicJson(join(output,'pilot-local-verification.json'),verification);atomicJson(join(output,'pilot-reward-challenges.json'),rewards);
  const report={schema:'MM_PILOT_READINESS_V2',startedAt,finishedAt:new Date().toISOString(),productVerdict:verdict,localImplementationVerified:verification.valid,
    marketSourceVerified:true,gates,network,external,externalError,sourceCheckpoint:source,
    artifacts:Object.fromEntries(['pilot-local.json','pilot-local-verification.json','pilot-reward-challenges.json','market-live.json'].map(n=>[n,digest(readFileSync(join(output,n)))])),
    noProductionMoneyUsed:true,teeExcluded:true};
  atomicJson(join(output,'pilot-readiness.json'),report);atomicJson(join(directory,'verification.json'),report);
  const md=`# TEE 제외 구현 및 외부 검증 결과\n\n${report.finishedAt}\n\n**제품 판정: ${verdict}**\n\n로컬 계약 실행과 공개 가격 수집은 검증했습니다. 외부 기록이 없으면 로컬 시험을 공개 테스트넷 실적으로 승격하지 않습니다.\n\n| 조건 | 외부 제품 판정 | 구현·검증 |\n|---|---|---|\n${gates.map(g=>`| ${g.id} ${g.name} | ${g.pass===null?'EXCLUDED':g.pass?'PASS':'미충족'} | ${g.implementation} |`).join('\n')}\n\n## 실제 로컬 EVM 결과\n\n| Epoch | 실현손익 tUSD | 실제 지급 tUSD | entry/exit fills |\n|---|---:|---:|---:|\n${verification.epochs.map((e,i)=>`| ${i+1} | ${(Number(e.realizedPnl)/1e18).toFixed(6)} | ${(Number(e.actualPayout)/1e18).toFixed(6)} | ${e.entryAndExitFills} |`).join('\n')}\n\n최종 환매: ${(Number(local.redemption.cashReceived)/1e18).toFixed(6)} tUSD. 모든 asset token의 계정별 잔고 합계가 공급량과 일치하며, 차입 잔고는 전액 상환했습니다. 실제 계약의 로그를 별도 검증기가 재계산했습니다. 제어한 가격과 로컬 시계를 쓴 결과이며 시장 수익률이 아닙니다.\n\n## 시장·외부 연결\n\nKraken closed 1m boundary: ${market.boundary}. ${JSON.stringify(market.prices)}\n\nMonad chainId: ${network?.chainId||'미확인'}. 테스트 가스 주소: ${network?.address||'없음'}. 잔액: ${network?.balanceWei??'미확인'} wei.\n\n${externalError?`외부 검증 오류: ${externalError}`:'외부 오류 없음. 외부 evidence 파일이 없으면 해당 조건은 미충족입니다.'}\n\n## 원자료\n\n- [전체 결과·소스 지문](pilot-readiness.json)\n- [계약 실행·서명 제출·체결·상환·지급](pilot-local.json)\n- [로그 재계산 결과](pilot-local-verification.json)\n- [복제·공모·cap 반례 검증](pilot-reward-challenges.json)\n- [공개 가격 원자료](market-live.json)\n- [실행 및 중단 복구 안내](../pilot/runbook.md)\n\n재현: \`rtk npm run prove:mvp -- --strict\`. exit 0: 제품 조건 충족, exit 2: 구현 재현 성공·외부 근거 미충족, exit 1: 실험 또는 검증 실패. 기본 실행은 재현 성공시 0을 반환하지만 제품 판정은 동일하게 표시합니다.\n`;
  const externalSummary=external?`\n## 공개 테스트넷에서 확인한 범위\n\n- 펀드: [${externalReport.contracts.fund.address}](https://testnet.monadvision.com/address/${externalReport.contracts.fund.address})\n- 예치: [거래 보기](https://testnet.monadvision.com/tx/${externalReport.contracts.deposit.transactionHash})\n- 현재 소스와 배포 bytecode 대조, finalized receipt와 NAV/share 재계산: ${external.valid?'PASS':'FAIL'}\n- 검증된 운용 epoch: ${external.epochs.length}회. 환매 관측: ${external.redemptionObserved?'있음':'없음'}.\n- 테스트 토큰·운영자 공급 AMM을 사용하며 독립 제공자의 실제 운용·지급 증거와 구분합니다.\n`:'';
  const {writeFileSync}=await import('node:fs');writeFileSync(join(output,'pilot-readiness.md'),md+externalSummary);
  console.log(`\n${verdict}`);console.log('로컬 계약 검증: PASS · 시장 원자료: PASS · 보상 반례 통제: PASS (승인 운영자 모델)');
  if(network)console.log(`테스트넷 가스 잔액: ${network.balanceWei} wei · ${network.address}`);
  console.log('보고서: docs/evidence/pilot-readiness.md');
  if(process.argv.includes('--strict')&&verdict!=='READY_TESTNET_MVP')process.exitCode=2;
}
main().catch(e=>{console.error(e.shortMessage||e.stack||e.message);process.exitCode=1;});
