import React, { useEffect, useState } from "react";
import { PlatformProvider, usePlatform } from "./PlatformContext.jsx";
import { platformError } from "./platformErrors.js";
import InvestorPortal, {
  PortfolioSummary,
  PortfolioGate,
} from "./InvestorPortal.jsx";
import ManagerConsole from "./ManagerConsole.jsx";
import CashPanel from './CashPanel.jsx';
import {AccountAccess} from './AccountAccess.jsx';
import InvestmentPanel from "./InvestmentPanel.jsx";
import { StrategyRow, StrategyInspector } from "./StrategyMarket.jsx";
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
  HistoryChart,
  Conditions,
  Home,
  Settings2,
  SlidersHorizontal,
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
  ["1d", "1D"],
  ["7d", "7D"],
  ["30d", "30D"],
  ["all", "All"],
];
function Dashboard() {
  const p = usePlatform();
  if (!p.session) return <GuestHome />;
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
            ? `${p.session.strategist.display_name}'s dashboard`
            : "Your investments and strategies"
        }
        description="Check your assets and prepare your next move."
        action={
          <Link className="q-button secondary" to="/strategies">

            Explore strategies <ArrowRight size={16} />
          </Link>
        }
      />
      <PortfolioSummary />
      <CashPanel />
      {!p.portfolio ? (
        <Panel>
          <PortfolioGate />
        </Panel>
      ) : (
        <Panel>
          <div className="q-row">
            <h2>My investments</h2>
            <Link to="/assets" className="q-text-link">

              View all assets <ArrowRight size={15} />
            </Link>
          </div>
          {p.portfolio.positions.length ? (
            <div className="q-home-positions">
              {p.portfolio.positions.map((pos) => (
                <Link to="/assets" key={pos.strategyId}>
                  <div>
                    <strong>
                      {p.strategies.find((s) => s.id === pos.strategyId)
                        ?.name || "My strategy"}
                    </strong>
                    <p className="q-muted">
                      {BigInt(pos.pending) > 0n
                        ? `Pending allocation ${money(pos.pending)} AUSD`
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
              title="No investments yet"
              description="Compare performance and the strategist's own capital to make your first allocation."
              action={
                <Link to="/strategies" className="q-text-link">

                  Explore <ArrowRight size={15} />
                </Link>
              }
            />
          )}
        </Panel>
      )}
      <Panel>
        <div className="q-row">
          <h2>My strategies</h2>
          <Link className="q-text-link" to="/manage">

            Manage strategy <ArrowRight size={15} />
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

                      Own capital {money(m?.managerActive)}  AUSD · pending{" "}
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
            title="Start with your own capital"
            description="Publish your investment rules, build a track record and attract investors."
            action={
              <Link className="q-button secondary" to="/manage/new">
                <Plus size={16} />Create your first strategy
              </Link>
            }
          />
        )}
      </Panel>
      {p.portfolio && (
        <Panel>
          <h2>Scheduled redemptions</h2>
          {withdrawals.length ? (
            withdrawals.map((w) => (
              <div className="q-home-positions" key={w.id}>
                <Link to="/assets">
                  <strong>
                    {p.strategies.find((s) => s.id === w.strategyId)?.name ||
                      "My strategy"}
                  </strong>
                  <span>
                    {time(w.settlementAt)} · {statusLabel(w.status)}
                  </span>
                </Link>
              </div>
            ))
          ) : (
            <p className="q-muted q-space">No scheduled redemptions.</p>
          )}
        </Panel>
      )}
    </>
  );
}
function GuestHome() {
  const p = usePlatform();
  const recent = [...p.strategies]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 4);
  return (
    <div className="q-guest-home">
      <section className="q-guest-intro" aria-labelledby="q-guest-title">
        <span className="q-eyebrow">MONAD TESTNET · VEILVEST</span>
        <h1 id="q-guest-title">Discover strategies.<br />See the conditions.</h1>
        <p>Compare performance and risk limits to find a strategy that fits you.</p>
        <div className="q-actions">
          <Link className="q-button" to="/strategies">Explore strategies <ArrowRight size={16} /></Link>
          <Link className="q-button secondary" to="/manage/new">Create a strategy</Link>
        </div>
        <p className="q-guest-caption">Public performance is aggregated by the TEE. Sign in to view your private investments.</p>
      </section>
      <section className="q-guest-flow" aria-labelledby="q-guest-flow-title">
        <h2 id="q-guest-flow-title">How to get started</h2>
        <ol>
          <li><span>01</span><div><strong>Compare strategies</strong><p>Review returns, the strategist's own capital and risk limits.</p></div></li>
          <li><span>02</span><div><strong>Sign in and add funds</strong><p>Your deposit becomes available cash in your platform balance.</p></div></li>
          <li><span>03</span><div><strong>Allocate and track your assets</strong><p>Allocated funds start trading with the strategist's next submission.</p></div></li>
        </ol>
      </section>
      <section className="q-guest-recent" aria-labelledby="q-guest-recent-title">
        <div className="q-row"><div><span className="q-eyebrow">DISCOVER</span><h2 id="q-guest-recent-title">Recently added strategies</h2></div><Link className="q-text-link" to="/strategies">View all strategies <ArrowRight size={15} /></Link></div>
        {p.loading ? <CatalogLoading /> : recent.length ? (
          <div className="q-guest-recent-list">
            {recent.map(s => <Link key={s.id} to={`/strategies/${s.slug}`} className="q-guest-recent-row">
              <span><strong>{s.name}</strong><small>{s.strategist_name}  · risk {riskLabel(s.risk)}</small></span>
              <span className="q-guest-recent-return">{percent(s.public_metrics?.pnlBps)}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>)}
          </div>
        ) : <Empty title={p.catalogError ? "Could not load strategies" : "No public strategies yet"} description={p.catalogError ? "Please try again shortly." : "Registered strategies will appear here."} />}
      </section>
    </div>
  );
}
function CatalogLoading() {
  return <div className="q-market-loading" role="status">
    <span className="q-spinner" />  Loading strategies.
  </div>;
}
function Explore() {
  const p = usePlatform(),
    [search, setSearch] = useState(""),
    [risk, setRisk] = useState(""),
    [state, setState] = useState(""),
    [sort, setSort] = useState("recent"),
    [filtersOpen, setFiltersOpen] = useState(false),
    [selected, setSelected] = useState([]),
    [inspected, setInspected] = useState(null),
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
            "Could not load comparison history. Select the period again.",
          );
      })
      .finally(() => {
        if (!cancelled) setHistoryBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected.join(","), period]);
  const activeStrategy = rows.find(s => s.id === inspected) || rows[0];
  const activeFilterCount = Number(Boolean(risk)) + Number(Boolean(state)) + Number(sort !== "recent");
  return (
    <div className="q-market-workspace">
    <section className="q-market-catalog" aria-label="Strategy list">
      <PageTitle
        title="Explore"
        description="Compare track records, own capital and risk limits."
      />
      <div className="q-filters">
        <label className="q-search">
          <Search size={18} />
          <input
            aria-label="Search strategies"
            placeholder="Search strategies or strategists"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button type="button" className="q-filter-toggle" aria-expanded={filtersOpen} aria-controls="q-filter-options" onClick={() => setFiltersOpen(open => !open)}>
          <SlidersHorizontal size={16} aria-hidden="true" />  Filters
          {activeFilterCount > 0 && <span className="q-filter-count" aria-label={`Active filters: ${activeFilterCount}items`}>{activeFilterCount}</span>}
        </button>
        <div id="q-filter-options" className={`q-filter-options${filtersOpen ? " expanded" : ""}`}>
        <label>
          <span className="sr-only">Risk</span>
          <select
            aria-label="Risk"
            value={risk}
            onChange={(e) => setRisk(e.target.value)}
          >
            <option value="">All risk levels</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Trading status</span>
          <select
            aria-label="Trading status"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Open for investment</option>
            <option value="HALTED">Trading halted</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Sort</span>
          <select
            aria-label="Sort"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">Newest first</option>
            <option value="return">Highest total return</option>
            <option value="capital">Most own capital</option>
            <option value="age">Longest history</option>
          </select>
        </label>
        </div>
      </div>
      <div className="q-row q-catalog-note">
        <span>{rows.length}strategies</span>
        <span>

          Compare up to 3 strategies. Each strategy has a different track record length.
        </span>
      </div>
      {p.loading ? <CatalogLoading /> : rows.length ? (
        <div className="q-market-list" role="list" aria-label="Public strategies">
          <div className="q-market-columns" aria-hidden="true"><span>Strategy / strategist</span><span>Total return</span><span>Own capital <small>AUSD</small></span><span>Fee</span><span>Risk</span><span>Compare</span></div>
          {rows.map(s => <StrategyRow key={s.id} strategy={s}
            active={activeStrategy?.id === s.id}
            onInspect={() => setInspected(s.id)}
            compare={selected.includes(s.id)} onCompare={toggle}
            compareDisabled={selected.length >= 3 && !selected.includes(s.id)} />)}
        </div>
      ) : (
        <Empty
          title={
            p.loading
              ? "Loading strategies"
              : "No matching strategies"
          }
          description={p.catalogError ? "Use Retry above to check the connection." : "Try a different search or filter."}
          action={(search || risk || state) && <Button secondary onClick={() => { setSearch(""); setRisk(""); setState(""); }}>Clear filters</Button>}
        />
      )}
      {selected.length > 0 && (
        <div className="q-compare-dock">
          <span role="status"><strong>{selected.length} / 3</strong>  strategies selected{selected.length === 3 ? " · selection limit reached" : " · compare up to 3"}</span>
          <Button onClick={() => { const target = document.getElementById("q-comparison"); target?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: "start" }); target?.focus({ preventScroll: true }); }}>Compare selected strategies <ArrowRight size={16} /></Button>
          <button className="q-compare-clear" aria-label="Clear selected strategies" onClick={() => setSelected([])}><X size={18} /></button>
        </div>
      )}
      {selected.length > 0 && (
        <Panel id="q-comparison" tabIndex={-1} className="q-comparison">
          <div className="q-row">
            <h2>

              Compare selected strategies <small>{selected.length}/3</small>
            </h2>
            <button className="q-text-link" onClick={() => setSelected([])}>

              Clear comparison
            </button>
          </div>
          <div className="q-periods" aria-label="Comparison period">
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
          <div className="q-table-wrap" tabIndex={0} role="region" aria-label="Strategy comparison. Scroll horizontally to see all columns.">
            <table>
              <thead>
                <tr>
                  <th>Metric</th>
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
                    "Return for selected period",
                    (s) =>
                      historyBusy
                        ? "Loading"
                        : percent(periodReturn(history[s.id] || [], period)),
                  ],
                  ["Total return", (s) => percent(s.public_metrics?.pnlBps)],
                  [
                    "Annualized volatility",
                    (s) => rate(s.public_metrics?.volatilityBps),
                  ],
                  ["Maximum drawdown", (s) => rate(s.public_metrics?.maxDrawdownBps)],
                  [
                    "Strategist's own capital",
                    (s) => `${money(s.public_metrics?.managerActive)} AUSD`,
                  ],
                  ["Performance fee", (s) => `${s.fee_bps / 100}%`],
                  [
                    "Maximum leverage",
                    (s) => `${s.policy.maxLeverageBps / 10000}×`,
                  ],
                  [
                    "Stop loss / drawdown limit",
                    (s) =>
                      `${s.policy.stopLossBps / 100}% / ${s.policy.maxDrawdownBps / 100}%`,
                  ],
                  [
                    "Next redemption settlement",
                    (s) =>
                      time(
                        nextSettlement(s.policy, Math.floor(Date.now() / 1000)),
                      ),
                  ],
                  ["Registered", (s) => time(s.created_at)],
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

            Periods without sufficient history display “Not available”. Full-history returns may start on different dates.
          </p>
        </Panel>
      )}
      <p className="q-market-disclosure">Trading uses test AUSD. Track record lengths vary, and past performance does not guarantee future returns.</p>
    </section>
    <aside className="q-inspector" aria-label="Selected strategy">
      {activeStrategy ? <StrategyInspector key={activeStrategy.id} strategy={activeStrategy} /> : <Empty title="Select a strategy" description="Choose a strategy to see its performance and investment conditions." />}
    </aside>
    </div>
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
        title="Could not load the strategy"
        description={error}
        action={
          <Button onClick={() => setRetry((v) => v + 1)}>Retry</Button>
        }
      />
    );
  if (loading || !detail)
    return (
      <Empty
        title="Loading strategies"
        description="Loading performance and investment conditions."
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

        ← Explore strategies
      </Link>
      <PageTitle
        eyebrow={`${s.strategist_name} · risk ${riskLabel(s.risk)}`}
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

        Enter allocation amount
      </button>
      <div className="q-detail-layout">
        <div>
          <div className="q-stats">
            <Stat
              label="Total return"
              value={percent(m?.pnlBps)}
              tone={!Number.isFinite(m?.pnlBps) || m.pnlBps === 0 ? "" : m.pnlBps < 0 ? "negative" : "positive"}
            />
            <Stat
              label="Strategist's own capital"
              value={money(m?.managerActive)}
              suffix="AUSD"
            />
            <Stat label="Maximum drawdown" value={rate(m?.maxDrawdownBps)} />
          </div>
          <Panel>
            <div className="q-row">
              <h2>{capital ? "Own capital history" : "Performance"}</h2>
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

                Return
              </button>
              <button
                aria-pressed={capital}
                className={capital ? "active" : ""}
                onClick={() => setCapital(true)}
              >

                Own capital
              </button>
            </div>
            <HistoryChart history={detail.liveHistory} capital={capital} />
            <p className="q-muted">
              {capital
                ? "The current value of the strategist's own invested capital."
                : "Reference investor returns include performance fees and trading costs. Individual returns depend on allocation timing."}
            </p>
            <p className="q-data-time">

              TEE aggregate · last observation {time(observed)}
              {observed && Date.now() - Date.parse(observed) > 180000
                ? " · Latest update is delayed."
                : ""}
            </p>
          </Panel>
          <Panel>
            <h2>About the strategist and their capital</h2>
            <p className="q-muted">
              {s.strategist_name} ·{" "}
              {s.strategist_bio || "No public introduction yet."}
            </p>
            <div className="q-position-stats">
              <Stat
                label="Invested"
                value={money(m?.managerActive)}
                suffix="AUSD"
              />
              <Stat
                label="Pending"
                value={money(m?.managerPending)}
                suffix="AUSD"
              />
              <Stat
                label="Redemption requested"
                value={money(m?.managerWithdrawing)}
                suffix="AUSD"
              />
            </div>
            <p className="q-muted">

              Review the duration and history of own capital alongside performance.
            </p>
          </Panel>
          <Panel>
            <h2>Public investment conditions</h2>
            <Conditions policy={s.policy} feeBps={s.fee_bps} />
            <p className="q-callout">

              Reaching a risk limit closes positions and halts trading.
            </p>
            {s.pending_policy && (
              <div className="q-policy-notice">
                <h3>Upcoming condition change</h3>
                <p>
                  {time(s.pending_policy.effectiveAfter)}  Changes apply after existing redemptions settle, starting from this time.
                </p>
                <Conditions
                  policy={s.pending_policy.policy}
                  feeBps={s.pending_policy.feeBps}
                />
              </div>
            )}
          </Panel>
          <details className="q-technical">
            <summary>Custody and private execution</summary>
            <p>

              Funds share a single Vault. The TEE privately manages investor allocations and target positions. Each strategy executes independently.
            </p>
            {p.config?.vaultAddress && (
              <a
                href={`https://testnet.monadscan.com/address/${p.config.vaultAddress}`}
                target="_blank"
                rel="noreferrer"
              >

                View shared Vault ↗
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
    const name = path.startsWith("/strategies/") ? "Strategy details" : path === "/strategies" ? "Explore" : path === "/assets" ? "My assets" : path.startsWith("/manage") ? "My strategies" : "Home";
    document.title = `${name} · Veilvest`;
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
    ["/", "Home", Home],
    ["/strategies", "Explore", Search],
    ["/assets", "My assets", Wallet],
    ["/manage", "My strategies", Layers],
  ];
  return (
    <div className={`q-shell${path === "/strategies" ? " q-market-shell" : ""}`}>
      <a className="q-skip" href="#q-main">

        Skip to main content
      </a>
      <aside className="q-sidebar">
        <Link className="q-brand" to="/" aria-label="Veilvest home">
          VV
        </Link>
        <nav aria-label="Main navigation">
          {navigation.map(([to, label, Icon]) => (
            <Link
              key={to}
              to={to}
              aria-label={label}
              title={label}
              aria-current={section === to ? "page" : undefined}
              className={section === to ? "active" : ""}
            >
              <Icon size={19} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="q-sidebar-bottom">
          <Link to="/manage/profile" aria-label="Profile settings" title="Profile settings"><Settings2 size={19} /></Link>
        </div>
      </aside>
      <div className="q-main-shell">
        <header className="q-header">
          <div className="q-breadcrumb"><Link to="/" className="q-mobile-brand">Veil<span>vest</span></Link><span className="q-desktop-breadcrumb">Veilvest <span>/</span> <strong>{navigation.find(([to]) => to === section)?.[1]}</strong></span></div>
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
                    p.session.username || short(p.session.wallet)}
                  <span className="q-account-dot" />
                </button>
                {account && (
                  <div id="q-account-menu" className="q-account-menu">
                    <strong>{p.session.username || short(p.session.wallet)}</strong>
                    <small>{p.session.wallet ? short(p.session.wallet) : "No funding wallet yet"}</small>
                    <Link to="/manage/profile">Manage profile</Link>
                    <Link to="/manage/api">API integration</Link>
                    <button
                      onClick={() => {
                        p.logout();
                        setAccount(false);
                      }}
                    >

                      Sign out
                    </button>
                  </div>
                )}
              </>
            ) : (
              <Button disabled={p.busy || !p.config} onClick={p.login}>
                <ArrowRight size={16} />
                Sign in
              </Button>
            )}
          </div>
        </header>
        <main id="q-main" tabIndex={-1}>
          {p.catalogError && (
            <div role="alert" className="q-notice error">
              <AlertCircle size={18} />
              <span>Check your connection. {p.catalogError}</span>
              <button onClick={p.refreshCatalog}>Retry</button>
            </div>
          )}
          {p.message?.text && (
            <div
              role={p.message.error ? "alert" : "status"}
              className={`q-notice ${p.message.error ? "error" : ""}`}
            >
              <span>{p.message.text}</span>
              <button aria-label="Dismiss notification" onClick={() => p.notify("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {p.outbox && p.session && <div className="q-notice"><span>A previous request needs confirmation. Refresh assets or retry the same request.</span><Button secondary disabled={p.busy} onClick={p.retryPendingRequest}>Confirm previous request</Button></div>}
          {p.pending?.txHash &&
            p.session &&
            (!p.pending.wallet ||
              p.pending.wallet.toLowerCase() ===
                p.session.wallet?.toLowerCase()) && (
              <div className="q-notice">
                <span>{p.pending.strategyName}  · deposit confirmation pending</span>
                <Button secondary disabled={p.busy} onClick={p.resumeDeposit}>

                  Continue deposit confirmation
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
              title="Page not found"
              description="Return home to continue."
              action={
                <Link to="/" className="q-button">

                  Go home
                </Link>
              }
            />
          )}
        </main>
        <footer className="q-footer">
          <span>Veilvest · Monad Testnet</span>
          <span>Public performance · private investments</span>
        </footer>
      </div>
      <AccountAccess />
      <nav className="q-mobile-nav" aria-label="Mobile navigation">
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
