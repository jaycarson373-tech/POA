import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the POA product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>POA — Proof of Attention<\/title>/i);
  assert.match(html, /Turn attention into proof/);
  assert.match(html, /Projects launch campaigns/);
  assert.match(html, /Loading campaigns/);
  assert.match(html, /Loading rankings/);
  assert.match(html, /Loading rewards/);
  assert.match(html, /8MWh…pump/);
  assert.match(html, /POA_SOLANA/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("server-renders the real-data campaign dashboard", async () => {
  const response = await render("/campaign?slug=poa");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /Campaign Dashboard — Proof of Attention/);
  assert.match(html, /SYNCHRONIZING CAMPAIGN DATA/);
  assert.doesNotMatch(html, /BONK Attention Sprint|@solmason|250M|12\.8M|\$184K/);
});

test("ships the complete launch surface without starter artifacts", async () => {
  const [page, dashboard, layout, css, packageJson, controlPlane] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/campaign/campaign-dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260720213000_campaign_control_plane.sql", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Connect X/);
  assert.match(page, /Connect Wallet/);
  assert.match(page, /Disconnect Wallet/);
  assert.match(page, /getWallets/);
  assert.match(page, /StandardDisconnect/);
  assert.match(page, /Launch Campaign/);
  assert.match(page, /https:\/\/x\.com\/POA_solana/);
  assert.match(page, /8MWh6MXsd64vgxrtjN2HygwJLR8g6fTGPTGJUXVBpump/);
  assert.match(page, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(page, /25 followers/);
  assert.match(page, /seven days old/);
  assert.match(page, /poa-wordmark\.jpg/);
  assert.match(page, /framer-motion/);
  assert.match(page, /attention-atmosphere/);
  assert.match(page, /table-row--rank-/);
  assert.match(dashboard, /Your campaign stats/);
  assert.match(dashboard, /TOTAL.*AIRDROPPED/);
  assert.match(dashboard, /24H TOKEN VOLUME/);
  assert.match(dashboard, /HOLD TIME/);
  assert.match(dashboard, /YOUR RANK/);
  assert.match(dashboard, /Market feed not connected/);
  assert.match(controlPlane, /review_status/);
  assert.match(controlPlane, /campaign_holder_positions/);
  assert.match(controlPlane, /campaign_market_snapshots/);
  assert.match(controlPlane, /buyback_epochs/);
  assert.match(controlPlane, /campaign_refunds/);
  assert.match(layout, /\/poa-wordmark\.jpg/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /--shadow-panel/);
  assert.match(packageJson, /framer-motion/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /codex-preview|SkeletonPreview/);
  assert.doesNotMatch(page, /BONK Attention Sprint|@solmason|250M|12\.8M|\$184K/);

  await Promise.all([
    access(new URL("../app/icon.png", import.meta.url)),
    access(new URL("../app/apple-icon.png", import.meta.url)),
    access(new URL("../public/poa-wordmark.jpg", import.meta.url)),
  ]);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
