const POA_MINT_FALLBACK = "8MWh6MXsd64vgxrtjN2HygwJLR8g6fTGPTGJUXVBpump";

function integer(name: string, fallback: number, minimum = 0) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

function bigintValue(name: string, fallback = BigInt(0)) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = BigInt(raw);
  if (value < BigInt(0)) throw new Error(`${name} cannot be negative`);
  return value;
}

function mode(name: string, fallback: "disabled" | "dry_run" | "live") {
  const value = process.env[name]?.trim().toLowerCase() || fallback;
  if (value !== "disabled" && value !== "dry_run" && value !== "live") {
    throw new Error(`${name} must be disabled, dry_run, or live`);
  }
  return value;
}

export type WorkerConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const tokenDecimals = integer("POA_TOKEN_DECIMALS", 6, 0);
  const minimumHolderTokens = bigintValue("POA_MINIMUM_HOLDER_TOKENS", BigInt(500_000));
  const rewardMode = mode("AUTO_REWARDS_MODE", "disabled");
  const buybackMode = mode("BUYBACK_MODE", "disabled");
  const rewardBudgetRaw = bigintValue("POA_REWARD_EPOCH_AMOUNT_RAW");
  const buybackAllocationBps = integer("BUYBACK_ALLOCATION_BPS", 5000, 1);
  if (buybackAllocationBps > 10_000) throw new Error("BUYBACK_ALLOCATION_BPS cannot exceed 10000");

  return {
    port: integer("PORT", 3001, 1),
    webAppUrl: (process.env.WEB_APP_URL || "https://www.proofofattention.fun").replace(/\/$/, ""),
    allowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || process.env.WEB_APP_URL || "https://www.proofofattention.fun")
      .split(",")
      .map((value) => value.trim().replace(/\/$/, ""))
      .filter(Boolean),
    supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
    solanaRpcUrl: process.env.SOLANA_RPC_URL || "",
    poaMint: process.env.POA_TOKEN_MINT || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || POA_MINT_FALLBACK,
    tokenDecimals,
    minimumHolderTokens,
    minimumHolderRaw: minimumHolderTokens * BigInt(10) ** BigInt(tokenDecimals),
    rewardMode,
    rewardIntervalSeconds: integer("AUTO_REWARD_INTERVAL_SECONDS", 300, 60),
    rewardBudgetRaw,
    rewardWalletMinReserveRaw: bigintValue("POA_REWARD_WALLET_MIN_RESERVE_RAW"),
    rewardMaxRecipients: integer("AUTO_REWARD_MAX_RECIPIENTS", 25, 1),
    rewardMinimumRaw: bigintValue("AUTO_REWARD_MINIMUM_PAYOUT_RAW", BigInt(1)),
    rewardWalletSecret: process.env.POA_REWARD_WALLET_PRIVATE_KEY || "",
    rewardWalletExpectedAddress: process.env.POA_REWARD_WALLET_PUBLIC_KEY || "",
    sellPenaltyBps: integer("POA_SELL_PENALTY_BPS", 5000, 0),
    xBearerToken: process.env.X_BEARER_TOKEN || "",
    xPollIntervalSeconds: integer("X_POLL_INTERVAL_SECONDS", 300, 60),
    followerQualityIntervalSeconds: integer("X_FOLLOWER_QUALITY_INTERVAL_SECONDS", 86_400, 900),
    tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || "",
    internalApiSecret: process.env.INTERNAL_API_SECRET || "",
    collectionAddress: process.env.CAMPAIGN_COLLECTION_WALLET || "",
    collectionWalletSecret: process.env.CAMPAIGN_COLLECTION_WALLET_PRIVATE_KEY || "",
    buybackMode,
    buybackIntervalSeconds: integer("BUYBACK_INTERVAL_SECONDS", 300, 60),
    buybackAllocationBps,
    buybackReserveLamports: bigintValue("BUYBACK_MIN_RESERVE_LAMPORTS"),
    buybackWalletSecret: process.env.BUYBACK_WALLET_PRIVATE_KEY || "",
    buybackWalletExpectedAddress: process.env.BUYBACK_WALLET_PUBLIC_KEY || "",
    buybackOutputMint: process.env.BUYBACK_OUTPUT_MINT || process.env.POA_TOKEN_MINT || POA_MINT_FALLBACK,
    jupiterApiKey: process.env.JUPITER_API_KEY || "",
    walletMinimumAgeDays: integer("WALLET_MINIMUM_AGE_DAYS", 7, 0),
    xMinimumAgeDays: integer("X_MINIMUM_AGE_DAYS", 90, 0),
    xMinimumFollowers: integer("X_MINIMUM_FOLLOWERS", 25, 0),
  };
}

export function configReadiness(config: WorkerConfig) {
  const missing: string[] = [];
  if (!config.supabaseUrl) missing.push("SUPABASE_URL");
  if (!config.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!config.solanaRpcUrl) missing.push("SOLANA_RPC_URL");
  if (!config.tokenEncryptionKey) missing.push("TOKEN_ENCRYPTION_KEY");
  if (config.rewardMode === "live") {
    if (!config.rewardWalletSecret) missing.push("POA_REWARD_WALLET_PRIVATE_KEY");
    if (config.rewardBudgetRaw <= BigInt(0)) missing.push("POA_REWARD_EPOCH_AMOUNT_RAW");
  }
  if (config.buybackMode !== "disabled" && !config.buybackWalletExpectedAddress) {
    missing.push("BUYBACK_WALLET_PUBLIC_KEY");
  }
  if (config.buybackMode === "live") {
    if (!config.buybackWalletSecret) missing.push("BUYBACK_WALLET_PRIVATE_KEY");
    if (!config.jupiterApiKey) missing.push("JUPITER_API_KEY");
    if (config.buybackReserveLamports <= BigInt(0)) missing.push("BUYBACK_MIN_RESERVE_LAMPORTS");
  }
  return { ready: missing.length === 0, missing };
}
