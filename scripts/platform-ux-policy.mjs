import { readFileSync, writeFileSync } from "node:fs";
import { Wallet, JsonRpcProvider, getBytes } from "ethers";
const { chromium } =
  await import("/tmp/mmq-browser/node_modules/playwright/index.mjs");
const state = JSON.parse(readFileSync(".data/ux-review/e2e.json")),
  source = JSON.parse(readFileSync(".data/platform-live/e2e.json")),
  provider = new JsonRpcProvider("https://testnet-rpc.monad.xyz"),
  wallet = new Wallet(source.manager.key, provider),
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.exposeBinding(
    "walletBridge",
    async (_, { method, params = [] }) => {
      if (["eth_accounts", "eth_requestAccounts"].includes(method))
        return [wallet.address];
      if (method === "eth_chainId") return "0x279f";
      if (method === "personal_sign")
        return wallet.signMessage(getBytes(params[0]));
      if (method === "eth_sendTransaction")
        throw Error("TRANSACTIONS_DISABLED");
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
  await page.goto("https://mm-zkquant.vercel.app/manage/" + state.strategy);
  await page
    .getByRole("button", { name: "지갑으로 로그인", exact: true })
    .first()
    .click();
  await page.getByRole("tab", { name: "운용 조건", exact: true }).click();
  const proposed = page.getByRole("heading", {
    name: "변경 예고 중",
    exact: true,
  });
  if (!(await proposed.count())) {
    await page.getByLabel(/성과보수/).fill("10");
    await page
      .getByRole("button", { name: "변경 내용 비교", exact: true })
      .click();
    await page
      .getByRole("button", { name: "변경 예고 공개", exact: true })
      .click();
    await proposed.waitFor({ timeout: 60000 });
  }
  await page.goto("https://mm-zkquant.vercel.app/strategies/" + state.slug);
  await page
    .getByRole("heading", { name: "운용 조건 변경 예고", exact: true })
    .waitFor({ timeout: 60000 });
  writeFileSync(
    ".data/ux-review/policy-check.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        policyProposalUI: true,
        publicAdvanceNotice: true,
      },
      null,
      2,
    ),
  );
  console.log({ policyProposalUI: true, publicAdvanceNotice: true });
} finally {
  await browser.close();
  provider.destroy();
}
