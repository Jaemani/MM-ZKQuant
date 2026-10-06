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
import {AccountCredentials} from './AccountAccess.jsx';
import InvestmentPanel from "./InvestmentPanel.jsx";
import ManagerFees from "./ManagerFees.jsx";
import LedgerProofPanel from "./LedgerProofPanel.jsx";
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
      withdrawalCutoffSeconds: v === 60 ? 0 : v === 3600 ? 300 : 3600,
    });
  const utcMinutes = Math.floor(value.settlementOffsetSeconds / 60) % 1440;
  return (
    <>
      <div className="q-form-grid">
        <label className="q-field">

          Performance fee (%)
          <input
            required
            type="number"
            min="0"
            max="20"
            step="0.01"
            value={fee / 100}
            onChange={(e) => onFee(Math.round(Number(e.target.value) * 100))}
          />
          <small>Charged on gains above each investor's previous high watermark.</small>
        </label>
        <label className="q-field">

          Maximum leverage (×)
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

          Stop loss limit (%)
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
          <small>Measured from trading start or restart</small>
        </label>
        <label className="q-field">

          Maximum drawdown limit (%)
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

          Redemption settlement frequency
          <select
            aria-label="Redemption settlement frequency"
            value={value.settlementPeriodSeconds}
            onChange={(e) => setPeriod(Number(e.target.value))}
          >
            <option value="60">Every minute (testnet)</option>
            <option value="3600">Hourly</option>
            <option value="86400">Daily</option>
            <option value="604800">Weekly</option>
            {![60, 3600, 86400, 604800].includes(value.settlementPeriodSeconds) && (
              <option value={value.settlementPeriodSeconds}>
                {value.settlementPeriodSeconds / 3600}hours
              </option>
            )}
          </select>
        </label>
        {value.settlementPeriodSeconds === 60 ? <p className="q-muted">Testnet settlement at each minute boundary (UTC).</p> : value.settlementPeriodSeconds === 3600 ? (
          <label className="q-field">

            Settlement minute within each hour
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

            Settlement time (UTC)
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
            <small>Scheduled times below use your local timezone.</small>
          </label>
        )}
        {value.settlementPeriodSeconds === 604800 && (
          <label className="q-field">

            Settlement day (UTC)
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
                "Thursday",
                "Friday",
                "Saturday",
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
              ].map((day, i) => (
                <option key={day} value={i}>
                  {day}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="q-field">

          Redemption cutoff (minutes before settlement)
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

        Next eligible settlement:{" "}
        {time(nextSettlement(value, Math.floor(Date.now() / 1000)))}  · request cutoff{" "}
        {value.withdrawalCutoffSeconds / 60}minutes before
      </p>
      <details className="q-advanced">
        <summary>Advanced order settings</summary>
        <div className="q-form-grid">
          <label className="q-field">

            Order validity (seconds)
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

            Slippage tolerance (%)
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
      <AccountCredentials />
      <PageTitle
        eyebrow="PROFILE"
        title="Public profile"
        description="Add the name and introduction investors will see."
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
              p.notify("Profile saved.");
            });
          }}
        >
          <label className="q-field">

            Public name
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

            Introduction
            <textarea
              aria-label="Introduction"
              required
              minLength={2}
              maxLength={500}
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
          </label>
          <Button disabled={p.busy}>Save profile</Button>
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
        title="API integration"
        description="Submit encrypted targets from your own program whenever you choose."
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

            Issue token
          </Button>
        }
      />
      {!p.session.strategist && (
        <Panel>
          <p>Create your public profile before issuing a token.</p>
          <Link to="/manage/profile" className="q-text-link">

            Create profile <ArrowRight size={15} />
          </Link>
        </Panel>
      )}
      {error && (
        <p role="alert" className="q-error">
          {error}
          <button onClick={refresh}>Retry</button>
        </p>
      )}
      <Panel>
        <h2>My API tokens</h2>
        {keys === null ? (
          <p className="q-space q-muted">Loading…</p>
        ) : keys.length ? (
          <div className="q-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Issued</th>
                  <th>Last used</th>
                  <th>Status</th>
                  <th>Actions</th>
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
                        ? "Revoked"
                        : k.expires_at && Date.parse(k.expires_at) < Date.now()
                          ? "Expired"
                          : "Active"}
                    </td>
                    <td>
                      <button
                        className="q-text-link"
                        disabled={p.busy || !!k.revoked_at}
                        onClick={() => setRevoke(k)}
                      >

                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No API tokens yet"
            description="Use your account to manage strategies on the web. Issue a token to connect an external program."
          />
        )}
      </Panel>
      <Panel>
        <h2>Connect target submissions</h2>
        <ol className="q-instructions">
          <li>

            Save your API token in the local environment variable <code>MMQ_API_TOKEN</code>.
          </li>
          <li>

            Prepare the strategy ID and full target vector. Negative weights are shorts; omitted assets are closed to 0%.
          </li>
          <li>

            The CLI reads configuration, encrypts targets and sends them to the TEE.
          </li>
          <li>Check the strategy's execution history for acceptance and fill results.</li>
        </ol>
        <pre>
          <code>
            {
              '[{"market":16,"weightBps":5000},{"market":32,"weightBps":-2000}]\n\nnode scripts/submit-strategy.mjs STRATEGY_ID targets.json'
            }
          </code>
        </pre>
        <p className="q-muted">

          BTC 16 · ETH 32 · SOL 48 · MON 64 / 5000 bps = 50% exposure
        </p>
        <Link to="/manage" className="q-text-link">

          Find your strategy ID <ArrowRight size={15} />
        </Link>
      </Panel>
      {fresh && (
        <Modal title="API token issued" onClose={() => setFresh(null)}>
          <p className="q-muted">

            The full token appears only here. Copy it and store it safely.
          </p>
          <label className="q-field">

            New API token
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
            {copied ? "Copied" : "Copy token"}
          </Button>
          <Button secondary onClick={() => setFresh(null)}>

            Close
          </Button>
        </Modal>
      )}
      {revoke && (
        <Modal
          title="Revoke this API token?"
          busy={p.busy}
          onClose={() => setRevoke(null)}
        >
          <p>

            Programs using this token will no longer be able to submit targets.
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
                p.notify("Token revoked.");
              })
            }
          >

            Confirm revocation
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
  const labels = ["Public profile", "Strategy introduction", "Investment conditions", "Review and register"];
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
      p.notify("Strategy registered. Add funds to link your payout wallet, then allocate your own capital.");
      navigate(`/manage/${s.id}`);
    });
  };
  return (
    <>
      <Link to="/manage" className="q-text-link q-back">

        ← My strategies
      </Link>
      <PageTitle
        eyebrow="NEW STRATEGY"
        title="Create a strategy"
        description="Register your strategy and public conditions, then start with your own capital."
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

                Public name
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

                Introduction
                <textarea
                  aria-label="Introduction"
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

                Strategy name
                <input
                  required
                  minLength={2}
                  maxLength={100}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label className="q-field">

                Strategy URL slug
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
                <small>Used in the link you share with investors.</small>
              </label>
              <label className="q-field">

                Strategy description
                <textarea
                  aria-label="Strategy description"
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

                Public risk category
                <select
                  value={form.risk}
                  onChange={(e) => setForm({ ...form, risk: e.target.value })}
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </select>
                <small>

                  Selected by the strategist and published alongside risk limits.
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
                <Badge>Public after registration</Badge>
                <h3>{form.name}</h3>
                <p>{form.description}</p>
                <p className="q-muted">

                  Strategist {profile.displayName} · /strategies/{form.slug}
                </p>
              </div>
              <Conditions policy={form.policy} feeBps={form.feeBps} />
              <p className="q-callout">

                Conditions, performance and own capital are public. Targets and individual allocations remain private.
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

                Previous step
              </Button>
            ) : (
              <span />
            )}
            <Button disabled={p.busy}>
              {step === 3 ? "Register strategy" : "Next step"}
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
    [capital, setCapital] = useState(false),
    [diagnoses, setDiagnoses] = useState({});
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
        "Targets accepted. Check execution history for the actual result.",
      );
    });
  return (
    <>
      <Link to="/manage" className="q-text-link q-back">

        ← My strategies
      </Link>
      <PageTitle
        eyebrow="STRATEGY WORKSPACE"
        title={strategy.name}
        description="Track performance and manage targets and investment conditions."
        action={
          <Link
            className="q-button secondary"
            to={`/strategies/${strategy.slug}`}
          >

            Public page <ArrowRight size={16} />
          </Link>
        }
      />
      <div className="q-tabs" role="tablist" aria-label="Manage strategy">
        {[
          ["overview", "Overview"],
          ["targets", "Submit targets"],
          ["activity", "Execution history"],
          ["policy", "Investment conditions"],
          ["api", "API integration"],
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
          <span>Strategy status and performance fee update delayed · {statusError}</span>
          <button onClick={() => p.run(readStatus)}>Refresh</button>
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
              <Stat label="Total return" value={percent(m?.pnlBps)} />
              <Stat
                label="Own invested capital"
                value={money(m?.managerActive)}
                suffix="AUSD"
              />
              <Stat
                label="Own pending allocation"
                value={money(m?.managerPending)}
                suffix="AUSD"
              />
            </div>
            <Panel>
              <div className="q-row">
                <h2>Prepare your strategy</h2>
                <Badge tone={status?.status === "HALTED" ? "warning" : ""}>
                  {status ? statusLabel(status.status) : "Checking status"}
                </Badge>
              </div>
              <div className="q-next-actions">
                <button onClick={() => setCapital(true)}>
                  <strong>Allocate own capital</strong>
                  <span>Allocate from your platform balance; trading starts with the next submission</span>
                  <ArrowRight size={18} />
                </button>
                <button onClick={() => setTab("targets")}>
                  <strong>Submit target weights</strong>
                  <span>Submit a full target vector whenever you choose</span>
                  <ArrowRight size={18} />
                </button>
                <button onClick={() => setTab("api")}>
                  <strong>Connect a program</strong>
                  <span>Get an API token and encrypted submission examples</span>
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
            <LedgerProofPanel />
            <Panel>
              <h2>Public investment conditions</h2>
              <Conditions policy={strategy.policy} feeBps={strategy.fee_bps} />
            </Panel>
          </>
        ) : tab === "targets" ? (
          <Panel className="q-form-panel">
            <h2>New target weights</h2>
            <p className="q-muted q-space">

              Target exposure relative to invested capital. Negative weights are shorts. Each full vector replaces the previous targets; 0% closes that asset's position.
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
                    {m.name}  Target weight (%)
                    <input
                      required
                      type="number"
                      step="0.01"
                      aria-label={`${m.name} Target weight (%)`}
                      value={weights[m.id]}
                      onChange={(e) =>
                        setWeights({ ...weights, [m.id]: e.target.value })
                      }
                    />
                    <small>
                      {Number(weights[m.id]) < 0
                        ? "Short"
                        : Number(weights[m.id]) > 0
                          ? "Long"
                          : "Close positions"}
                    </small>
                  </label>
                ))}
              </div>
              <div className="q-callout">

                Gross exposure {gross.toFixed(2)}% / limit{" "}
                {strategy.policy.maxLeverageBps / 100}%
              </div>
              {!valid && (
                <p role="alert" className="q-error">

                  Enter valid weights within the gross exposure limit.
                </p>
              )}
              <p className="q-muted q-space">

                This submission admits pending capital. A new Perpl account requires at least 100 AUSD. Existing accounts still need sufficient collateral for the order.
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
                  ? "Previous request in progress"
                  : status?.status === "HALTED"
                    ? "Trading halted"
                    : "Review submission"}
              </Button>
            </form>
          </Panel>
        ) : tab === "activity" ? (
          <Panel>
            <div className="q-row">
              <h2>Execution history</h2>
              <Button
                secondary
                disabled={p.busy}
                onClick={() => p.run(readStatus)}
              >
                <RefreshCw size={16} />

                Refresh
              </Button>
            </div>
            <p className="q-muted q-space">

              Updates every 10 seconds. Acceptance and execution confirmation do not mean the order is fully filled.
            </p>
            {status?.reconciliationError && (
              <p className="q-callout">
                {platformError(status.reconciliationError)}
              </p>
            )}
            {status?.valuationError && (
              <p className="q-callout">

                Valuation updates are delayed. Check the latest status before treating this as a current value.
              </p>
            )}
            {status?.requests.length ? (
              <div className="q-activity-list">
                {[...status.requests]
                  .sort((a, b) => b.sequence - a.sequence)
                  .map((r) => (
                    <div key={r.id}>
                      <div className="q-row">
                        <strong>Target submission #{r.sequence}</strong>
                        <Badge tone={r.status === "FAILED" ? "warning" : ""}>
                          {statusLabel(r.status)}
                        </Badge>
                      </div>
                      <p className="q-muted">{time(r.createdAt)}</p>
                      {r.error && (
                        <p className="q-callout">{r.error === 'EXECUTION_CONFIRMATION_REQUIRED' && ['FAILED','PARTIALLY_FILLED'].includes(r.status) ? 'Execution stopped. Check the failure reason below.' : platformError(r.error)}</p>
                      )}
                      {['FAILED','PARTIALLY_FILLED'].includes(r.status) && r.error && (
                        <Button secondary disabled={p.busy} onClick={() => p.run(async () => {
                          const result = await p.managerRequest(strategy.id, 'DIAGNOSE', {requestId:r.id});
                          setDiagnoses(previous => ({...previous,[r.id]:result}));
                        })}>Check failure reason</Button>
                      )}
                      {diagnoses[r.id] && <p className="q-callout">
                        {[...new Set((diagnoses[r.id].probes || []).map(probe => probe.code).filter(Boolean))].map(platformError).join(' ') || 'The original cause could not be classified from historical contract checks.'}
                        <small className="q-muted"> Historical contract checks. This does not retry the order.</small>
                      </p>}
                      {["QUEUED", "EXECUTING"].includes(r.status) && (
                        <p className="q-muted">

                          Confirmation pending. Do not submit the same targets again.
                        </p>
                      )}
                    </div>
                  ))}
              </div>
            ) : (
              <Empty
                title="No submissions yet"
                description="Allocate your own capital, then submit your first targets."
                action={
                  <Button secondary onClick={() => setTab("targets")}>

                    Submit targets
                  </Button>
                }
              />
            )}{" "}
            {status?.status === "HALTED" && (
              <Button onClick={() => setResume(true)} disabled={p.busy}>

                Confirm trading restart
              </Button>
            )}
          </Panel>
        ) : tab === "policy" ? (
          <>
            <Panel>
              <h2>Current public conditions</h2>
              <Conditions policy={strategy.policy} feeBps={strategy.fee_bps} />
            </Panel>
            {strategy.pending_policy ? (
              <Panel>
                <h2>Change announced</h2>
                <p className="q-space">
                  {time(strategy.pending_policy.effectiveAfter)}  Changes apply after existing redemptions settle, starting from this time.
                </p>
                <Conditions
                  policy={strategy.pending_policy.policy}
                  feeBps={strategy.pending_policy.feeBps}
                />
              </Panel>
            ) : (
              <Panel className="q-form-panel">
                <h2>Update investment conditions</h2>
                <p className="q-muted q-space">

                  Changes are announced before taking effect, giving investors an opportunity to redeem.
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
                  <Button disabled={p.busy}>Compare changes</Button>
                </form>
              </Panel>
            )}
          </>
        ) : (
          <Panel>
            <h2>Connect this strategy to a program</h2>
            <label className="q-field">

              Strategy ID
              <input readOnly value={strategy.id} />
            </label>
            <Button
              secondary
              onClick={() =>
                p.run(async () => {
                  await navigator.clipboard.writeText(strategy.id);
                  p.notify("Strategy ID copied.");
                })
              }
            >

              Copy ID
            </Button>
            <p className="q-space q-muted">

              Manage API tokens and submission examples on the shared API integration page.
            </p>
            <Link className="q-button" to="/manage/api">

              Open API integration <ArrowRight size={16} />
            </Link>
          </Panel>
        )}
      </div>
      {capital && (
        <Modal
          title="Allocate own capital"
          busy={p.busy}
          onClose={() => setCapital(false)}
        >
          <InvestmentPanel strategy={publicStrategy || strategy} manager />
        </Modal>
      )}
      {confirm && (
        <Modal
          title={
            gross === 0 ? "Close all positions?" : "Confirm target submission"
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

            This replaces the full target vector. Assets at 0% close, and pending capital joins this execution.
          </p>
          {p.message?.error && (
            <p className="q-error" role="alert">
              {p.message.text}
            </p>
          )}
          <Button disabled={p.busy} onClick={submit}>

            Encrypt and submit
          </Button>
        </Modal>
      )}
      {resume && (
        <Modal
          title="Restart trading?"
          busy={p.busy}
          onClose={() => setResume(false)}
        >
          <p>

            Restart from the closed state. Submit new targets to trade; the stop loss baseline resets at restart.
          </p>
          <Button
            disabled={p.busy}
            onClick={() =>
              p.run(async () => {
                await p.managerRequest(strategy.id, "RESUME");
                await readStatus();
                setResume(false);
                p.notify("Trading restarted. Submit new target weights.");
              })
            }
          >

            Confirm restart
          </Button>
        </Modal>
      )}
      {policyConfirm && (
        <Modal
          title="Confirm investment condition changes"
          busy={p.busy}
          onClose={() => setPolicyConfirm(false)}
        >
          <h3>Current conditions</h3>
          <Conditions policy={strategy.policy} feeBps={strategy.fee_bps} />
          <h3>Proposed conditions</h3>
          <Conditions policy={policy} feeBps={fee} />
          <p className="q-callout">

            Investors see the announcement before it takes effect after existing redemptions settle.
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
                p.notify("Investment condition changes announced.");
              })
            }
          >

            Publish change announcement
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
          title="My strategies"
          description="Build a track record with your capital and attract investors."
        />
        <Panel>
          <Empty
            title="Sign in to manage strategies"
            description="Invest and run strategies with one account."
            action={
              <Button disabled={p.busy || !p.config} onClick={p.login}>

                Sign in
              </Button>
            }
          />
        </Panel>
      </>
    );
  if (path === "/manage/profile") return <Profile key={p.session.userId} />;
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
        title="Strategy not found in your account"
        description="Choose a strategy from your list."
        action={
          <Link to="/manage" className="q-button">

            My strategy list
          </Link>
        }
      />
    );
  }
  return (
    <>
      <PageTitle
        eyebrow="MY STRATEGIES"
        title="My strategies"
        description="Check your capital and trading status, and manage your strategies."
        action={
          <Link className="q-button" to="/manage/new">
            <Plus size={16} />

            Create strategy
          </Link>
        }
      />
      <div className="q-row q-manager-links">
        <Link className="q-text-link" to="/manage/profile">

          Manage public profile
        </Link>
        <Link className="q-text-link" to="/manage/api">

          API tokens and program integration <ArrowRight size={16} />
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
                  <Stat label="Total return" value={percent(m?.pnlBps)} />
                  <Stat
                    label="Own capital"
                    value={money(m?.managerActive)}
                    suffix="AUSD"
                  />
                </div>
                <Link className="q-button secondary" to={`/manage/${s.id}`}>

                  Manage strategy <ArrowRight size={16} />
                </Link>
              </Panel>
            );
          })}
        </div>
      ) : (
        <Panel>
          <Empty
            title="Create your first strategy"
            description="Add an introduction and public conditions, then start trading with your capital."
            action={
              <Link className="q-button" to="/manage/new">

                Create strategy <Plus size={16} />
              </Link>
            }
          />
        </Panel>
      )}
    </>
  );
}
