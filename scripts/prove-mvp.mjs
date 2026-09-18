// Reproduce observations, including failures of the product's claims.
// A successful experiment run is deliberately separate from MVP readiness.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHttpChallenge } from './evidence/http-challenge.mjs';
import { runQuantChallenges } from './evidence/quant-challenges.mjs';
import { runSecurityChallenges } from './evidence/security-challenges.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs/evidence');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]);
function checkpoint() {
  const files = ['src', 'scripts', 'contracts', 'tests'].flatMap(dir => walk(join(root, dir)))
    .filter(path => /\.(?:js|jsx|mjs|css|sol)$/.test(path));
  files.push(...['package.json', 'package-lock.json', 'vite.config.js'].map(path => join(root, path)));
  return Object.fromEntries(files.sort().map(path => [relative(root, path), sha256(readFileSync(path))]));
}
const save = (name, value) => writeFileSync(join(output, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');

// These are explicit reviewer assessments against the original section 25,
// not gates that may be inferred from test counts or a successful CLI exit.
const gates = [
  { id: 'G1', claim: '서로 독립된 실제 provider 3명 이상이 동일 규칙으로 제출', status: 'NOT_DEMONSTRATED', evidence: '독립 client 구현이 만든 4개 fixture key; 실제 독립 참여자 운영 증거 없음' },
  { id: 'G2', claim: '정책·roster·weights·root가 결과 구간 시작 전에 외부에서 확정', status: 'NOT_MET', evidence: 'LOCAL_ONLY receipt와 로컬 EVM. 외부 확정 시각 없음' },
  { id: 'G3', claim: '독립된 가격 출처·상품·관측시각·원자료로 결과 재계산', status: 'NOT_MET', evidence: '통제한 USER_ASSERTED 가격; 잘못된 양수 가격도 접수됨' },
  { id: 'G4', claim: '테스트 자산 예치→shares→venue 체결→잔고/NAV→환매', status: 'NOT_IMPLEMENTED', evidence: 'PAPER 선형 노출, 로컬 shares. 자금 계약/venue fill 없음' },
  { id: 'G5', claim: '평가→다음 weight→테스트 자산 보상→반복 2회 증거', status: 'NOT_MET', evidence: 'weight와 미지급 credit만 구현; 실제 지급 없음' },
  { id: 'G6', claim: '보상에서 동일 운영자의 복제·상반 신호 악용을 통제', status: 'COUNTEREXAMPLE', evidence: '공동 기여 $0인 두 identity에 전체 10,000 credits 배정 재현' },
  { id: 'TEE', claim: '운영자로부터 vector 기밀성', status: 'USER_DEFERRED', evidence: '사용자가 유예한 항목. 위 G1–G6 미충족 판정의 이유가 아님' },
];

async function main() {
  const unknown = process.argv.slice(2).filter(arg => arg !== '--strict');
  assert.equal(unknown.length, 0, `Unknown arguments: ${unknown.join(' ')}`);
  const startedAt = new Date().toISOString();
  const sources = checkpoint();
  console.log('대시보드 없이 실제 HTTP·손계산·변조·보상 반례를 재현합니다. 기존 .data는 사용하지 않습니다.');
  const http = await runHttpChallenge({ progress: message => console.log(message) });
  const quant = await runQuantChallenges();
  console.log('복제·상반 신호·소표본 반례를 재현했습니다.');
  const security = await runSecurityChallenges({ phase: 'after' });
  assert.deepEqual(checkpoint(), sources, '실행 중 코드가 바뀌었습니다. 결과를 묶지 말고 다시 실행하세요.');
  assert.ok(http.checks.every(check => check.pass));
  assert.equal(quant.arithmeticChecks, 'PASS');
  assert.equal(quant.productCounterexamplesReproduced, 3);
  assert.equal(security.observedExpectationsSatisfied, true);
  const binding = security.cases.find(item => item.id === 'sealed-envelope-substitution');
  assert.equal(binding.rejected, true);
  assert.equal(binding.stateUnchangedOnRejection, true);
  const before = JSON.parse(readFileSync(join(output, 'security-challenges-before.json'), 'utf8'));
  const oldBinding = before.cases.find(item => item.id === binding.id);
  assert.equal(oldBinding.rejected, false);
  assert.notEqual(oldBinding.honestNav, oldBinding.substitutedNav);
  mkdirSync(output, { recursive: true });
  save('http-challenge.json', http);
  save('quant-challenges.json', quant);
  save('security-challenges.json', security);
  const evidenceNames = ['http-challenge.json', 'quant-challenges.json', 'security-challenges.json', 'security-challenges-before.json', 'commit-binding-fix.patch'];
  const report = {
    schema: 'MM_MVP_READINESS_EVIDENCE_V1', startedAt, finishedAt: new Date().toISOString(),
    runtime: process.version, platform: process.platform, architecture: process.arch,
    experimentsReproduced: true, productVerdict: 'NOT_READY',
    originalScope: '원본 25절 confidential multi-alpha fund. 사용자 유예: TEE.',
    readinessAssessment: { method: 'MANUAL_ORIGINAL_SPEC_AUDIT_SUPPORTED_BY_REPRODUCED_COUNTEREXAMPLES', gates },
    sourceCheckpoint: { algorithm: 'SHA256', vcsCommit: null, files: sources,
      note: 'Git 이력이 없는 workspace의 파일 지문. 제3자 attestation이나 과거 시각 증명은 아님.' },
    evidenceFiles: Object.fromEntries(evidenceNames.map(name => [name, sha256(readFileSync(join(output, name)))])),
    summary: { httpChecks: http.checks.length, expectedNav: http.oracle.nav, observedNav: http.observed.evaluation.nav,
      bindingBefore: oldBinding, bindingAfter: binding, productCounterexamples: quant.productCounterexamplesReproduced },
    boundaries: { existingUserDataTouched: false, externalTransactions: false, actualMarkets: false,
      independentAuditor: false, note: '별도 구현·적대적 fixture를 사용한 저장소 내부 검증. 독립 기관 감사나 실운용 실적이 아님.' },
  };
  save('mvp-readiness.json', report);
  const summary = `# 재현 실행 결과: NOT_READY

실행: ${startedAt} → ${report.finishedAt} · ${process.version} · ${process.platform}/${process.arch}

실험 재현은 성공했습니다. 원래 합의한 제품의 MVP 조건은 충족하지 못했습니다.

## 직접 확인한 숫자

초기 모의 NAV $100,000. Bull BTC +1, Bear BTC −0.9, Neutral 0, Missing 미제출.
각 weight 10%. BTC $100→$110. 수수료 10bps와 slippage 5bps를 가정했습니다.

| 값 | 손계산 | 실제 HTTP 결과 |
|---|---:|---:|
| 순 BTC 목표 | 100 bps | ${http.checks.find(c => c.id === 'H07').actual} bps |
| 모의 주문 금액 | $1,000 | $${http.observed.execution.turnoverNotional} |
| 비용 | $1.50 | $${http.observed.execution.cost} |
| 최종 NAV | $100,098.50 | $${http.observed.evaluation.nav} |
| Bull standalone NAV | $102,462.50 | $${http.observed.bull.shadowNav} |
| Bear standalone NAV | $97,462.50 | $${http.observed.bear.shadowNav} |

사칭/대체/마감 후 제출/조기 평가/확정 결과 덮어쓰기 거부와 실제 재시작도 포함해 ${http.checks.length}개 관측이 기대와 일치했습니다. 이 숫자는 시장 수익 증거가 아닙니다.

## 무결성 공격

수정 전 DB 암호문을 바꾸면 같은 root/유효 receipt를 유지하면서 NAV가 $${oldBinding.honestNav}에서 $${oldBinding.substitutedNav}로 바뀌었습니다. 수정 후 동일 공격은 HTTP 상태에 대응하는 service 오류 ${binding.rejection.status}로 거부하고 장부를 변경하지 않았습니다.

before JSON은 수정 전 실행 기록입니다. 이번 실행은 after 거부를 다시 검증했습니다. 소스 변경 patch도 함께 보존했습니다. 운영자가 코드·키·DB 전체를 바꾸는 공격까지 막았다는 뜻은 아닙니다.

## 통과하지 못한 제품 주장

* 같은 alpha를 복제하면 한 운영자의 credit이 5,000→6,666으로 증가합니다.
* 동일 신호가 cap에 포화되면 수익 $2,462.50에도 모든 개별 LOO가 0입니다.
* 상반 BTC 신호 두 개의 공동 기여는 $0인데 전체 10,000 credits를 가져갑니다. Fund는 $1,015 손실입니다.
* 방향 표본 하나로 IC=1·적중률=100%가 나옵니다. 장기 역량 증거가 아닙니다.

| 제품 조건 | 상태 | 근거 |
|---|---|---|
${gates.map(g => `| ${g.id}: ${g.claim} | ${g.status} | ${g.evidence} |`).join('\n')}

## 원자료

* [실제 HTTP·원 payload opening·receipt·손계산](http-challenge.json)
* [경제적 반례와 정확한 입력](quant-challenges.json)
* [수정 후 변조 및 신뢰 경계](security-challenges.json)
* [수정 전 공격 기록](security-challenges-before.json) · [수정 patch](commit-binding-fix.patch)
* [실행 소스 지문과 모든 원자료 SHA-256](mvp-readiness.json)
* [원본 요구사항 대비 판정과 작업 배분](../mvp-readiness.md)

재실행: 프로젝트 루트에서 \`rtk npm run prove:mvp\`. 약 20–30초의 실제 대기 시간이 있습니다.
기본 종료 0은 실험 재현 성공, 1은 실행/검증 실패입니다. \`--strict\`는 제품 미충족 때 2를 반환합니다. 원자료가 바뀌면 다음 실행의 시각·ID·root도 바뀝니다.
`;
  save('mvp-readiness.md', summary);
  console.log(`\n실험 재현: 완료 (${http.checks.length} HTTP 관측 일치; 보상 반례 3건 유지)`);
  console.log(`손계산/실측 NAV: ${http.oracle.nav} / ${http.observed.evaluation.nav}`);
  console.log(`봉인 후 암호문 교체: 수정 전 결과 변조 → 수정 후 ${binding.rejection.status} 거부`);
  console.log('제품 판정: NOT_READY (G1–G6 미충족; TEE는 별도 유예)');
  console.log('보고서: docs/evidence/mvp-readiness.md');
  if (process.argv.includes('--strict')) process.exitCode = 2;
}

main().catch(error => { console.error('재현 실행 실패:', error.stack || error.message); process.exitCode = 1; });
