import React, { useEffect, useState } from "react";
import { usePlatform } from "./PlatformContext.jsx";
import {
  DEFAULT_POLICY,
  nextSettlement,
  validatePolicy,
  validateTargets,
} from "../platform/policy.js";
import { money, percent, time, statusLabel } from "./platformModel.js";
import {
  PageTitle,
  Panel,
  Button,
  Empty,
  Link,
  Stat,
  Badge,
  Conditions,
  Modal,
  Plus,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
  navigate,
} from "./PlatformUI.jsx";
import InvestmentPanel from "./InvestmentPanel.jsx";
import ManagerFees from "./ManagerFees.jsx";
import { platformError } from "./platformErrors.js";
const markets = [
  { id: 16, name: "BTC" },
  { id: 32, name: "ETH" },
  { id: 48, name: "SOL" },
  { id: 64, name: "MON" },
];
export function PolicyFields({ value, onChange, fee, onFee }) {
  const change = (field, v) => onChange({ ...value, [field]: v });
  const setPeriod = (v) =>
    onChange({
      ...value,
      settlementPeriodSeconds: v,
      settlementOffsetSeconds: 0,
      withdrawalCutoffSeconds: v === 3600 ? 300 : 3600,
    });
  const utcMinutes = Math.floor(value.settlementOffsetSeconds / 60) % 1440;
  return (
    <>
      <div className="q-form-grid">
        <label className="q-field">
          성과보수 (%)
          <input
            required
            type="number"
            min="0"
            max="20"
            step="0.01"
            value={fee / 100}
            onChange={(e) => onFee(Math.round(Number(e.target.value) * 100))}
          />
          <small>투자자별 최고 평가액을 초과한 이익에 부과합니다.</small>
        </label>
        <label className="q-field">
          최대 레버리지 (배)
          <input
            required
            type="number"
            min="1"
            max="10"
            step="0.01"
            value={value.maxLeverageBps / 10000}
            onChange={(e) =>
              change(
                "maxLeverageBps",
                Math.round(Number(e.target.value) * 10000),
              )
            }
          />
        </label>
        <label className="q-field">
          손절 한도 (%)
          <input
            required
            type="number"
            min="1"
            max="100"
            step="0.01"
            value={value.stopLossBps / 100}
            onChange={(e) =>
              change("stopLossBps", Math.round(Number(e.target.value) * 100))
            }
          />
          <small>운용 시작·재개 시점 기준</small>
        </label>
        <label className="q-field">
          최대 낙폭 한도 (%)
          <input
            required
            type="number"
            min="1"
            max="100"
            step="0.01"
            value={value.maxDrawdownBps / 100}
            onChange={(e) =>
              change("maxDrawdownBps", Math.round(Number(e.target.value) * 100))
            }
          />
        </label>
        <label className="q-field">
          출금 정산 주기
          <select
            aria-label="출금 정산 주기"
            value={value.settlementPeriodSeconds}
            onChange={(e) => setPeriod(Number(e.target.value))}
          >
            <option value="3600">매시간</option>
            <option value="86400">매일</option>
            <option value="604800">매주</option>
            {![3600, 86400, 604800].includes(value.settlementPeriodSeconds) && (
              <option value={value.settlementPeriodSeconds}>
                {value.settlementPeriodSeconds / 3600}시간마다
              </option>
            )}
          </select>
        </label>
        {value.settlementPeriodSeconds === 3600 ? (
          <label className="q-field">
            매시간 정산 시각 (분)
            <input
              required
              type="number"
              min="0"
              max="59"
              value={value.settlementOffsetSeconds / 60}
              onChange={(e) =>
                change("settlementOffsetSeconds", Number(e.target.value) * 60)
              }
            />
          </label>
        ) : (
          <label className="q-field">
            정산 시각 (UTC)
            <input
              required
              type="time"
              value={`${String(Math.floor(utcMinutes / 60)).padStart(2, "0")}:${String(utcMinutes % 60).padStart(2, "0")}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                change(
                  "settlementOffsetSeconds",
                  Math.floor(value.settlementOffsetSeconds / 86400) * 86400 +
                    h * 3600 +
                    m * 60,
                );
              }}
            />
            <small>아래 예정 시각은 내 시간대로 표시됩니다.</small>
          </label>
        )}
        {value.settlementPeriodSeconds === 604800 && (
          <label className="q-field">
            정산 요일 (UTC)
            <select
              value={Math.floor(value.settlementOffsetSeconds / 86400)}
              onChange={(e) =>
                change(
                  "settlementOffsetSeconds",
                  Number(e.target.value) * 86400 + utcMinutes * 60,
                )
              }
            >
              {[
                "목요일",
                "금요일",
                "토요일",
                "일요일",
                "월요일",
                "화요일",
                "수요일",
              ].map((day, i) => (
                <option key={day} value={i}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="q-field">
          출금 신청 마감 (정산 몇 분 전)
          <input
            required
            type="number"
            min="0"
            max={value.settlementPeriodSeconds / 60 - 1}
            value={value.withdrawalCutoffSeconds / 60}
            onChange={(e) =>
              change(
                "withdrawalCutoffSeconds",
                Math.round(Number(e.target.value) * 60),
              )
            }
          />
        </label>
      </div>
      <p className="q-callout">
        다음 신청 가능 정산:{" "}
        {time(nextSettlement(value, Math.floor(Date.now() / 1000)))} · 신청 마감{" "}
        {value.withdrawalCutoffSeconds / 60}분 전
      </p>
      <details className="q-advanced">
        <summary>고급 주문 설정</summary>
        <div className="q-form-grid">
          <label className="q-field">
            주문 유효 시간 (초)
            <input
              required
              type="number"
              min="15"
              max="300"
              value={value.orderTtlSeconds}
              onChange={(e) =>
                change("orderTtlSeconds", Number(e.target.value))
              }
            />
          </label>
          <label className="q-field">
            허용 슬리피지 (%)
            <input
              required
              type="number"
              min="0.01"
              max="1"
              step="0.01"
              value={value.slippageBps / 100}
              onChange={(e) =>
                change("slippageBps", Math.round(Number(e.target.value) * 100))
              }
            />
          </label>
        </div>
      </details>
    </>
  );
}
function Profile() {
  const p = usePlatform(),
    [form, setForm] = useState({
      displayName: p.session?.strategist?.display_name || "",
      bio: p.session?.strategist?.bio || "",
    });
  return (
    <>
      <PageTitle
        eyebrow="PROFILE"
        title="공개 프로필"
        description="투자자가 확인할 이름과 소개를 작성하세요."
      />
      <Panel className="q-form-panel">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            p.run(async () => {
              await p.request("/v1/strategists", {
                token: p.session.sessionToken,
                body: form,
              });
              await p.refreshAccount();
              p.notify("프로필을 저장했습니다.");
            });
          }}
        >
          <label className="q-field">
            공개 이름
            <input
              required
              minLength={2}
              maxLength={60}
              value={form.displayName}
              onChange={(e) =>
                setForm({ ...form, displayName: e.target.value })
              }
            />
          </label>
          <label className="q-field">
            소개
            <textarea
              aria-label="소개"
              required
              minLength={2}
              maxLength={500}
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
          </label>
          <Button disabled={p.busy}>프로필 저장</Button>
        </form>
      </Panel>
    </>
  );
}
function ApiKeys() {
  const p = usePlatform(),
    [keys, setKeys] = useState(null),
    [fresh, setFresh] = useState(null),
    [revoke, setRevoke] = useState(null),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  const refresh = () =>
    p
      .request("/v1/api-keys", { token: p.session.sessionToken })
      .then((j) => {
        setKeys(j.keys);
        setError("");
      })
      .catch((e) => setError(platformError(e)));
  useEffect(() => {
    refresh();
  }, []);
  return (
    <>
      <PageTitle
        eyebrow="DEVELOPER"
        title="API 연동"
        description="외부 프로그램에서 암호화된 목표 비중을 원하는 때 제출하세요."
        action={
          <Button
            disabled={p.busy || !p.session.strategist}
            onClick={() =>
              p.run(async () => {
                const key = await p.request("/v1/api-keys", {
                  token: p.session.sessionToken,
                  body: {},
                });
                setFresh(key);
                setCopied(false);
                await refresh();
              })
            }
          >
            <Plus size={16} />
            토큰 발급
          </Button>
        }
      />
      {!p.session.strategist && (
        <Panel>
          <p>토큰 발급 전에 공개 프로필을 등록해 주세요.</p>
          <Link to="/manage/profile" className="q-text-link">
            프로필 등록 <ArrowRight size={15} />
          </Link>
        </Panel>
      )}
      {error && (
        <p role="alert" className="q-error">
          {error}
          <button onClick={refresh}>다시 시도</button>
        </p>
      )}
      <Panel>
        <h2>내 API 토큰</h2>
        {keys === null ? (
          <p className="q-space q-muted">불러오는 중…</p>
        ) : keys.length ? (
          <div className="q-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>토큰</th>
                  <th>발급일</th>
                  <th>마지막 사용</th>
                  <th>상태</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.key_prefix}…</td>
                    <td>{time(k.created_at)}</td>
                    <td>{time(k.last_used_at)}</td>
                    <td>
                      {k.revoked_at
                        ? "폐기됨"
                        : k.expires_at && Date.parse(k.expires_at) < Date.now()
                          ? "만료됨"
                          : "활성"}
                    </td>
                    <td>
                      <button
                        className="q-text-link"
                        disabled={p.busy || !!k.revoked_at}
                        onClick={() => setRevoke(k)}
                      >
                        폐기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="발급된 토큰이 없습니다"
            description="웹에서는 로그인으로 운용할 수 있습니다. 외부 프로그램을 연결할 때 토큰을 발급하세요."
          />
        )}
      </Panel>
      <Panel>
        <h2>목표 제출 연결</h2>
        <ol className="q-instructions">
          <li>
            API 토큰을 로컬 환경 변수 <code>MMQ_API_TOKEN</code>에 저장합니다.
          </li>
          <li>
            전략 ID와 전체 목표 비중 벡터를 준비합니다. 음수 비중은 숏이며
            생략한 자산은 0%로 정리됩니다.
          </li>
          <li>
            아래 CLI는 설정을 조회하고 비중을 암호화해 TEE로 직접 전송합니다.
          </li>
          <li>전략의 실행 내역에서 접수와 체결 결과를 확인합니다.</li>
        </ol>
        <pre>
          <code>
            {
              '[{"market":16,"weightBps":5000},{"market":32,"weightBps":-2000}]\n\nnode scripts/submit-strategy.mjs STRATEGY_ID targets.json'
            }
          </code>
        </pre>
        <p className="q-muted">
          BTC 16 · ETH 32 · SOL 48 · MON 64 / 5000 bps = 50% 노출
        </p>
        <Link to="/manage" className="q-text-link">
          전략 ID 확인하기 <ArrowRight size={15} />
        </Link>
      </Panel>
      {fresh && (
        <Modal title="API 토큰 발급 완료" onClose={() => setFresh(null)}>
          <p className="q-muted">
            전체 토큰은 이 화면에서만 확인할 수 있습니다. 복사해 보관하세요.
          </p>
          <label className="q-field">
            새 API 토큰
            <input readOnly value={fresh.apiKey} />
          </label>
          <Button
            onClick={() =>
              p.run(async () => {
                await navigator.clipboard.writeText(fresh.apiKey);
                setCopied(true);
              })
            }
          >
            {copied ? "복사 완료" : "토큰 복사"}
          </Button>
          <Button secondary onClick={() => setFresh(null)}>
            닫기
          </Button>
        </Modal>
      )}
      {revoke && (
        <Modal
          title="API 토큰을 폐기할까요?"
          busy={p.busy}
          onClose={() => setRevoke(null)}
        >
          <p>
            이 토큰을 사용하는 외부 프로그램은 더 이상 목표를 제출할 수
            없습니다.
          </p>
          <Button
            disabled={p.busy}
            onClick={() =>
              p.run(async () => {
                await p.request(`/v1/api-keys/${revoke.id}/revoke`, {
                  token: p.session.sessionToken,
                  body: {},
                });
                setRevoke(null);
                await refresh();
                p.notify("토큰을 폐기했습니다.");
              })
            }
          >
            폐기 확인
          </Button>
        </Modal>
      )}
    </>
  );
}
function NewStrategy() {
  const p = usePlatform(),
    [step, setStep] = useState(0),
    [form, setForm] = useState({
      slug: "",
      name: "",
      description: "",
      risk: "MEDIUM",
      feeBps: 2000,
      policy: { ...DEFAULT_POLICY },
    }),
    [profile, setProfile] = useState({
      displayName: p.session.strategist?.display_name || "",
      bio: p.session.strategist?.bio || "",
    });
  const labels = ["공개 프로필", "전략 소개", "운용 조건", "확인·등록"];
  const submit = (e) => {
    e.preventDefault();
    p.run(async () => {
      if (step === 0) {
        await p.request("/v1/strategists", {
          token: p.session.sessionToken,
          body: profile,
        });
        await p.refreshAccount();
      }
      if (step === 2) validatePolicy(form.policy);
      if (step < 3) {
        setStep(step + 1);
        return;
      }
      const s = await p.request("/v1/strategies", {
        token: p.session.sessionToken,
        body: form,
      });
      await p.refreshAccount();
      await p.refreshCatalog();
      p.notify("전략을 등록했습니다. 자기자본 입금과 API 연동을 준비하세요.");
      navigate(`/manage/${s.id}`);
    });
  };
  return (
    <>
      <Link to="/manage" className="q-text-link q-back">
        ← 내 전략
      </Link>
      <PageTitle
        eyebrow="NEW STRATEGY"
        title="내 전략 만들기"
        description="전략과 공개 운용 조건을 등록하고 자기자본으로 시작하세요."
      />
      <ol className="q-stepper">
        {labels.map((label, i) => (
          <li
            key={label}
            className={i === step ? "active" : i < step ? "complete" : ""}
          >
            <span>{i < step ? <CheckCircle2 size={15} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <Panel className="q-form-panel">
        <form onSubmit={submit}>
          <h2>{labels[step]}</h2>
          {step === 0 ? (
            <>
              <label className="q-field">
                공개 이름
                <input
                  required
                  minLength={2}
                  maxLength={60}
                  value={profile.displayName}
                  onChange={(e) =>
                    setProfile({ ...profile, displayName: e.target.value })
                  }
                />
              </label>
              <label className="q-field">
                소개
                <textarea
                  aria-label="소개"
                  required
                  minLength={2}
                  maxLength={500}
                  value={profile.bio}
                  onChange={(e) =>
                    setProfile({ ...profile, bio: e.target.value })
                  }
                />
              </label>
            </>
          ) : step === 1 ? (
            <>
              <label className="q-field">
                전략명
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="q-field">
                전략 주소 이름
                <input
                  required
                  pattern="[a-z][a-z0-9-]{2,47}"
                  minLength={3}
                  maxLength={48}
                  placeholder="btc-momentum"
                  value={form.slug}
                  onChange={(e) =>
                    setForm({ ...form, slug: e.target.value.toLowerCase() })
                  }
                />
                <small>투자자에게 공유할 링크에 사용됩니다.</small>
              </label>
              <label className="q-field">
                전략 설명
                <textarea
                  aria-label="전략 설명"
                  required
                  minLength={2}
                  maxLength={500}
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </label>
              <label className="q-field">
                공개 위험 분류
                <select
                  value={form.risk}
                  onChange={(e) => setForm({ ...form, risk: e.target.value })}
                >
                  <option value="LOW">낮음</option>
                  <option value="MEDIUM">보통</option>
                  <option value="HIGH">높음</option>
                </select>
                <small>
                  전략가가 선택하는 분류입니다. 위험 한도와 함께 공개됩니다.
                </small>
              </label>
            </>
          ) : step === 2 ? (
            <PolicyFields
              value={form.policy}
              onChange={(policy) => setForm({ ...form, policy })}
              fee={form.feeBps}
              onFee={(feeBps) => setForm({ ...form, feeBps })}
            />
          ) : (
            <>
              <div className="q-review">
                <Badge>등록 후 공개</Badge>
                <h3>{form.name}</h3>
                <p>{form.description}</p>
                <p className="q-muted">
                  전략가 {profile.displayName} · /strategies/{form.slug}
                </p>
              </div>
              <Conditions policy={form.policy} feeBps={form.feeBps} />
              <p className="q-callout">
                운용 조건과 성과, 자기자본은 공개됩니다. 목표 비중과 투자자별
                배분은 비공개로 관리됩니다.
              </p>
            </>
          )}
          <div className="q-row q-space">
            {step > 0 ? (
              <Button
                type="button"
                secondary
                disabled={p.busy}
                onClick={() => setStep(step - 1)}
              >
                이전 단계
              </Button>
            ) : (
              <span />
            )}
            <Button disabled={p.busy}>
              {step === 3 ? "전략 등록" : "다음 단계"}
              <ArrowRight size={16} />
            </Button>
          </div>
        </form>
      </Panel>
    </>
  );
}
function StrategyWorkspace({ strategy }) {
  const p = usePlatform(),
    [tab, setTab] = useState("overview"),
    [status, setStatus] = useState(null),
    [statusError, setStatusError] = useState(""),
    [weights, setWeights] = useState(
      Object.fromEntries(markets.map((m) => [m.id, "0"])),
    ),
    [confirm, setConfirm] = useState(false),
    [resume, setResume] = useState(false),
    [policy, setPolicy] = useState(strategy.policy),
    [fee, setFee] = useState(strategy.fee_bps),
    [policyConfirm, setPolicyConfirm] = useState(false),
    [capital, setCapital] = useState(false);
  const publicStrategy = p.strategies.find((s) => s.id === strategy.id),
    m = publicStrategy?.public_metrics;
  const readStatus = async () => {
    try {
      const result = await p.managerRequest(strategy.id, "STATUS");
      setStatus(result);
      setStatusError("");
      return result;
    } catch (e) {
      setStatusError(platformError(e));
      throw e;
    }
  };
  useEffect(() => {
    if (!p.config?.teeEndpoint || !p.config?.teeEncryptionPublicKey) return;
    let active = true;
    const poll = () =>
      p
        .managerRequest(strategy.id, "STATUS")
        .then((j) => {
          if (active) {
            setStatus(j);
            setStatusError("");
          }
        })
        .catch((e) => {
          if (active) setStatusError(platformError(e));
        });
    poll();
    const timer = setInterval(poll, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [
    strategy.id,
    p.config?.teeEndpoint,
    p.config?.teeEncryptionPublicKey,
    p.session?.sessionToken,
  ]);
  const gross = Object.values(weights).reduce(
      (a, v) => a + Math.abs(Number(v)),
      0,
    ),
    valid =
      Object.values(weights).every(
        (v) => v.trim() !== "" && Number.isFinite(Number(v)),
      ) && gross <= policy.maxLeverageBps / 100;
  const queue = status?.requests.some((r) =>
    ["QUEUED", "EXECUTING"].includes(r.status),
  );
  const submit = () =>
    p.run(async () => {
      const current = await readStatus();
      const targets = markets
        .map((m) => ({
          market: m.id,
          weightBps: Math.round(Number(weights[m.id]) * 100),
        }))
        .filter((t) => t.weightBps !== 0);
      validateTargets(targets, strategy.policy);
      await p.managerRequest(strategy.id, "TARGET", {
        targets,
        requestId: crypto.randomUUID(),
        sequence: current.sequence + 1,
      });
      setConfirm(false);
      setTab("activity");
      await readStatus();
      p.notify(
        "목표 비중을 접수했습니다. 실행 내역에서 실제 결과를 확인하세요.",
      );
    });
  return (
    <>
      <Link to="/manage" className="q-text-link q-back">
        ← 내 전략
      </Link>
      <PageTitle
        eyebrow="STRATEGY WORKSPACE"
        title={strategy.name}
        description="성과를 확인하고 목표 비중과 운용 조건을 관리하세요."
        action={
          <Link
            className="q-button secondary"
            to={`/strategies/${strategy.slug}`}
          >
            공개 페이지 <ArrowRight size={16} />
          </Link>
        }
      />
      <div className="q-tabs" role="tablist" aria-label="전략 관리">
        {[
          ["overview", "개요"],
          ["targets", "목표 제출"],
          ["activity", "실행 내역"],
          ["policy", "운용 조건"],
          ["api", "API 연동"],
        ].map(([id, label]) => (
          <button
            role="tab"
            id={`q-tab-button-${id}`}
            aria-controls={`q-tab-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onKeyDown={(event) => {
              const ids = ["overview", "targets", "activity", "policy", "api"];
              let index = ids.indexOf(id);
              if (event.key === "ArrowRight") index = (index + 1) % ids.length;
              else if (event.key === "ArrowLeft")
                index = (index + ids.length - 1) % ids.length;
              else if (event.key === "Home") index = 0;
              else if (event.key === "End") index = ids.length - 1;
              else return;
              event.preventDefault();
              setTab(ids[index]);
              document.getElementById(`q-tab-button-${ids[index]}`)?.focus();
            }}
            aria-selected={tab === id}
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {statusError && (
        <div role="alert" className="q-notice error">
          <span>운용 상태·성과보수 조회 지연 · {statusError}</span>
          <button onClick={() => p.run(readStatus)}>다시 조회</button>
        </div>
      )}
      <div
        role="tabpanel"
        id={`q-tab-panel-${tab}`}
        aria-labelledby={`q-tab-button-${tab}`}
      >
        {tab === "overview" ? (
          <>
            <div className="q-stats">
              <Stat label="누적 수익률" value={percent(m?.pnlBps)} />
              <Stat
                label="자기자본 운용"
                value={money(m?.managerActive)}
                suffix="AUSD"
              />
              <Stat
                label="자기자본 대기"
                value={money(m?.managerPending)}
                suffix="AUSD"
              />
            </div>
            <Panel>
              <div className="q-row">
                <h2>운용 준비와 다음 행동</h2>
                <Badge tone={status?.status === "HALTED" ? "warning" : ""}>
                  {status ? statusLabel(status.status) : "상태 확인 중"}
                </Badge>
              </div>
              <div className="q-next-actions">
                <button onClick={() => setCapital(true)}>
                  <strong>자기자본 추가</strong>
                  <span>대기 자금으로 입금하고 다음 제출부터 운용</span>
                  <ArrowRight size={18} />
                </button>
                <button onClick={() => setTab("targets")}>
                  <strong>목표 비중 제출</strong>
                  <span>원하는 때 전체 목표를 제출</span>
                  <ArrowRight size={18} />
                </button>
                <button onClick={() => setTab("api")}>
                  <strong>프로그램 연결</strong>
                  <span>API 토큰과 암호화 제출 예제 확인</span>
                  <ArrowRight size={18} />
                </button>
              </div>
            </Panel>
            <ManagerFees
              fees={status?.performanceFees}
              loaded={Boolean(status)}
              stale={Boolean(statusError)}
              busy={p.busy}
              onRefresh={() => p.run(readStatus)}
            />
            <Panel>
              <h2>공개 운용 조건</h2>
              <Conditions policy={strategy.policy} feeBps={strategy.fee_bps} />
            </Panel>
          </>
        ) : tab === "targets" ? (
          <Panel className="q-form-panel">
            <h2>새 목표 비중</h2>
            <p className="q-muted q-space">
              순자산 대비 목표 노출입니다. 음수는 숏이며, 이번 전체 벡터로 기존
              목표를 교체합니다. 0%인 자산은 포지션을 정리합니다.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setConfirm(true);
              }}
            >
              <div className="q-targets">
                {markets.map((m) => (
                  <label className="q-field" key={m.id}>
                    {m.name} 목표 비중 (%)
                    <input
                      required
                      type="number"
                      step="0.01"
                      aria-label={`${m.name} 목표 비중 (%)`}
                      value={weights[m.id]}
                      onChange={(e) =>
                        setWeights({ ...weights, [m.id]: e.target.value })
                      }
                    />
                    <small>
                      {Number(weights[m.id]) < 0
                        ? "숏"
                        : Number(weights[m.id]) > 0
                          ? "롱"
                          : "포지션 정리"}
                    </small>
                  </label>
                ))}
              </div>
              <div className="q-callout">
                총 노출 {gross.toFixed(2)}% / 한도{" "}
                {strategy.policy.maxLeverageBps / 100}%
              </div>
              {!valid && (
                <p role="alert" className="q-error">
                  유효한 비중을 입력하고 총 노출 한도 내로 조정하세요.
                </p>
              )}
              <p className="q-muted q-space">
                대기 자금은 이번 제출 과정에서 운용에 편입됩니다. Perpl 계정
                최초 생성에는 최소 100 AUSD가 필요합니다. 기존 계정 사용 시에도
                주문에 필요한 담보가 있어야 합니다.
              </p>
              <Button
                disabled={
                  p.busy ||
                  !valid ||
                  !status ||
                  queue ||
                  status.status !== "ACTIVE"
                }
              >
                {queue
                  ? "이전 요청 처리 중"
                  : status?.status === "HALTED"
                    ? "운용 중단 상태"
                    : "제출 내용 확인"}
              </Button>
            </form>
          </Panel>
        ) : tab === "activity" ? (
          <Panel>
            <div className="q-row">
              <h2>실행 내역</h2>
              <Button
                secondary
                disabled={p.busy}
                onClick={() => p.run(readStatus)}
              >
                <RefreshCw size={16} />
                새로고침
              </Button>
            </div>
            <p className="q-muted q-space">
              10초마다 조회합니다. 접수와 실행 확인은 체결 완료를 의미하지
              않습니다.
            </p>
            {status?.reconciliationError && (
              <p className="q-callout">
                {platformError(status.reconciliationError)}
              </p>
            )}
            {status?.valuationError && (
              <p className="q-callout">
                현재 평가 정보 조회가 지연되고 있습니다. 새로운 평가액으로
                오인하지 않도록 최신 상태를 확인하세요.
              </p>
            )}
            {status?.requests.length ? (
              <div className="q-activity-list">
                {[...status.requests]
                  .sort((a, b) => b.sequence - a.sequence)
                  .map((r) => (
                    <div key={r.id}>
                      <div className="q-row">
                        <strong>목표 제출 #{r.sequence}</strong>
                        <Badge tone={r.status === "FAILED" ? "warning" : ""}>
                          {statusLabel(r.status)}
                        </Badge>
                      </div>
                      <p className="q-muted">{time(r.createdAt)}</p>
                      {r.error && (
                        <p className="q-callout">{platformError(r.error)}</p>
                      )}
                      {["QUEUED", "EXECUTING"].includes(r.status) && (
                        <p className="q-muted">
                          확인 중입니다. 같은 목표를 다시 제출하지 마세요.
                        </p>
                      )}
                    </div>
                  ))}
              </div>
            ) : (
              <Empty
                title="아직 제출 내역이 없습니다"
                description="자기자본을 입금한 뒤 첫 목표 비중을 제출하세요."
                action={
                  <Button secondary onClick={() => setTab("targets")}>
                    목표 제출하기
                  </Button>
                }
              />
            )}{" "}
            {status?.status === "HALTED" && (
              <Button onClick={() => setResume(true)} disabled={p.busy}>
                운용 재개 확인
              </Button>
            )}
          </Panel>
        ) : tab === "policy" ? (
          <>
            <Panel>
              <h2>현재 공개 조건</h2>
              <Conditions policy={strategy.policy} feeBps={strategy.fee_bps} />
            </Panel>
            {strategy.pending_policy ? (
              <Panel>
                <h2>변경 예고 중</h2>
                <p className="q-space">
                  {time(strategy.pending_policy.effectiveAfter)} 이후 기존 출금
                  정산이 완료되면 적용됩니다.
                </p>
                <Conditions
                  policy={strategy.pending_policy.policy}
                  feeBps={strategy.pending_policy.feeBps}
                />
              </Panel>
            ) : (
              <Panel className="q-form-panel">
                <h2>운용 조건 변경</h2>
                <p className="q-muted q-space">
                  변경은 즉시 적용되지 않습니다. 투자자에게 사전 공개하고 기존
                  출금 기회를 제공합니다.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    p.run(async () => {
                      validatePolicy(policy);
                      setPolicyConfirm(true);
                    });
                  }}
                >
                  <PolicyFields
                    value={policy}
                    onChange={setPolicy}
                    fee={fee}
                    onFee={setFee}
                  />
                  <Button disabled={p.busy}>변경 내용 비교</Button>
                </form>
              </Panel>
            )}
          </>
        ) : (
          <Panel>
            <h2>이 전략을 프로그램에 연결</h2>
            <label className="q-field">
              전략 ID
              <input readOnly value={strategy.id} />
            </label>
            <Button
              secondary
              onClick={() =>
                p.run(async () => {
                  await navigator.clipboard.writeText(strategy.id);
                  p.notify("전략 ID를 복사했습니다.");
                })
              }
            >
              ID 복사
            </Button>
            <p className="q-space q-muted">
              API 토큰 발급과 제출 예제는 공통 API 연동 화면에서 관리합니다.
            </p>
            <Link className="q-button" to="/manage/api">
              API 연동 열기 <ArrowRight size={16} />
            </Link>
          </Panel>
        )}
      </div>
      {capital && (
        <Modal
          title="자기자본 추가"
          busy={p.busy}
          onClose={() => setCapital(false)}
        >
          <InvestmentPanel strategy={publicStrategy || strategy} manager />
        </Modal>
      )}
      {confirm && (
        <Modal
          title={
            gross === 0 ? "전체 포지션을 정리할까요?" : "목표 비중 제출 확인"
          }
          busy={p.busy}
          onClose={() => setConfirm(false)}
        >
          <div className="q-definition">
            {markets.map((m) => (
              <div key={m.id}>
                <dt>{m.name}</dt>
                <dd>{weights[m.id]}%</dd>
              </div>
            ))}
          </div>
          <p className="q-callout">
            전체 목표를 교체합니다. 0%인 자산은 정리하며 대기 자금은 이번 운용에
            편입됩니다.
          </p>
          {p.message?.error && (
            <p className="q-error" role="alert">
              {p.message.text}
            </p>
          )}
          <Button disabled={p.busy} onClick={submit}>
            암호화하여 제출
          </Button>
        </Modal>
      )}
      {resume && (
        <Modal
          title="운용을 재개할까요?"
          busy={p.busy}
          onClose={() => setResume(false)}
        >
          <p>
            정리된 상태에서 운용을 재개합니다. 새로운 목표 제출이 필요하며 손절
            기준은 재개 시점으로 설정됩니다.
          </p>
          <Button
            disabled={p.busy}
            onClick={() =>
              p.run(async () => {
                await p.managerRequest(strategy.id, "RESUME");
                await readStatus();
                setResume(false);
                p.notify("운용을 재개했습니다. 새 목표 비중을 제출해 주세요.");
              })
            }
          >
            재개 확인
          </Button>
        </Modal>
      )}
      {policyConfirm && (
        <Modal
          title="운용 조건 변경 확인"
          busy={p.busy}
          onClose={() => setPolicyConfirm(false)}
        >
          <h3>현재 조건</h3>
          <Conditions policy={strategy.policy} feeBps={strategy.fee_bps} />
          <h3>변경할 조건</h3>
          <Conditions policy={policy} feeBps={fee} />
          <p className="q-callout">
            투자자에게 사전 공지되며 기존 출금 정산 이후 적용됩니다.
          </p>
          <Button
            disabled={p.busy}
            onClick={() =>
              p.run(async () => {
                await p.request(`/v1/strategies/${strategy.id}/policy`, {
                  token: p.session.sessionToken,
                  body: { policy, feeBps: fee },
                });
                await p.refreshAccount();
                await p.refreshCatalog();
                setPolicyConfirm(false);
                p.notify("운용 조건 변경을 사전 공지했습니다.");
              })
            }
          >
            변경 예고 공개
          </Button>
        </Modal>
      )}
    </>
  );
}
export default function ManagerConsole({ path }) {
  const p = usePlatform();
  if (!p.session)
    return (
      <>
        <PageTitle
          title="내 전략"
          description="내 자본으로 성과를 쌓고 투자자를 만나세요."
        />
        <Panel>
          <Empty
            title="로그인하고 전략을 관리하세요"
            description="한 계정으로 투자와 전략 운용을 함께 할 수 있습니다."
            action={
              <Button disabled={p.busy || !p.config} onClick={p.login}>
                지갑으로 로그인
              </Button>
            }
          />
        </Panel>
      </>
    );
  if (path === "/manage/profile") return <Profile key={p.session.wallet} />;
  if (path === "/manage/api") return <ApiKeys />;
  if (path === "/manage/new") return <NewStrategy />;
  if (path.startsWith("/manage/")) {
    const strategy = p.owned.find(
      (s) => s.id === path.slice("/manage/".length),
    );
    return strategy ? (
      <StrategyWorkspace key={strategy.id} strategy={strategy} />
    ) : (
      <Empty
        title="내 전략을 찾을 수 없습니다"
        description="소유 전략 목록에서 다시 선택해 주세요."
        action={
          <Link to="/manage" className="q-button">
            내 전략 목록
          </Link>
        }
      />
    );
  }
  return (
    <>
      <PageTitle
        eyebrow="MY STRATEGIES"
        title="내 전략"
        description="자기자본과 운용 현황을 확인하고 전략을 관리하세요."
        action={
          <Link className="q-button" to="/manage/new">
            <Plus size={16} />
            전략 만들기
          </Link>
        }
      />
      <div className="q-row q-manager-links">
        <Link className="q-text-link" to="/manage/profile">
          공개 프로필 관리
        </Link>
        <Link className="q-text-link" to="/manage/api">
          API 토큰과 프로그램 연동 <ArrowRight size={16} />
        </Link>
      </div>
      {p.owned.length ? (
        <div className="q-strategy-grid">
          {p.owned.map((s) => {
            const m = p.strategies.find((x) => x.id === s.id)?.public_metrics;
            return (
              <Panel key={s.id}>
                <div className="q-row">
                  <h2>{s.name}</h2>
                  <Badge>{statusLabel(m?.status || s.status)}</Badge>
                </div>
                <p className="q-muted q-space">{s.description}</p>
                <div className="q-position-stats">
                  <Stat label="누적 수익률" value={percent(m?.pnlBps)} />
                  <Stat
                    label="자기자본"
                    value={money(m?.managerActive)}
                    suffix="AUSD"
                  />
                </div>
                <Link className="q-button secondary" to={`/manage/${s.id}`}>
                  전략 관리 <ArrowRight size={16} />
                </Link>
              </Panel>
            );
          })}
        </div>
      ) : (
        <Panel>
          <Empty
            title="첫 전략을 만들어 보세요"
            description="소개와 공개 조건을 등록하고 자기자본으로 운용을 시작하세요."
            action={
              <Link className="q-button" to="/manage/new">
                전략 만들기 <Plus size={16} />
              </Link>
            }
          />
        </Panel>
      )}
    </>
  );
}
