import React, { useEffect, useState } from "react";
import { PlatformProvider, usePlatform } from "./PlatformContext.jsx";
import { platformError } from "./platformErrors.js";
import InvestorPortal, {
  PortfolioSummary,
  PortfolioGate,
} from "./InvestorPortal.jsx";
import ManagerConsole from "./ManagerConsole.jsx";
import InvestmentPanel from "./InvestmentPanel.jsx";
import {
  money,
  percent,
  rate,
  short,
  time,
  riskLabel,
  statusLabel,
  periodReturn,
} from "./platformModel.js";
import { nextSettlement } from "../platform/policy.js";
import {
  Link,
  useRoute,
  PageTitle,
  Panel,
  Stat,
  Button,
  Empty,
  Badge,
  StrategyCard,
  HistoryChart,
  Conditions,
  Home,
  Search,
  Wallet,
  Layers,
  ArrowRight,
  Plus,
  RefreshCw,
  AlertCircle,
  X,
} from "./PlatformUI.jsx";
import "./platform.css";
import "./platform-tokens.css";
const periods = [
  ["1d", "1일"],
  ["7d", "7일"],
  ["30d", "30일"],
  ["all", "전체"],
];
function Dashboard() {
  const p = usePlatform();
  if (!p.session) return <Welcome />;
  const withdrawals = (p.portfolio?.positions || []).flatMap((pos) =>
    (pos.withdrawals || [])
      .filter((w) => ["REQUESTED", "SETTLING"].includes(w.status))
      .map((w) => ({ ...w, strategyId: pos.strategyId })),
  );
  return (
    <>
      <PageTitle
        eyebrow="OVERVIEW"
        title={
          p.session?.strategist
            ? `${p.session.strategist.display_name}님의 대시보드`
            : "내 투자와 전략, 한눈에"
        }
        description="자산 현황을 확인하고 다음 운용을 준비하세요."
        action={
          <Link className="q-button secondary" to="/strategies">
            전략 찾아보기 <ArrowRight size={16} />
          </Link>
        }
      />
      <PortfolioSummary />
      {!p.portfolio ? (
        <Panel>
          <PortfolioGate />
        </Panel>
      ) : (
        <Panel>
          <div className="q-row">
            <h2>내 투자</h2>
            <Link to="/assets" className="q-text-link">
              전체 자산 보기 <ArrowRight size={15} />
            </Link>
          </div>
          {p.portfolio.positions.length ? (
            <div className="q-home-positions">
              {p.portfolio.positions.map((pos) => (
                <Link to="/assets" key={pos.strategyId}>
                  <div>
                    <strong>
                      {p.strategies.find((s) => s.id === pos.strategyId)
                        ?.name || "내 투자 전략"}
                    </strong>
                    <p className="q-muted">
                      {BigInt(pos.pending) > 0n
                        ? `운용 시작 대기 ${money(pos.pending)} AUSD`
                        : statusLabel(pos.status)}
                    </p>
                  </div>
                  <strong>
                    {money(pos.value)} <small>AUSD</small>
                  </strong>
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              title="아직 투자한 전략이 없습니다"
              description="성과와 자기자본을 비교하고 첫 투자를 시작하세요."
              action={
                <Link to="/strategies" className="q-text-link">
                  전략 탐색 <ArrowRight size={15} />
                </Link>
              }
            />
          )}
        </Panel>
      )}
      <Panel>
        <div className="q-row">
          <h2>내 전략</h2>
          <Link className="q-text-link" to="/manage">
            전략 관리 <ArrowRight size={15} />
          </Link>
        </div>
        {p.owned.length ? (
          <div className="q-home-positions">
            {p.owned.map((s) => {
              const m = p.strategies.find((t) => t.id === s.id)?.public_metrics;
              return (
                <Link to={`/manage/${s.id}`} key={s.id}>
                  <div>
                    <strong>{s.name}</strong>
                    <p className="q-muted">
                      자기자본 {money(m?.managerActive)} AUSD · 대기{" "}
                      {money(m?.managerPending)} AUSD
                    </p>
                  </div>
                  <Badge>{statusLabel(m?.status || s.status)}</Badge>
                </Link>
              );
            })}
          </div>
        ) : (
          <Empty
            title="내 자본으로 전략을 시작하세요"
            description="운용 조건을 공개하고 성과를 쌓아 투자자를 만나세요."
            action={
              <Link className="q-button secondary" to="/manage/new">
                <Plus size={16} />첫 전략 만들기
              </Link>
            }
          />
        )}
      </Panel>
      {p.portfolio && (
        <Panel>
          <h2>예정된 출금</h2>
          {withdrawals.length ? (
            withdrawals.map((w) => (
              <div className="q-home-positions" key={w.id}>
                <Link to="/assets">
                  <strong>
                    {p.strategies.find((s) => s.id === w.strategyId)?.name ||
                      "내 투자 전략"}
                  </strong>
                  <span>
                    {time(w.settlementAt)} · {statusLabel(w.status)}
                  </span>
                </Link>
              </div>
            ))
          ) : (
            <p className="q-muted q-space">예정된 출금이 없습니다.</p>
          )}
        </Panel>
      )}
    </>
  );
}
function Welcome() {
  const p = usePlatform();
  const recent = [...p.strategies]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 3);
  return (
    <>
      <section className="q-welcome" aria-labelledby="welcome-title">
        <div className="q-welcome-copy">
          <span className="q-eyebrow">PRIVATE STRATEGIES. OPEN POSSIBILITIES.</span>
          <h1 id="welcome-title">전략의 가능성을,<br /><em>나의 포트폴리오로.</em></h1>
          <p>운용 전략은 비공개로, 성과와 조건은 투명하게.<br />나에게 맞는 전략을 찾고 Monad에서 투자를 시작하세요.</p>
          <div className="q-actions">
            <Link to="/strategies" className="q-button">전략 둘러보기 <ArrowRight size={17} /></Link>
            <Link to="/manage/new" className="q-button secondary">내 전략 만들기</Link>
          </div>
          <span className="q-welcome-note">MONAD TESTNET · 테스트 AUSD를 사용하는 서비스입니다.</span>
        </div>
        <ol className="q-welcome-steps" aria-label="투자 시작 순서">
          {[
            ["01", "비교하고 선택", "수익률, 위험 한도, 전략가 자기자본을 함께 확인하세요."],
            ["02", "지갑 연결 후 입금", "입금한 자금은 운용 시작 전까지 대기 자금으로 표시됩니다."],
            ["03", "운용과 자산 확인", "전략가의 다음 목표 제출부터 운용되며, 출금은 정해진 일정에 정산됩니다."],
          ].map(([number, title, text]) => <li key={number}><span>{number}</span><div><h2>{title}</h2><p>{text}</p></div></li>)}
        </ol>
      </section>
      <div className="q-section-heading">
        <div><span className="q-eyebrow">DISCOVER</span><h2>새롭게 등록된 전략</h2><p>성과뿐 아니라 운용 기간과 위험 조건도 함께 살펴보세요.</p></div>
        <Link className="q-text-link" to="/strategies">모든 전략 보기 <ArrowRight size={16} /></Link>
      </div>
      {p.loading ? <CatalogLoading /> : recent.length ? (
        <div className="q-strategy-grid">{recent.map(s => <StrategyCard key={s.id} strategy={s} />)}</div>
      ) : <Empty title={p.catalogError ? "전략 정보를 연결하지 못했습니다" : "첫 전략을 기다리고 있습니다"} description={p.catalogError ? "상단의 다시 시도로 목록을 불러와 주세요." : "공개된 전략이 등록되면 이곳에서 비교할 수 있습니다."} />}
      <div className="q-trust-note"><Layers size={18} /><p><strong>공개 성과, 비공개 투자 내역.</strong> 개인 자산은 지갑 서명 후 조회합니다. 공개 성과는 TEE 집계이며 ZK 검증 성과는 아닙니다.</p></div>
    </>
  );
}
function CatalogLoading() {
  return <div className="q-strategy-grid q-loading" role="status" aria-label="전략을 불러오는 중입니다">
    {[0, 1, 2].map(i => <div className="q-skeleton-card" key={i} aria-hidden="true"><span /><span /><span /><span /></div>)}
    <span className="sr-only">전략을 불러오는 중입니다.</span>
  </div>;
}
function Explore() {
  const p = usePlatform(),
    [search, setSearch] = useState(""),
    [risk, setRisk] = useState(""),
    [state, setState] = useState(""),
    [sort, setSort] = useState("recent"),
    [selected, setSelected] = useState([]),
    [period, setPeriod] = useState("7d"),
    [history, setHistory] = useState({}),
    [historyBusy, setHistoryBusy] = useState(false),
    [historyError, setHistoryError] = useState("");
  const rows = p.strategies
    .filter(
      (s) =>
        (!search ||
          `${s.name} ${s.strategist_name} ${s.description}`
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (!risk || s.risk === risk) &&
        (!state ||
          (state === "HALTED"
            ? s.public_metrics?.status === "HALTED"
            : !["HALTED", "RISK_EXIT"].includes(s.public_metrics?.status) &&
              ["FUNDING", "LIVE"].includes(s.status))),
    )
    .sort((a, b) =>
      sort === "return"
        ? (b.public_metrics?.pnlBps ?? -Infinity) -
          (a.public_metrics?.pnlBps ?? -Infinity)
        : sort === "capital"
          ? Number(b.public_metrics?.managerActive || -1) -
            Number(a.public_metrics?.managerActive || -1)
          : sort === "age"
            ? Date.parse(a.created_at) - Date.parse(b.created_at)
            : Date.parse(b.created_at) - Date.parse(a.created_at),
    );
  const toggle = (id) =>
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((v) => v !== id)
        : prev.length < 3
          ? [...prev, id]
          : prev,
    );
  useEffect(() => {
    if (!selected.length) return;
    let cancelled = false;
    setHistoryBusy(true);
    setHistoryError("");
    Promise.all(
      selected.map(async (id) => {
        const s = p.strategies.find((s) => s.id === id);
        return [
          id,
          (await p.request(`/v1/strategies/${s.slug}?period=${period}`))
            .liveHistory,
        ];
      }),
    )
      .then((entries) => {
        if (!cancelled) setHistory(Object.fromEntries(entries));
      })
      .catch(() => {
        if (!cancelled)
          setHistoryError(
            "비교 이력을 불러오지 못했습니다. 기간을 다시 선택해 주세요.",
          );
      })
      .finally(() => {
        if (!cancelled) setHistoryBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected.join(","), period]);
  return (
    <>
      <PageTitle
        eyebrow="DISCOVER"
        title="성과로 선택하는 전략"
        description="전략가의 자기자본과 실적, 위험 한도를 함께 비교하세요."
      />
      <div className="q-filters">
        <label className="q-search">
          <Search size={18} />
          <input
            aria-label="전략 검색"
            placeholder="전략 또는 전략가 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">위험도</span>
          <select
            aria-label="위험도"
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
          >
            <option value="">모든 위험도</option>
            <option value="LOW">낮음</option>
            <option value="MEDIUM">보통</option>
            <option value="HIGH">높음</option>
          </select>
        </label>
        <label>
          <span className="sr-only">운용 상태</span>
          <select
            aria-label="운용 상태"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">모든 상태</option>
            <option value="ACTIVE">투자 가능</option>
            <option value="HALTED">운용 중단</option>
          </select>
        </label>
        <label>
          <span className="sr-only">정렬</span>
          <select
            aria-label="정렬"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">최근 등록순</option>
            <option value="return">누적 수익률순</option>
            <option value="capital">자기자본순</option>
            <option value="age">등록 기간순</option>
          </select>
        </label>
      </div>
      <div className="q-row q-catalog-note">
        <span>{rows.length}개 전략</span>
        <span>
          최대 3개 비교 · 누적 수익률의 운용 기간은 전략마다 다릅니다.
        </span>
      </div>
      {p.loading ? <CatalogLoading /> : rows.length ? (
        <div className="q-strategy-grid">
          {rows.map((s) => (
            <StrategyCard
              key={s.id}
              strategy={s}
              compare={selected.includes(s.id)}
              onCompare={toggle}
              compareDisabled={selected.length >= 3 && !selected.includes(s.id)}
            />
          ))}
        </div>
      ) : (
        <Empty
          title={
            p.loading
              ? "전략을 불러오는 중입니다"
              : "조건에 맞는 전략이 없습니다"
          }
          description={p.catalogError ? "상단의 다시 시도로 연결을 확인해 주세요." : "검색어나 필터를 바꾸면 다른 전략을 볼 수 있습니다."}
          action={(search || risk || state) && <Button secondary onClick={() => { setSearch(""); setRisk(""); setState(""); }}>필터 초기화</Button>}
        />
      )}
      {selected.length > 0 && (
        <div className="q-compare-dock">
          <span role="status"><strong>{selected.length} / 3</strong> 전략 선택{selected.length === 3 ? " · 최대 선택 완료" : " · 최대 3개 비교"}</span>
          <Button onClick={() => { const target = document.getElementById("q-comparison"); target?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: "start" }); target?.focus({ preventScroll: true }); }}>선택한 전략 비교 <ArrowRight size={16} /></Button>
          <button className="q-compare-clear" aria-label="선택한 전략 모두 해제" onClick={() => setSelected([])}><X size={18} /></button>
        </div>
      )}
      {selected.length > 0 && (
        <Panel id="q-comparison" tabIndex={-1} className="q-comparison">
          <div className="q-row">
            <h2>
              선택한 전략 비교 <small>{selected.length}/3</small>
            </h2>
            <button className="q-text-link" onClick={() => setSelected([])}>
              비교 초기화
            </button>
          </div>
          <div className="q-periods" aria-label="비교 기간">
            {periods.map(([id, label]) => (
              <button
                key={id}
                aria-pressed={period === id}
                className={period === id ? "active" : ""}
                onClick={() => setPeriod(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {historyError && <p className="q-error">{historyError}</p>}
          <div className="q-table-wrap" tabIndex={0} role="region" aria-label="전략 비교표, 좌우로 스크롤할 수 있습니다">
            <table>
              <thead>
                <tr>
                  <th>비교 항목</th>
                  {selected.map((id) => (
                    <th key={id}>
                      {p.strategies.find((s) => s.id === id)?.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "선택 기간 수익률",
                    (s) =>
                      historyBusy
                        ? "조회 중"
                        : percent(periodReturn(history[s.id] || [], period)),
                  ],
                  ["누적 수익률", (s) => percent(s.public_metrics?.pnlBps)],
                  [
                    "연환산 변동성",
                    (s) => rate(s.public_metrics?.volatilityBps),
                  ],
                  ["최대 낙폭", (s) => rate(s.public_metrics?.maxDrawdownBps)],
                  [
                    "전략가 자기자본",
                    (s) => `${money(s.public_metrics?.managerActive)} AUSD`,
                  ],
                  ["성과보수", (s) => `${s.fee_bps / 100}%`],
                  [
                    "최대 레버리지",
                    (s) => `${s.policy.maxLeverageBps / 10000}배`,
                  ],
                  [
                    "손절 / 낙폭 한도",
                    (s) =>
                      `${s.policy.stopLossBps / 100}% / ${s.policy.maxDrawdownBps / 100}%`,
                  ],
                  [
                    "다음 출금 정산",
                    (s) =>
                      time(
                        nextSettlement(s.policy, Math.floor(Date.now() / 1000)),
                      ),
                  ],
                  ["등록일", (s) => time(s.created_at)],
                ].map(([label, get]) => (
                  <tr key={label}>
                    <th>{label}</th>
                    {selected.map((id) => {
                      const s = p.strategies.find((s) => s.id === id);
                      return <td key={id}>{s ? get(s) : "—"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="q-muted q-space">
            선택 기간의 충분한 기록이 없으면 ‘집계 전’으로 표시합니다. 전체 기간
            수익률은 전략별 관측 시작일이 다릅니다.
          </p>
        </Panel>
      )}
    </>
  );
}
function StrategyDetail({ slug }) {
  const p = usePlatform(),
    [detail, setDetail] = useState(null),
    [period, setPeriod] = useState("7d"),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [capital, setCapital] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setError("");
    p.request(`/v1/strategies/${slug}?period=${period}`)
      .then((j) => {
        if (!cancelled) setDetail(j);
      })
      .catch((e) => {
        if (!cancelled) setError(platformError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, period, retry]);
  if (error)
    return (
      <Empty
        title="전략을 불러오지 못했습니다"
        description={error}
        action={
          <Button onClick={() => setRetry((v) => v + 1)}>다시 시도</Button>
        }
      />
    );
  if (loading || !detail)
    return (
      <Empty
        title="전략을 불러오는 중입니다"
        description="성과와 운용 조건을 확인하고 있습니다."
      />
    );
  const s = {
      ...p.strategies.find((s) => s.id === detail.strategy.id),
      ...detail.strategy,
    },
    m = s.public_metrics,
    last = detail.liveHistory.at(-1),
    observed = s.marked_at || last?.observed_at;
  return (
    <>
      <Link to="/strategies" className="q-text-link q-back">
        ← 전략 탐색
      </Link>
      <PageTitle
        eyebrow={`${s.strategist_name} · 위험 ${riskLabel(s.risk)}`}
        title={s.name}
        description={s.description}
        action={
          <Badge tone={m?.status === "HALTED" ? "warning" : ""}>
            {statusLabel(m?.status || s.status)}
          </Badge>
        }
      />
      <button
        className="q-mobile-invest q-button"
        onClick={() =>
          document
            .getElementById("q-investment")
            ?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
      >
        투자 금액 입력
      </button>
      <div className="q-detail-layout">
        <div>
          <div className="q-stats">
            <Stat
              label="누적 수익률"
              value={percent(m?.pnlBps)}
              tone={!Number.isFinite(m?.pnlBps) || m.pnlBps === 0 ? "" : m.pnlBps < 0 ? "negative" : "positive"}
            />
            <Stat
              label="전략가 자기자본"
              value={money(m?.managerActive)}
              suffix="AUSD"
            />
            <Stat label="최대 낙폭" value={rate(m?.maxDrawdownBps)} />
          </div>
          <Panel>
            <div className="q-row">
              <h2>{capital ? "자기자본 운용 이력" : "운용 성과"}</h2>
              <div className="q-periods">
                {periods.map(([id, label]) => (
                  <button
                    key={id}
                    className={period === id ? "active" : ""}
                    aria-pressed={period === id}
                    onClick={() => setPeriod(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="q-tabs q-small-tabs">
              <button
                aria-pressed={!capital}
                className={!capital ? "active" : ""}
                onClick={() => setCapital(false)}
              >
                수익률
              </button>
              <button
                aria-pressed={capital}
                className={capital ? "active" : ""}
                onClick={() => setCapital(true)}
              >
                자기자본
              </button>
            </div>
            <HistoryChart history={detail.liveHistory} capital={capital} />
            <p className="q-muted">
              {capital
                ? "전략가 본인 자금의 운용 평가액입니다."
                : "성과보수와 거래 비용을 반영한 기준 투자자의 누적 수익률입니다. 개인 수익률은 가입 시점에 따라 다릅니다."}
            </p>
            <p className="q-data-time">
              TEE 집계 · 마지막 관측 {time(observed)}
              {observed && Date.now() - Date.parse(observed) > 180000
                ? " · 최신 정보 확인이 지연되고 있습니다."
                : ""}
            </p>
          </Panel>
          <Panel>
            <h2>전략가 소개와 자기자본</h2>
            <p className="q-muted">
              {s.strategist_name} ·{" "}
              {s.strategist_bio || "공개 소개를 준비 중입니다."}
            </p>
            <div className="q-position-stats">
              <Stat
                label="운용 중"
                value={money(m?.managerActive)}
                suffix="AUSD"
              />
              <Stat
                label="운용 대기"
                value={money(m?.managerPending)}
                suffix="AUSD"
              />
              <Stat
                label="출금 요청"
                value={money(m?.managerWithdrawing)}
                suffix="AUSD"
              />
            </div>
            <p className="q-muted">
              운용 기간과 자기자본 이력을 성과와 함께 살펴보세요.
            </p>
          </Panel>
          <Panel>
            <h2>공개 운용 조건</h2>
            <Conditions policy={s.policy} feeBps={s.fee_bps} />
            <p className="q-callout">
              위험 한도에 도달하면 포지션을 정리하고 운용을 중단합니다.
            </p>
            {s.pending_policy && (
              <div className="q-policy-notice">
                <h3>운용 조건 변경 예고</h3>
                <p>
                  {time(s.pending_policy.effectiveAfter)} 이후 기존 출금 정산이
                  완료되면 적용됩니다.
                </p>
                <Conditions
                  policy={s.pending_policy.policy}
                  feeBps={s.pending_policy.feeBps}
                />
              </div>
            )}
          </Panel>
          <details className="q-technical">
            <summary>자금 보관과 비공개 운용 방식</summary>
            <p>
              모든 자금은 하나의 공용 Vault에 보관됩니다. 투자자별 배분과 전략의
              목표 비중은 TEE에서 비공개로 관리하며, 전략 주문은 각각 독립
              실행됩니다.
            </p>
            {p.config?.vaultAddress && (
              <a
                href={`https://testnet.monadscan.com/address/${p.config.vaultAddress}`}
                target="_blank"
                rel="noreferrer"
              >
                공용 Vault 확인 ↗
              </a>
            )}
          </details>
        </div>
        <InvestmentPanel key={s.id} strategy={s} />
      </div>
    </>
  );
}
function Shell() {
  const p = usePlatform(),
    path = useRoute(),
    [account, setAccount] = useState(false);
  useEffect(() => {
    setAccount(false);
    const name = path.startsWith("/strategies/") ? "전략 상세" : path === "/strategies" ? "전략 탐색" : path === "/assets" ? "내 자산" : path.startsWith("/manage") ? "내 전략" : "홈";
    document.title = `${name} · MMQuant`;
  }, [path]);
  useEffect(() => {
    if (!account) return;
    const closeOutside = (event) => { if (!event.target.closest(".q-account")) setAccount(false); };
    const escape = (event) => { if (event.key === "Escape") { setAccount(false); document.querySelector(".q-account-button")?.focus(); } };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", escape); };
  }, [account]);
  const section = path.startsWith("/strategies")
    ? "/strategies"
    : path.startsWith("/assets")
      ? "/assets"
      : path.startsWith("/manage")
        ? "/manage"
        : "/";
  const navigation = [
    ["/", "홈", Home],
    ["/strategies", "전략 탐색", Search],
    ["/assets", "내 자산", Wallet],
    ["/manage", "내 전략", Layers],
  ];
  return (
    <div className="q-shell">
      <a className="q-skip" href="#q-main">
        본문으로 건너뛰기
      </a>
      <aside className="q-sidebar">
        <Link className="q-brand" to="/">
          MM<span>Quant</span>
        </Link>
        <span className="q-sidebar-caption">INVEST & BUILD</span>
        <nav aria-label="주 메뉴">
          {navigation.map(([to, label, Icon]) => (
            <Link
              key={to}
              to={to}
              aria-current={section === to ? "page" : undefined}
              className={section === to ? "active" : ""}
            >
              <Icon size={19} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="q-sidebar-bottom">
          <Badge>Monad Testnet</Badge>
          <p>
            실적으로 연결되는
            <br />
            전략가와 투자자
          </p>
          <small>테스트 AUSD로 운용됩니다.</small>
        </div>
      </aside>
      <div className="q-main-shell">
        <header className="q-header">
          <div className="q-breadcrumb"><Link to="/" className="q-mobile-brand">MM<span>Quant</span></Link><span className="q-desktop-breadcrumb">Workspace <span>/</span> <strong>{navigation.find(([to]) => to === section)?.[1]}</strong></span></div>
          <span className="q-network-label">Monad <strong>TESTNET</strong></span>
          <div className="q-account">
            {p.session ? (
              <>
                <button
                  className="q-account-button"
                  onClick={() => setAccount(!account)}
                  aria-expanded={account}
                  aria-controls="q-account-menu"
                >
                  {p.session.strategist?.display_name ||
                    short(p.session.wallet)}
                  <span className="q-account-dot" />
                </button>
                {account && (
                  <div id="q-account-menu" className="q-account-menu">
                    <strong>{short(p.session.wallet)}</strong>
                    <small>Monad Testnet</small>
                    <Link to="/manage/profile">프로필 관리</Link>
                    <Link to="/manage/api">API 연동</Link>
                    <button
                      onClick={() => {
                        p.logout();
                        setAccount(false);
                      }}
                    >
                      로그아웃
                    </button>
                  </div>
                )}
              </>
            ) : (
              <Button disabled={p.busy || !p.config} onClick={p.login}>
                <Wallet size={16} />
                지갑으로 로그인
              </Button>
            )}
          </div>
        </header>
        <main id="q-main" tabIndex={-1}>
          {p.catalogError && (
            <div role="alert" className="q-notice error">
              <AlertCircle size={18} />
              <span>연결을 확인해 주세요. {p.catalogError}</span>
              <button onClick={p.refreshCatalog}>다시 시도</button>
            </div>
          )}
          {p.message?.text && (
            <div
              role={p.message.error ? "alert" : "status"}
              className={`q-notice ${p.message.error ? "error" : ""}`}
            >
              <span>{p.message.text}</span>
              <button aria-label="알림 닫기" onClick={() => p.notify("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {p.pending?.txHash &&
            p.session &&
            (!p.pending.wallet ||
              p.pending.wallet.toLowerCase() ===
                p.session.wallet.toLowerCase()) && (
              <div className="q-notice">
                <span>{p.pending.strategyName} · 입금 내역 확인 대기</span>
                <Button secondary disabled={p.busy} onClick={p.resumeDeposit}>
                  입금 확인 계속하기
                </Button>
              </div>
            )}
          {path === "/" ? (
            <Dashboard />
          ) : path === "/strategies" ? (
            <Explore />
          ) : path.startsWith("/strategies/") ? (
            <StrategyDetail slug={path.slice("/strategies/".length)} />
          ) : path === "/assets" ? (
            <InvestorPortal />
          ) : path.startsWith("/manage") ? (
            <ManagerConsole path={path} />
          ) : (
            <Empty
              title="페이지를 찾을 수 없습니다"
              description="홈에서 다시 시작해 주세요."
              action={
                <Link to="/" className="q-button">
                  홈으로
                </Link>
              }
            />
          )}
        </main>
        <footer className="q-footer">
          <span>MMQuant · Monad Testnet</span>
          <span>전략 정보는 공개 · 개인 투자 내역은 비공개</span>
        </footer>
      </div>
      <nav className="q-mobile-nav" aria-label="모바일 주 메뉴">
        {navigation.map(([to, label, Icon]) => (
          <Link
            key={to}
            to={to}
            aria-current={section === to ? "page" : undefined}
            className={section === to ? "active" : ""}
          >
            <Icon size={20} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
export default function Platform() {
  return (
    <PlatformProvider>
      <Shell />
    </PlatformProvider>
  );
}
