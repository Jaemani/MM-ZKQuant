// Real testnet UX flow. Only explicitly labelled test wallets; secrets stay in .data.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import {
  Wallet,
  JsonRpcProvider,
  Contract,
  getBytes,
  parseEther,
} from "ethers";
const { chromium } =
  await import("/tmp/mmq-browser/node_modules/playwright/index.mjs");
const source = JSON.parse(readFileSync(".data/platform-live/e2e.json"));
const path = ".data/ux-review/e2e.json";
const state = existsSync(path)
  ? JSON.parse(readFileSync(path))
  : { slug: "ux-" + Date.now().toString(36) };
const save = () =>
  writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
mkdirSync(".data/ux-review", { recursive: true });
if (state.strategy && !/^[0-9a-f-]{36}$/.test(state.strategy))
  delete state.strategy;
save();
const provider = new JsonRpcProvider(
  "https://testnet-rpc.monad.xyz",
  undefined,
  { batchMaxCount: 1, cacheTimeout: -1 },
);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const base = "https://mm-zkquant.vercel.app";
const config = await (await fetch(base + "/api/v1/config")).json();
if (!state.strategy) {
  const existing = await fetch(base + "/api/v1/strategies/" + state.slug);
  if (existing.ok) {
    state.strategy = (await existing.json()).strategy.id;
    save();
  }
}
async function pageFor(role) {
  const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    }),
    page = await context.newPage(),
    wallet = new Wallet(source[role].key, provider);
  await page.exposeBinding(
    "walletBridge",
    async (_, { method, params = [] }) => {
      if (["eth_accounts", "eth_requestAccounts"].includes(method))
        return [wallet.address];
      if (method === "eth_chainId") return "0x279f";
      if (method === "personal_sign")
        return wallet.signMessage(
          params[0].startsWith("0x") ? getBytes(params[0]) : params[0],
        );
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "eth_sendTransaction") {
        const tx = params[0];
        assert.equal(tx.from.toLowerCase(), wallet.address.toLowerCase());
        const { from, gas, ...request } = tx;
        const result = await wallet.sendTransaction({
          ...request,
          ...(gas ? { gasLimit: gas } : {}),
        });
        return result.hash;
      }
      return provider.send(method, params);
    },
  );
  await page.addInitScript(() => {
    window.ethereum = {
      request: (r) => window.walletBridge(r),
      on: () => {},
      removeListener: () => {},
    };
  });
  await page.goto(base);
  await page
    .getByRole("button", { name: "지갑으로 로그인", exact: true })
    .first()
    .click();
  await page.locator(".q-account-button").waitFor({ timeout: 60000 });
  return { context, page, wallet };
}
try {
  if (process.argv.includes("--fund")) {
    const env = Object.fromEntries(
      readFileSync(".env", "utf8")
        .split(/\r?\n/)
        .map((l) => l.match(/^([A-Z_0-9]+)=(.*)$/))
        .filter(Boolean)
        .map((m) => [m[1], m[2].trim().replace(/^['"]|['"]$/g, "")]),
    );
    const funder = new Wallet(env.MONAD_TESTNET_PRIVATE_KEY, provider),
      token = new Contract(
        config.cashTokenAddress,
        [
          "function balanceOf(address) view returns(uint256)",
          "function transfer(address,uint256)",
        ],
        funder,
      );
    for (const role of ["manager", "investor"]) {
      const address = source[role].address;
      if ((await provider.getBalance(address)) < parseEther(".15"))
        await (
          await funder.sendTransaction({ to: address, value: parseEther(".3") })
        ).wait();
      const needed = role === "manager" ? 110000000n : 20000000n;
      if ((await token.balanceOf(address)) < needed)
        await (await token.transfer(address, needed)).wait();
    }
    console.log({ testWalletFunding: true });
  }
  const manager = await pageFor("manager");
  if (!state.strategy) {
    await manager.page
      .getByRole("link", { name: "내 전략", exact: true })
      .first()
      .click();
    await manager.page
      .getByRole("link", { name: "전략 만들기", exact: true })
      .first()
      .click();
    await manager.page
      .getByLabel("공개 이름", { exact: true })
      .fill("E2E 검증 전략가");
    await manager.page
      .getByLabel(/^소개/)
      .fill(
        "실제 테스트 AUSD로 입금·비공개 운용·정산 흐름을 검증하는 계정입니다.",
      );
    await manager.page
      .getByRole("button", { name: "다음 단계", exact: true })
      .click();
    await manager.page
      .getByLabel("전략명", { exact: true })
      .fill("UX E2E · 테스트 운용");
    await manager.page
      .getByLabel("전략 주소 이름", { exact: false })
      .fill(state.slug);
    await manager.page
      .getByLabel("전략 설명", { exact: true })
      .fill(
        "UI 개편의 실제 테스트 AUSD 입금, 목표 제출, 출금 흐름을 확인하는 테스트 전략입니다.",
      );
    await manager.page
      .getByRole("button", { name: "다음 단계", exact: true })
      .click();
    await manager.page.getByLabel(/출금 정산 주기/).selectOption("3600");
    await manager.page
      .getByLabel(/매시간 정산 시각/)
      .fill(String(new Date(Date.now() + 8 * 60000).getUTCMinutes()));
    await manager.page.getByLabel(/출금 신청 마감/).fill("0");
    await manager.page
      .getByRole("button", { name: "다음 단계", exact: true })
      .click();
    await manager.page
      .getByRole("button", { name: "전략 등록", exact: true })
      .click();
    await manager.page.waitForURL(
      (url) => /\/manage\/[0-9a-f-]{36}$/.test(url.pathname),
      { timeout: 60000 },
    );
    state.strategy = manager.page.url().split("/").at(-1);
    save();
    assert.match(state.strategy, /^[0-9a-f-]{36}$/);
    console.log({ strategyRegistered: true });
  }
  for (const [role, amount] of [
    ["manager", "110"],
    ["investor", "20"],
  ]) {
    if (state[role + "Deposit"]) continue;
    const actor = role === "manager" ? manager : await pageFor(role);
    await actor.page.goto(base + "/strategies/" + state.slug);
    await actor.page.getByPlaceholder("0.00", { exact: true }).fill(amount);
    await actor.page
      .getByRole("button", { name: "투자 내용 확인", exact: true })
      .click();
    await actor.page
      .getByRole("button", { name: "지갑에서 승인하고 입금", exact: true })
      .click();
    await actor.page
      .getByRole("heading", { name: "입금이 완료되었습니다", exact: true })
      .waitFor({ timeout: 120000 });
    state[role + "Deposit"] = true;
    save();
    console.log({ role, deposit: true, pendingUntilTarget: true });
    if (role === "investor") await actor.context.close();
  }
  await manager.page.goto(base + "/manage/" + state.strategy);
  await manager.page
    .getByRole("tab", { name: "목표 제출", exact: true })
    .click();
  await manager.page
    .getByLabel("BTC 목표 비중 (%)", { exact: true })
    .fill("20");
  await manager.page
    .getByRole("button", { name: "제출 내용 확인", exact: true })
    .waitFor();
  if (!state.targetSubmitted) {
    await manager.page
      .getByRole("button", { name: "제출 내용 확인", exact: true })
      .click();
    await manager.page
      .getByRole("button", { name: "암호화하여 제출", exact: true })
      .click();
    await manager.page
      .getByText("목표 제출 #1", { exact: true })
      .waitFor({ timeout: 60000 });
    state.targetSubmitted = true;
    save();
    console.log({ targetSubmitted: true });
  }
  await manager.page
    .getByRole("tab", { name: "실행 내역", exact: true })
    .click();
  await manager.page
    .getByText("실행 완료", { exact: true })
    .waitFor({ timeout: 180000 });
  state.targetExecuted = true;
  save();
  console.log({ targetExecuted: true });
  const investor = await pageFor("investor");
  await investor.page
    .getByRole("link", { name: "내 자산", exact: true })
    .first()
    .click();
  await investor.page
    .getByRole("button", { name: "지갑 서명으로 새로고침", exact: true })
    .click();
  const card = investor.page
    .locator(".q-position-list .q-panel")
    .filter({
      has: investor.page.getByRole("link", {
        name: "UX E2E · 테스트 운용",
        exact: true,
      }),
    });
  await card.waitFor({ timeout: 60000 });
  await card
    .getByRole("button", { name: "운용 자금 출금", exact: true })
    .click();
  await investor.page
    .getByRole("button", { name: "출금 신청 확인", exact: true })
    .click();
  await card
    .getByRole("button", { name: "신청 취소", exact: true })
    .waitFor({ timeout: 60000 });
  await card.getByRole("button", { name: "신청 취소", exact: true }).click();
  await investor.page
    .getByText("출금 신청을 취소했습니다.", { exact: true })
    .waitFor({ timeout: 60000 });
  state.withdrawalCancelled = true;
  save();
  console.log({ withdrawalRequestedAndCancelled: true });
  await card
    .getByRole("button", { name: "운용 자금 출금", exact: true })
    .click();
  await investor.page
    .getByRole("button", { name: "출금 신청 확인", exact: true })
    .click();
  await card
    .getByRole("button", { name: "신청 취소", exact: true })
    .waitFor({ timeout: 60000 });
  state.withdrawalRequested = true;
  save();
  console.log({ withdrawalRequested: true });
  await investor.context.close();
  await manager.context.close();
} catch (error) {
  console.error(error.shortMessage || error.message);
  for (const c of browser.contexts())
    for (const page of c.pages()) {
      console.log({
        url: page.url(),
        alerts: await page.getByRole("alert").allTextContents(),
        headings: await page.getByRole("heading").allTextContents(),
      });
      await page.screenshot({
        path: ".data/ux-review/e2e-failure.png",
        fullPage: true,
      });
    }
  process.exitCode = 1;
} finally {
  await browser.close();
  provider.destroy();
}
