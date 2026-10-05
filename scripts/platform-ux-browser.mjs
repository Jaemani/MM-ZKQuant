import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { Wallet, JsonRpcProvider, getBytes } from "ethers";
const { chromium } = await import(
  process.env.MMQ_PLAYWRIGHT_MODULE ||
    "/tmp/mmq-browser/node_modules/playwright/index.mjs"
);
const base = process.env.MMQ_BROWSER_URL || "http://localhost:5173";
const state = JSON.parse(readFileSync(".data/platform-live/e2e.json"));
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const provider = new JsonRpcProvider("https://testnet-rpc.monad.xyz");
const dir = ".data/ux-review";
mkdirSync(dir, { recursive: true });
const results = [];
try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (process.env.MMQ_BLOCK_DIRECT_TEE === "1")
    await page.route("**/*.phala.network/**", route => route.abort());
  await page.goto(base);
  await page.getByRole("heading", { name: "내 투자와 전략, 한눈에" }).waitFor();
  await page.screenshot({ path: dir + "/home-desktop.png", fullPage: true });
  await page
    .getByRole("link", { name: "전략 탐색", exact: true })
    .first()
    .click();
  await page.getByRole("heading", { name: "성과로 선택하는 전략" }).waitFor();
  await page.locator(".q-strategy-card").first().waitFor();
  await page.screenshot({ path: dir + "/explore-desktop.png", fullPage: true });
  await page.getByLabel("전략 검색").fill("does-not-exist");
  await page
    .getByRole("heading", { name: "조건에 맞는 전략이 없습니다" })
    .waitFor();
  await page.getByLabel("전략 검색").fill("");
  await page.getByLabel("위험도", { exact: true }).selectOption("HIGH");
  await page.getByLabel("위험도", { exact: true }).selectOption("");
  await page.getByLabel("정렬", { exact: true }).selectOption("capital");
  const checks = page.getByRole("checkbox", { name: "비교", exact: true });
  for (let i = 0; i < Math.min(3, await checks.count()); i++)
    await checks.nth(i).check();
  await page.getByRole("heading", { name: "선택한 전략 비교" }).waitFor();
  await page.getByRole("button", { name: "비교 초기화" }).click();
  await page.locator(".q-strategy-name").first().click();
  await page
    .getByRole("heading", { name: "이 전략에 투자", exact: true })
    .waitFor();
  await page.screenshot({ path: dir + "/detail-desktop.png", fullPage: true });
  const detailUrl = page.url();
  await page.reload();
  await page
    .getByRole("heading", { name: "이 전략에 투자", exact: true })
    .waitFor();
  assert.equal(page.url(), detailUrl);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: dir + "/detail-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("link", { name: "내 자산", exact: true }).last().click();
  await page.getByRole("heading", { name: "내 자산", exact: true }).waitFor();
  await page.screenshot({ path: dir + "/assets-mobile.png", fullPage: true });
  assert.equal(errors.length, 0, errors.join("\n"));
  results.push({
    publicNavigation: true,
    search: true,
    filters: true,
    comparison: true,
    deepLinkReload: true,
    mobileOverflow: false,
    errors,
  });
  await context.close();
  for (const role of ["manager", "investor"]) {
    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      }),
      page = await context.newPage(),
      wallet = new Wallet(state[role].key, provider),
      errors = [],
      transports = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname.includes('/tee/encrypted-') || url.hostname.endsWith('.phala.network'))
        transports.push({ host: url.hostname, path: url.pathname });
    });
    if (process.env.MMQ_BLOCK_DIRECT_TEE === "1")
      await page.route("**/*.phala.network/**", route => route.abort());
    await page.exposeBinding(
      "walletBridge",
      async (_, { method, params = [] }) => {
        if (["eth_requestAccounts", "eth_accounts"].includes(method))
          return [wallet.address];
        if (method === "eth_chainId") return "0x279f";
        if (method === "personal_sign")
          return wallet.signMessage(
            params[0].startsWith("0x") ? getBytes(params[0]) : params[0],
          );
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "eth_sendTransaction")
          throw Error("TRANSACTIONS_DISABLED");
        return provider.send(method, params);
      },
    );
    await page.addInitScript(() => {
      window.ethereum = {
        request: (r) => window.walletBridge(r),
        on: (name, listener) => {
          window.walletListeners ||= {};
          window.walletListeners[name] = listener;
        },
        removeListener: (name) => {
          delete window.walletListeners?.[name];
        },
      };
    });
    await page.goto(base);
    await page
      .getByRole("button", { name: "지갑으로 로그인", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", {
        name:
          role === "manager"
            ? "E2E 검증 전략가"
            : `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`,
        exact: true,
      })
      .waitFor({ timeout: 60000 });
    await page
      .getByRole("link", { name: "내 자산", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "지갑 서명으로 새로고침", exact: true })
      .click();
    await page.locator(".q-position-list").waitFor({ timeout: 60000 });
    await page.screenshot({
      path: `${dir}/${role}-assets-desktop.png`,
      fullPage: true,
    });
    await page
      .getByRole("link", { name: "내 전략", exact: true })
      .first()
      .click();
    if (role === "manager") {
      await page
        .getByRole("link", { name: "전략 관리", exact: true })
        .first()
        .click();
      await page.getByRole("tab", { name: "실행 내역", exact: true }).click();
      if (process.env.MMQ_REQUIRE_TEE_SESSION === "1")
        await page
          .getByText("목표 제출 #", { exact: false })
          .first()
          .waitFor({ timeout: 60000 });
      await page.screenshot({
        path: `${dir}/manager-workspace-desktop.png`,
        fullPage: true,
      });
      await page.getByRole("tab", { name: "목표 제출", exact: true }).click();
      await page.getByRole("tab", {name:"목표 제출",exact:true}).focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.getByRole("tab",{name:"실행 내역",exact:true}).getAttribute("aria-selected"),"true");
      await page.getByRole("tab",{name:"목표 제출",exact:true}).click();
      await page.getByLabel(/BTC 목표 비중/).fill("9999");
      assert.equal(
        await page
          .getByRole("button", { name: "제출 내용 확인", exact: true })
          .isDisabled(),
        true,
      );
    } else {
      await page
        .getByRole("link", { name: "전략 만들기", exact: true })
        .first()
        .click();
      await page.getByLabel("공개 이름", { exact: true }).fill("UX 테스트");
      await page
        .getByLabel("소개", { exact: true })
        .fill("등록 단계와 모바일 입력을 확인하는 테스트 계정입니다.");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${dir}/${role}-mobile.png`,
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    if (process.env.MMQ_BLOCK_DIRECT_TEE === "1") {
      assert.ok(transports.some(t => t.path.endsWith('/tee/encrypted-investments')));
      if (role === "manager") assert.ok(transports.some(t => t.path.endsWith('/tee/encrypted-strategy')));
      assert.equal(transports.some(t => t.host.endsWith('.phala.network')), false);
    }
    let accountFailures = 0;
    if (process.env.MMQ_SIMULATE_ACCOUNT_FAILURE === "1") {
      await page.route('**/api/v1/me', route => {
        if (accountFailures++ === 0) return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'INTERNAL_ERROR'})});
        return route.continue();
      });
    }
    await page.reload();
    await page
      .getByRole("button", {
        name:
          role === "manager"
            ? "E2E 검증 전략가"
            : `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`,
        exact: true,
      })
      .waitFor({ timeout: 60000 });
    if (process.env.MMQ_SIMULATE_ACCOUNT_FAILURE === "1") assert.ok(accountFailures >= 2);
    if (role === "manager") {
      await page.getByRole("tab", { name: "실행 내역", exact: true }).click();
      await page
        .getByText("목표 제출 #", { exact: false })
        .first()
        .waitFor({ timeout: 60000 });
    }
    await page.evaluate(() => window.walletListeners.accountsChanged?.([]));
    await page
      .getByRole("button", { name: "지갑으로 로그인", exact: true })
      .first()
      .waitFor();
    assert.equal(await page.locator(".q-account-button").count(), 0);
    results.push({
      role,
      accountChangeClearsSession: true,
      globalLogin: true,
      privatePortfolio: true,
      restoredLogin: true,
      mobileOverflow: false,
      errors,
    });
    await context.close();
  }
  writeFileSync(
    dir + "/browser-check.json",
    JSON.stringify({ at: new Date().toISOString(), base, results }, null, 2),
  );
  console.log(JSON.stringify(results));
} catch(error) {
  for(const context of browser.contexts())for(const page of context.pages()){
    console.log({url:page.url(),headings:await page.getByRole('heading').allTextContents(),alerts:await page.getByRole('alert').allTextContents(),pageErrors:results.flatMap(r=>r.errors||[])});
    await page.screenshot({path:dir+'/browser-failure.png',fullPage:true});
  }
  throw error;
} finally {
  await browser.close();
  provider.destroy();
}
