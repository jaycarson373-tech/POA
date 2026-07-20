import assert from "node:assert/strict";
import test from "node:test";
import { normalizePublicUrl } from "../app/public-config";

test("public Railway URLs receive HTTPS when the dashboard value omits it", () => {
  assert.equal(normalizePublicUrl("poa-production-c285.up.railway.app"), "https://poa-production-c285.up.railway.app");
  assert.equal(normalizePublicUrl("https://poa-production-c285.up.railway.app/"), "https://poa-production-c285.up.railway.app");
  assert.equal(normalizePublicUrl(""), "");
});
