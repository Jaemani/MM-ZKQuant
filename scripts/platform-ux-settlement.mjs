import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  Wallet,
  hexlify,
  randomBytes,
  JsonRpcProvider,
  Interface,
} from "ethers";
import { encryptRequest } from "../src/integration/sealed.js";
import { investmentMessage } from "../src/platform/investment-message.js";
const state = JSON.parse(readFileSync(".data/ux-review/e2e.json")),
  source = JSON.parse(readFileSync(".data/platform-live/e2e.json")),
  wallet = new Wallet(source.investor.key),
  provider = new JsonRpcProvider("https://testnet-rpc.monad.xyz");
try {
  const config = await (
      await fetch("https://mm-zkquant.vercel.app/api/v1/config")
    ).json(),
    payload = {
      action: "PORTFOLIO",
      wallet: wallet.address,
      nonce: hexlify(randomBytes(32)),
    };
  payload.signature = await wallet.signMessage(investmentMessage(payload));
  const channel = encryptRequest(config.teeEncryptionPublicKey, payload),
    response = await fetch(
      config.teeEndpoint + "/platform/encrypted-investments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(channel.packet),
      },
    ),
    j = await response.json(),
    portfolio = channel.openReply(j.reply),
    position = portfolio.positions.find((p) => p.strategyId === state.strategy);
  assert.ok(position);
  const request = position.withdrawals.find((w) => w.status !== "CANCELLED");
  if (request?.status !== "PAID") {
    console.log({
      settlementStatus: request?.status,
      error: request?.error,
      at: request?.settlementAt,
    });
    process.exitCode = 2;
  } else {
    assert.equal(position.units, "0");
    assert.ok(BigInt(request.amount) > 0n);
    const receipt = await provider.getTransactionReceipt(request.txHash);
    assert.equal(receipt.status, 1);
    const events = new Interface([
      "event Transfer(address indexed from,address indexed to,uint256 value)",
    ]);
    assert.ok(
      receipt.logs.some((log) => {
        if (log.address.toLowerCase() !== config.cashTokenAddress.toLowerCase())
          return false;
        try {
          const event = events.parseLog(log);
          return (
            event.args.to.toLowerCase() === wallet.address.toLowerCase() &&
            event.args.value === BigInt(request.amount)
          );
        } catch {
          return false;
        }
      }),
    );
    const evidence = {
      at: new Date().toISOString(),
      settlementStatus: "PAID",
      amount: request.amount,
      transaction: request.txHash,
      recipientVerified: true,
      remainingUnits: "0",
    };
    writeFileSync(
      ".data/ux-review/settlement-check.json",
      JSON.stringify(evidence, null, 2),
    );
    state.settlementPaid = true;
    writeFileSync(".data/ux-review/e2e.json", JSON.stringify(state, null, 2), {
      mode: 0o600,
    });
    console.log(evidence);
  }
} finally {
  provider.destroy();
}
