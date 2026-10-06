import test from "node:test";
import assert from "node:assert/strict";
import { portfolioTotals, periodReturn } from "../src/web/platformModel.js";
import { executionError } from "../src/platform/execution-errors.js";
import { PlatformService } from "../src/platform/service.js";
import {
  newBook,
  depositPending,
  activatePending,
  markBook,
  portfolio,
  requestWithdrawal,
  burnWithdrawal,
} from "../deploy/tee/operator/ledger.mjs";
test("personal P&L includes paid and pending cash without double-counting redemption requests", () => {
  const b = newBook({ id: "s", strategist_wallet: "alice", fee_bps: 0 });
  depositPending(b, "alice", "100000000");
  activatePending(b);
  markBook(b, "120000000");
  depositPending(b, "alice", "10000000");
  const w = requestWithdrawal(b, "alice", "50000000", "request", 0);
  let t = portfolioTotals([portfolio(b, "alice")]);
  assert.equal(t.active + t.pending + t.paid - t.deposited, 20000000n);
  b.cash = "120000000";
  burnWithdrawal(b, w, 60000000n);
  t = portfolioTotals([portfolio(b, "alice")]);
  assert.equal(t.active + t.pending + t.paid - t.deposited, 20000000n);
  assert.equal(
    portfolioTotals([{ value: "5", pending: "0", paid: "0" }]).hasPnl,
    false,
  );
});
test("period comparison refuses insufficient records and uses compounded baseline", () => {
  const now = Date.now(),
    row = (offset, pnl) => ({
      observed_at: new Date(now - offset).toISOString(),
      metrics: { pnlBps: pnl },
    });
  assert.equal(periodReturn([row(1000, 100)], "7d", now), null);
  assert.ok(
    Math.abs(
      periodReturn([row(86400000, 1000), row(0, 2100)], "1d", now) - 1000,
    ) < 1e-8,
  );
  assert.equal(periodReturn([row(100000, 100), row(0, 200)], "7d", now), null);
});
test("RPC diagnostics preserve gas reason and do not publish sensitive RPC inputs", () => {
  const error = {
    shortMessage: "could not coalesce error",
    info: {
      error: { message: "insufficient funds for gas * price + value" },
      payload: { raw: "secret" },
    },
  };
  assert.equal(executionError(error), "OPERATOR_GAS_INSUFFICIENT");
  assert.equal(executionError(Error("OPERATOR_GAS_INSUFFICIENT")), "OPERATOR_GAS_INSUFFICIENT");
  assert.equal(
    executionError({ message: "could not coalesce error" }),
    "RPC_RESPONSE_UNCONFIRMED",
  );
  assert.equal(
    executionError(Error("secret data")),
    "EXECUTION_CONFIRMATION_REQUIRED",
  );
});
test("both browser sessions and API tokens authorize only their owned strategy", async () => {
  const s = new PlatformService({});
  s.session = async () => ({userId:"alice",wallet:"alice"});
  s.database.query = async () => ({ rows: [{ user_id: "alice" }] });
  s.apiKey = async () => ({ user_id: "bob", strategist_wallet: "bob" });
  s.ownedStrategy = async (wallet, id) => {
    if (id !== `${wallet}-strategy`) throw Error("NOT_OWNER");
    return { id };
  };
  assert.equal(
    (await s.authorizeStrategy("Bearer mmq_session_abc", "alice-strategy")).id,
    "alice-strategy",
  );
  assert.equal(
    (await s.authorizeStrategy("Bearer mmq_test_abc", "bob-strategy")).id,
    "bob-strategy",
  );
  await assert.rejects(
    s.authorizeStrategy("Bearer mmq_session_abc", "bob-strategy"),
    /NOT_OWNER/,
  );
});
test("metric query rejects unsupported periods before querying storage", async () => {
  const s = new PlatformService({
    query: () => {
      throw Error("unexpected database access");
    },
  });
  await assert.rejects(
    s.metricHistory("s", { period: "1year" }),
    /INVALID_HISTORY_PERIOD/,
  );
});
