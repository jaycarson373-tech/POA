import assert from "node:assert/strict";
import test from "node:test";
import { configReadiness, loadConfig } from "../railway/config";

const automationKeys = [
  "AUTO_REWARDS_MODE",
  "AUTO_REWARD_INTERVAL_SECONDS",
  "POA_REWARD_EPOCH_AMOUNT_RAW",
  "POA_REWARD_WALLET_MIN_RESERVE_RAW",
  "POA_REWARD_WALLET_PRIVATE_KEY",
  "POA_REWARD_WALLET_PUBLIC_KEY",
  "BUYBACK_MODE",
  "BUYBACK_INTERVAL_SECONDS",
  "BUYBACK_ALLOCATION_BPS",
  "BUYBACK_MIN_RESERVE_LAMPORTS",
  "BUYBACK_WALLET_PRIVATE_KEY",
  "BUYBACK_WALLET_PUBLIC_KEY",
  "JUPITER_API_KEY",
] as const;

function withoutAutomationEnv(run: () => void) {
  const previous = new Map(automationKeys.map((key) => [key, process.env[key]]));
  for (const key of automationKeys) delete process.env[key];
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("automation defaults run on five-minute intervals with 20% buybacks", () => {
  withoutAutomationEnv(() => {
    const config = loadConfig();
    assert.equal(config.rewardIntervalSeconds, 300);
    assert.equal(config.buybackIntervalSeconds, 300);
    assert.equal(config.buybackAllocationBps, 2000);
  });
});

test("live rewards require an explicitly matched public wallet and reserve", () => {
  withoutAutomationEnv(() => {
    process.env.AUTO_REWARDS_MODE = "live";
    process.env.POA_REWARD_EPOCH_AMOUNT_RAW = "100000000";
    process.env.POA_REWARD_WALLET_PRIVATE_KEY = "configured-server-secret";
    const readiness = configReadiness(loadConfig());
    assert.ok(readiness.missing.includes("POA_REWARD_WALLET_PUBLIC_KEY"));
    assert.ok(readiness.missing.includes("POA_REWARD_WALLET_MIN_RESERVE_RAW"));
  });
});
