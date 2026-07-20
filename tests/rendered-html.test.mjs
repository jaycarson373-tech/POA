import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
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
  assert.match(html, /Attention is/);
  assert.match(html, /the economy/);
  assert.match(html, /Compete for attention/);
  assert.match(html, /BONK Attention Sprint/);
  assert.match(html, /Get rewarded/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("ships the complete launch surface without starter artifacts", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Connect X \+ wallet/);
  assert.match(page, /Launch a campaign/);
  assert.match(page, /Start attention tracking/);
  assert.match(page, /25 followers/);
  assert.match(page, /wallet older than 7 days/);
  assert.match(page, /poa-logo\.jpg/);
  assert.match(page, /poa-banner\.jpg/);
  assert.match(layout, /\/poa-banner\.jpg/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(page, /codex-preview|SkeletonPreview/);

  await Promise.all([
    access(new URL("../app/icon.png", import.meta.url)),
    access(new URL("../app/apple-icon.png", import.meta.url)),
    access(new URL("../public/poa-logo.jpg", import.meta.url)),
    access(new URL("../public/poa-banner.jpg", import.meta.url)),
  ]);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});
